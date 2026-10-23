import AVFoundation
import UIKit
import Vision

/**
 A single-shot business card scanner.

 VisionKit's `VNDocumentCameraViewController` auto-captures continuously and only reports back
 once the user taps Save, so it cannot offer a per-capture confirmation — there is no page limit
 and no per-capture delegate. This does the same job (live edge detection, auto-capture,
 perspective crop) but stops after one capture and hands the cropped image straight back, so the
 caller can show it and wait for the user.
 */
/// Why the scanner finished. The caller needs to tell these apart: a cancel is the user's
/// choice and should be silent, but an unavailable camera is a failure that has to be reported,
/// and collapsing both to "nil" makes the whole flow look like a no-op.
enum CardScanOutcome {
  case captured(String)
  case cancelled
  case unavailable
}

final class CardScannerViewController: UIViewController {
  /// Called exactly once. Invoked only after this controller has fully dismissed, so the caller
  /// is free to present something of its own without racing the dismissal.
  var onResult: ((CardScanOutcome) -> Void)?

  private let session = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let sessionQueue = DispatchQueue(label: "com.roloai.cardscanner.session")
  private let videoQueue = DispatchQueue(label: "com.roloai.cardscanner.video")
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let quadLayer = CAShapeLayer()
  private let hintLabel = UILabel()
  /// Full-screen white overlay pulsed on capture. This is the *only* signal that a shot was
  /// taken: frames come off the video stream rather than AVCapturePhotoOutput, so iOS plays no
  /// shutter sound, and without a visual cue the capture is completely silent and invisible.
  private let flashView = UIView()
  /// Shown from the moment of capture until the scanner dismisses. Cropping, orientation
  /// detection and encoding take a moment (far longer the first time on a freshly installed
  /// build), and a frozen camera with no sign of life reads as a hang.
  private let spinner = UIActivityIndicatorView(style: .large)

  /// Held so the frame callback can ask whether the lens is still hunting. Reading
  /// `isAdjustingFocus` is the only way to know; a quad can sit perfectly still while the
  /// image behind it is still soft.
  private var captureDevice: AVCaptureDevice?
  /// When the session began delivering frames, used for the warm-up hold below.
  private var streamStartedAt: CFTimeInterval?

  /// Consecutive frames the detected quad has held still. Auto-capture fires once this reaches
  /// `requiredStableFrames`, so a card still being positioned doesn't trigger a shot.
  private var stableCount = 0
  private var lastQuad: VNRectangleObservation?
  private var hasFired = false

  /// The sharpest frame seen since the card settled, and how many frames the burst has covered.
  /// A card that is still can still be shot mid-refocus or mid-shake; scoring the next few
  /// frames and keeping the best is what makes the saved photo the crisp one. Video queue only.
  private struct BestFrame {
    let buffer: CVPixelBuffer
    let quad: VNRectangleObservation
    let score: Float
  }
  private var bestFrame: BestFrame?
  private var burstCount = 0
  private let burstLength = 5
  /// The most frames a burst may run while waiting for the lens to finish sharpening.
  private let burstLimit = 20
  /// The sharpest score seen for the card now in view. A frame is good enough once it comes within
  /// this fraction of that: while focus is still creeping in, later frames are better, and
  /// shooting the first few steady ones is what produced "slightly soft" photos.
  private var sharpestSeen: Float = 0
  private let sharpEnoughRatio: Float = 0.9
  /// Where the lens was last told to look, so focus is only re-aimed when the card has moved.
  private var lastFocusPoint: CGPoint?
  private var lastFocusSetAt: CFTimeInterval = 0

  /// Main-queue-only state. `report(_:)` hops to main before touching any of it.
  private var didReport = false
  private var hasAppeared = false
  private var pendingOutcome: CardScanOutcome?

  private let requiredStableFrames = 12
  /// Normalized corner movement below which two detections count as the same, settled card.
  private let stabilityTolerance: CGFloat = 0.025
  /// Reject quads covering less than this fraction of the frame — usually a distant or partial card.
  private let minimumQuadArea: CGFloat = 0.10
  private let minimumConfidence: VNConfidence = 0.6
  /// Frames arrive before continuous autofocus has run its first ramp, and during that window
  /// `isAdjustingFocus` is still false — the lens hasn't started hunting, not finished. Without
  /// this hold a card already in frame satisfies the stability check outright and gets shot
  /// through a soft lens.
  private let focusWarmUp: CFTimeInterval = 0.6
  /// In, then out. Long enough to register as a deliberate flash, short enough not to delay
  /// the review sheet.
  private static let flashInDuration: TimeInterval = 0.06
  private static let flashOutDuration: TimeInterval = 0.22

  private static let ciContext = CIContext()
  /// Long side of the copy live edge detection reads; the capture itself uses the full frame.
  private static let detectionLongSide: CGFloat = 1280
  /// Orientation detection runs here, off the video queue, so it can be abandoned on a timeout.
  private static let ocrQueue = DispatchQueue(label: "com.roloai.cardscanner.ocr", qos: .userInitiated)
  /// The longest a capture will wait for orientation detection before trusting the card's shape.
  private static let orientationTimeout: DispatchTimeInterval = .milliseconds(2500)
  /// Long side of the copy orientation detection reads. It only has to tell right-way-up from
  /// upside-down, which a 1000px copy answers as well as a 12MP one in a fraction of the time.
  private static let orientationProbeSize: CGFloat = 1000

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    configureInterface()
    Self.warmUpTextRecognition()
    sessionQueue.async { [weak self] in
      guard let self, self.configureSession() else { return }
      self.session.startRunning()
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    hasAppeared = true
    if let outcome = pendingOutcome {
      pendingOutcome = nil
      report(outcome)
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
    flashView.frame = view.bounds
  }

  override var prefersStatusBarHidden: Bool { true }

  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

  // MARK: - Setup

  private func configureInterface() {
    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)
    previewLayer = preview

    quadLayer.fillColor = UIColor.systemGreen.withAlphaComponent(0.2).cgColor
    quadLayer.strokeColor = UIColor.systemGreen.cgColor
    quadLayer.lineWidth = 3
    view.layer.addSublayer(quadLayer)

    hintLabel.text = "Point at a business card"
    hintLabel.textColor = .white
    hintLabel.font = .systemFont(ofSize: 16, weight: .semibold)
    hintLabel.textAlignment = .center
    hintLabel.numberOfLines = 0
    hintLabel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(hintLabel)

    let cancelButton = UIButton(type: .system)
    cancelButton.setTitle("Cancel", for: .normal)
    cancelButton.setTitleColor(.white, for: .normal)
    cancelButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
    cancelButton.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
    cancelButton.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(cancelButton)

    // Added last so it covers the preview, the quad, and the controls — a flash that leaves the
    // chrome punched out of it reads as a glitch rather than a shutter.
    flashView.backgroundColor = .white
    flashView.alpha = 0
    flashView.isUserInteractionEnabled = false
    view.addSubview(flashView)

    spinner.color = .white
    spinner.hidesWhenStopped = true
    spinner.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(spinner)

    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      hintLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      hintLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
      hintLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
      cancelButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12)
    ])
  }

  /// Returns whether the session ended up with an input worth running. `false` means
  /// `report(.unavailable)` has already been called and the caller must not start the session.
  @discardableResult
  private func configureSession() -> Bool {
    session.beginConfiguration()
    // .photo gives the largest 4:3 buffer the video path will deliver, which is what the capture
    // is now taken from. There is no AVCapturePhotoOutput here on purpose: it plays the system
    // shutter sound, no public API disables it, and on Japanese and Korean handsets it is
    // mandatory below the app layer. A video frame makes no sound at all.
    session.sessionPreset = .photo

    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
      session.commitConfiguration()
      report(.unavailable)
      return false
    }
    session.addInput(input)
    captureDevice = device

    if session.canAddOutput(videoOutput) {
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
      session.addOutput(videoOutput)
    }

    session.commitConfiguration()

    // Only unlock if the lock was actually taken — unlocking a device you don't hold is
    // undefined per AVFoundation's contract.
    if (try? device.lockForConfiguration()) != nil {
      // The .photo preset makes the preview and the video frames about 1440x1080 whatever the
      // sensor can do (the full-resolution still is for AVCapturePhotoOutput, which is not
      // used here). A card filling half the frame then crops to ~650px wide and looks soft on
      // any big screen. Asking for the sensor's full 4:3 video format puts a 12MP frame in
      // every capture; setting activeFormat switches the session to input-priority itself.
      // Smooth autofocus is tuned for video: it slows the lens down so refocusing is not visible.
      // A scanner wants the fastest, and the card is always close, so search the near range only.
      if device.isSmoothAutoFocusSupported { device.isSmoothAutoFocusEnabled = false }
      if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
      if let format = Self.sharpestVideoFormat(for: device) {
        device.activeFormat = format
        if format.videoSupportedFrameRateRanges.contains(where: { $0.maxFrameRate >= 30 }) {
          device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
          device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        }
      }
      // A video frame may expose for as long as one frame lasts, 1/30s, and indoors the camera
      // takes it: a hand's tremor then smears fine text however well it is focused. Capping the
      // exposure raises ISO instead, which costs a little noise but keeps the strokes crisp.
      if #available(iOS 18.0, *) {
        let shortest = device.activeFormat.minExposureDuration
        let cap = CMTime(value: 1, timescale: 100)
        device.activeMaxExposureDuration = CMTimeCompare(cap, shortest) < 0 ? shortest : cap
      }
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      device.unlockForConfiguration()
    }
    return true
  }

  /// The largest 4:3 video format the camera offers at a usable frame rate, capped at 12MP:
  /// the 48MP formats on recent Pro models run slowly, and a card never needs them.
  private static func sharpestVideoFormat(for device: AVCaptureDevice) -> AVCaptureDevice.Format? {
    func pixels(_ format: AVCaptureDevice.Format) -> Int32 {
      let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      return size.width * size.height
    }
    return device.formats
      .filter { format in
        let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let isFourByThree = abs(Double(size.width) / Double(size.height) - 4.0 / 3.0) < 0.01
        let fastEnough = format.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 24 }
        return isFourByThree && fastEnough && size.width <= 4032
      }
      .max { pixels($0) < pixels($1) }
  }

  // MARK: - Result

  @objc private func handleCancel() {
    report(.cancelled)
  }

  /// Stops the session, dismisses, and reports back — exactly once. Safe to call from any queue.
  private func report(_ outcome: CardScanOutcome) {
    DispatchQueue.main.async { [weak self] in
      self?.reportOnMain(outcome)
    }
  }

  private func reportOnMain(_ outcome: CardScanOutcome) {
    guard !didReport else { return }

    // Session setup runs from viewDidLoad, so a camera failure can land while the presentation
    // animation is still in flight. UIKit drops a dismiss made against a controller that isn't
    // finished presenting, which would leave the user on a black screen with a Cancel button
    // that no longer does anything (didReport would already be set). Hold the outcome until
    // viewDidAppear instead.
    guard hasAppeared else {
      pendingOutcome = outcome
      return
    }
    didReport = true

    // Close the capture path using the flag the video queue owns, so no further frame can
    // start a capture whose temp file would then be orphaned by the guard above.
    videoQueue.async { [weak self] in self?.hasFired = true }
    sessionQueue.async { [weak self] in
      guard let self, self.session.isRunning else { return }
      self.session.stopRunning()
    }

    dismiss(animated: true) { [weak self] in
      guard let self else { return }
      self.onResult?(outcome)
      self.onResult = nil
    }
  }

  /// Blinks the screen white to stand in for the shutter sound. Main queue only.
  private func playCaptureFlash() {
    flashView.alpha = 0
    UIView.animate(withDuration: Self.flashInDuration, delay: 0, options: .curveEaseOut) {
      self.flashView.alpha = 1
    } completion: { _ in
      UIView.animate(withDuration: Self.flashOutDuration, delay: 0, options: .curveEaseIn) {
        self.flashView.alpha = 0
      }
    }
  }

  /// A capture that produced nothing usable shouldn't strand the user on a frozen camera.
  /// The detection flags belong to `videoQueue`, so reset them there rather than from whichever
  /// queue delivered the photo callback.
  private func resumeAfterFailedCapture() {
    videoQueue.async { [weak self] in
      self?.hasFired = false
      self?.stableCount = 0
      self?.lastQuad = nil
    }
    DispatchQueue.main.async { [weak self] in
      self?.spinner.stopAnimating()
      self?.hintLabel.text = "Couldn't read that one — try again"
    }
  }
}

// MARK: - Live detection

extension CardScannerViewController: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    // `hasFired` is owned by this queue and is also what report(_:) sets to close the capture
    // path, so it is the only flag this callback needs to consult.
    guard !hasFired, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }

    // Timed from the first frame rather than from startRunning(), so the warm-up covers the
    // window the user is actually looking at the preview.
    let now = CACurrentMediaTime()
    let startedAt = streamStartedAt ?? now
    streamStartedAt = startedAt

    let request = VNDetectDocumentSegmentationRequest()
    // Detection reads a small copy: at 12MP it would run on a fraction of the frames, and the
    // quad it finds is normalised, so it maps onto the full-size buffer unchanged.
    let longSide = CGFloat(max(CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer)))
    let scale = min(1, Self.detectionLongSide / longSide)
    let detectionImage = CIImage(cvPixelBuffer: buffer)
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    // The app is portrait-locked and uses the back camera, so buffers arrive rotated a quarter
    // turn from upright.
    let handler = VNImageRequestHandler(ciImage: detectionImage, orientation: .right, options: [:])
    try? handler.perform([request])

    guard let quad = request.results?.first,
          quad.confidence >= minimumConfidence,
          Self.area(of: quad) >= minimumQuadArea else {
      stableCount = 0
      lastQuad = nil
      bestFrame = nil
      burstCount = 0
      sharpestSeen = 0
      DispatchQueue.main.async { [weak self] in
        self?.quadLayer.path = nil
        self?.hintLabel.text = "Point at a business card"
      }
      return
    }

    if let previous = lastQuad, Self.isSettled(previous, quad, tolerance: stabilityTolerance) {
      stableCount += 1
    } else {
      stableCount = 0
    }
    lastQuad = quad

    // A card can sit perfectly still while the lens is still resolving it, and the stability
    // check alone can't tell those apart — it only ever looked at where the corners are, never
    // at whether the image behind them is sharp. Hold the count at zero until focus and
    // exposure have both settled, so "steady" can't mean "steady and blurry".
    let focusing = now - startedAt < focusWarmUp
      || captureDevice?.isAdjustingFocus == true
      || captureDevice?.isAdjustingExposure == true
    if focusing {
      stableCount = 0
    }

    let settled = stableCount >= requiredStableFrames
    DispatchQueue.main.async { [weak self] in
      self?.draw(quad)
      self?.hintLabel.text = focusing ? "Focusing…" : (settled ? "Capturing…" : "Hold steady")
    }

    // Aim focus and exposure at the card, not at whatever is in the middle of the frame: with the
    // card off-centre the lens would otherwise settle on the table behind it.
    steerFocus(toward: quad, in: detectionImage, at: now)

    guard settled else {
      bestFrame = nil
      burstCount = 0
      return
    }

    // Settled and focused: look at the next few frames and keep the sharpest.
    let score = Self.sharpness(of: detectionImage, inside: quad)
    if bestFrame == nil || score > bestFrame!.score {
      bestFrame = BestFrame(buffer: buffer, quad: quad, score: score)
    }
    sharpestSeen = max(sharpestSeen, score)
    burstCount += 1
    // Enough frames, and the best of them is as sharp as this card has been: otherwise keep
    // looking (up to a limit) rather than saving a frame the lens was still closing in on.
    guard let best = bestFrame,
          burstCount >= burstLimit
            || (burstCount >= burstLength && best.score >= sharpestSeen * sharpEnoughRatio) else {
      return
    }
    bestFrame = nil
    burstCount = 0
    hasFired = true

    // Flash first. This is the shutter moment as the user experiences it, and the crop and
    // encode below take long enough that playing it afterwards would read as lag.
    let flashEndsAt = DispatchTime.now() + Self.flashInDuration + Self.flashOutDuration
    DispatchQueue.main.async { [weak self] in
      self?.playCaptureFlash()
      self?.hintLabel.text = "Processing…"
      self?.spinner.startAnimating()
    }

    // The frame the quad was measured on, so its corners already describe this exact image.
    // The old path re-detected on a separately captured still, which could disagree with the
    // outline the user had just been shown.
    let upright = CIImage(cvPixelBuffer: best.buffer).oriented(.right)
    let card = Self.uprightCard(Self.crop(upright, to: best.quad))
    guard let path = Self.write(Self.sharpened(card)) else {
      resumeAfterFailedCapture()
      return
    }

    // Hand back only once the flash has played out; if the encode already outran it, this
    // fires immediately.
    DispatchQueue.main.asyncAfter(deadline: flashEndsAt) { [weak self] in
      self?.reportOnMain(.captured(path))
    }
  }

  /// Points the lens and exposure at the middle of the card, at most a couple of times a second
  /// and only once the card has moved: re-aiming every frame would make the lens hunt.
  private func steerFocus(toward quad: VNRectangleObservation, in detectionImage: CIImage, at now: CFTimeInterval) {
    guard let device = captureDevice, device.isFocusPointOfInterestSupported else { return }
    // Whether the card has moved is judged from its corners, which is free; the text lookup below
    // renders an image, so it only runs once the lens actually needs re-aiming.
    let corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
    let middle = CGPoint(
      x: corners.map(\.x).reduce(0, +) / 4,
      y: corners.map(\.y).reduce(0, +) / 4
    )
    if let last = lastFocusPoint, hypot(middle.x - last.x, middle.y - last.y) < 0.06 { return }
    guard now - lastFocusSetAt > 0.4 else { return }

    // Autofocus needs texture, and the middle of a business card is usually blank paper: aimed
    // there the lens hunts or settles on the table behind. Aim at where the text is instead,
    // falling back to the card's middle when nothing stands out.
    let target = Self.textCenter(of: detectionImage, inside: quad) ?? middle
    // Vision's upright, bottom-left-origin space back to the sensor's: the same undoing of the
    // quarter turn and y flip that draw(_:) performs.
    let point = CGPoint(x: 1 - target.y, y: 1 - target.x)
    guard (try? device.lockForConfiguration()) != nil else { return }
    device.focusPointOfInterest = point
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    if device.isExposurePointOfInterestSupported {
      device.exposurePointOfInterest = point
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
    }
    device.unlockForConfiguration()
    lastFocusPoint = middle
    lastFocusSetAt = now
  }

  /// How much fine detail the card area holds: the mean edge strength inside the quad's bounding
  /// box. Only ever compared between frames of the same card, where a blurred frame always scores
  /// lower than a sharp one.
  private static func sharpness(of detectionImage: CIImage, inside quad: VNRectangleObservation) -> Float {
    let upright = detectionImage.oriented(.right)
    let extent = upright.extent
    let xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x]
    let ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y]
    let region = CGRect(
      x: extent.minX + (xs.min() ?? 0) * extent.width,
      y: extent.minY + (ys.min() ?? 0) * extent.height,
      width: ((xs.max() ?? 1) - (xs.min() ?? 0)) * extent.width,
      height: ((ys.max() ?? 1) - (ys.min() ?? 0)) * extent.height
    ).intersection(extent)
    guard !region.isEmpty else { return 0 }

    let edges = upright.cropped(to: region).applyingFilter("CIEdges", parameters: [kCIInputIntensityKey: 1.0])
    let average = edges.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: edges.extent)])
    var pixel = [Float](repeating: 0, count: 4)
    ciContext.render(
      average,
      toBitmap: &pixel,
      rowBytes: MemoryLayout<Float>.size * 4,
      bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
      format: .RGBAf,
      colorSpace: nil
    )
    return pixel[0] + pixel[1] + pixel[2]
  }

  /// The weighted centre of the card's edge energy (its printed text and logo), in Vision's
  /// upright, bottom-left-origin space; nil for a card with nothing printed on it.
  private static func textCenter(of detectionImage: CIImage, inside quad: VNRectangleObservation) -> CGPoint? {
    let upright = detectionImage.oriented(.right)
    let extent = upright.extent
    let xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x]
    let ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y]
    let region = CGRect(
      x: extent.minX + (xs.min() ?? 0) * extent.width,
      y: extent.minY + (ys.min() ?? 0) * extent.height,
      width: ((xs.max() ?? 1) - (xs.min() ?? 0)) * extent.width,
      height: ((ys.max() ?? 1) - (ys.min() ?? 0)) * extent.height
    ).intersection(extent)
    guard region.width > 1, region.height > 1 else { return nil }

    let gridWidth: CGFloat = 24
    let scale = gridWidth / region.width
    let edges = upright.cropped(to: region)
      .applyingFilter("CIEdges", parameters: [kCIInputIntensityKey: 1.0])
      .transformed(by: CGAffineTransform(translationX: -region.minX, y: -region.minY))
      .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let columns = Int(gridWidth)
    let rows = max(1, Int((region.height * scale).rounded()))
    var pixels = [Float](repeating: 0, count: columns * rows * 4)
    ciContext.render(
      edges,
      toBitmap: &pixels,
      rowBytes: columns * MemoryLayout<Float>.size * 4,
      bounds: CGRect(x: 0, y: 0, width: columns, height: rows),
      format: .RGBAf,
      colorSpace: nil
    )
    var total: Float = 0, sumX: Float = 0, sumY: Float = 0
    for row in 0..<rows {
      for column in 0..<columns {
        let index = (row * columns + column) * 4
        let energy = pixels[index] + pixels[index + 1] + pixels[index + 2]
        total += energy
        sumX += energy * (Float(column) + 0.5)
        sumY += energy * (Float(row) + 0.5)
      }
    }
    guard total > 0 else { return nil }
    // Bitmap row 0 is the top; Vision's y runs up from the bottom.
    let inRegionX = CGFloat(sumX / total) / CGFloat(columns)
    let inRegionY = 1 - CGFloat(sumY / total) / CGFloat(rows)
    return CGPoint(
      x: (region.minX - extent.minX + inRegionX * region.width) / extent.width,
      y: (region.minY - extent.minY + inRegionY * region.height) / extent.height
    )
  }

  /// A light luminance sharpen. Video frames get less in-camera sharpening than a still photo, and
  /// text on a card reads noticeably crisper with a little put back. Kept mild to avoid halos.
  private static func sharpened(_ image: CIImage) -> CIImage {
    image.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: 0.45])
  }

  private func draw(_ quad: VNRectangleObservation) {
    guard let preview = previewLayer else { return }
    // Two coordinate spaces have to be undone here, not one. Detection runs with orientation
    // `.right`, so Vision's normalized points are in the *upright* portrait image, origin
    // bottom-left. `layerPointConverted(fromCaptureDevicePoint:)` wants the buffer's own space:
    // origin top-left, in the camera's native landscape. Going back means undoing the quarter
    // turn as well as the y flip — flipping y alone leaves the outline rotated off the card.
    let points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].map { point in
      preview.layerPointConverted(
        fromCaptureDevicePoint: CGPoint(x: 1 - point.y, y: 1 - point.x)
      )
    }
    let path = UIBezierPath()
    path.move(to: points[0])
    points.dropFirst().forEach { path.addLine(to: $0) }
    path.close()
    quadLayer.path = path.cgPath
  }

  private static func area(of quad: VNRectangleObservation) -> CGFloat {
    let points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
    var sum: CGFloat = 0
    for index in points.indices {
      let current = points[index]
      let next = points[(index + 1) % points.count]
      sum += current.x * next.y - next.x * current.y
    }
    return abs(sum) / 2
  }

  private static func isSettled(
    _ lhs: VNRectangleObservation,
    _ rhs: VNRectangleObservation,
    tolerance: CGFloat
  ) -> Bool {
    let pairs = [
      (lhs.topLeft, rhs.topLeft), (lhs.topRight, rhs.topRight),
      (lhs.bottomLeft, rhs.bottomLeft), (lhs.bottomRight, rhs.bottomRight)
    ]
    return pairs.allSatisfy { abs($0.x - $1.x) < tolerance && abs($0.y - $1.y) < tolerance }
  }
}

// MARK: - Capture and crop

extension CardScannerViewController {
  /// Perspective-corrects the card out of the frame it was detected in. Vision reports the quad
  /// normalized against this same image and Core Image shares its bottom-left origin, so the
  /// corners map straight across with only a scale to apply.
  private static func crop(_ image: CIImage, to quad: VNRectangleObservation) -> CIImage {
    let extent = image.extent
    func denormalize(_ point: CGPoint) -> CIVector {
      CIVector(
        x: extent.origin.x + point.x * extent.width,
        y: extent.origin.y + point.y * extent.height
      )
    }

    return image.applyingFilter("CIPerspectiveCorrection", parameters: [
      "inputTopLeft": denormalize(quad.topLeft),
      "inputTopRight": denormalize(quad.topRight),
      "inputBottomLeft": denormalize(quad.bottomLeft),
      "inputBottomRight": denormalize(quad.bottomRight)
    ])
  }

  /// Turns a crop the right way up.
  ///
  /// The quad is named for where its corners sit in the *frame*, not on the card, so the crop
  /// inherits whatever orientation the card happened to have under the lens. Shape narrows that
  /// to two candidates and Vision picks between them by which one it can actually read.
  ///
  /// Both branches matter. A portrait crop means a landscape card was photographed side-on, and
  /// the question is which quarter turn rights it. A landscape crop used to be returned
  /// unchanged on the assumption it was already upright — but a card laid top-away from the
  /// phone crops landscape and *upside down*, which is how upside-down cards were reaching the
  /// review sheet with nothing in the pipeline looking for it.
  ///
  /// Only two orientations are tested, not four: shape rules the other two out before Vision is
  /// asked, and each test is an OCR pass between the shutter flash and the review sheet.
  private static func uprightCard(_ image: CIImage) -> CIImage {
    // The crop is a lazy filter chain; handing it to Vision directly re-runs the perspective
    // correction at full resolution for every request. Render it once and work from that.
    let base = ciContext.createCGImage(image, from: image.extent).map { CIImage(cgImage: $0) } ?? image

    // The margin keeps near-square crops out of the side-on branch, where shape proves nothing.
    let candidates = base.extent.height > base.extent.width * 1.15
      ? [base.oriented(.right), base.oriented(.left)]
      : [base, base.oriented(.down)]

    // A card with no text Vision can read scores zero both ways and keeps the first candidate,
    // which is the better guess from shape alone. So does one where detection takes too long:
    // the first run on a freshly installed build compiles Vision's models, which can take far
    // longer than a capture should wait. The work carries on in the background and warms the
    // models for the next scan.
    let probes = candidates.map { probeCopy(of: $0) }
    let outcome = OrientationOutcome()
    let finished = DispatchSemaphore(value: 0)
    ocrQueue.async {
      outcome.useSecond = legibility(of: probes[1]) > legibility(of: probes[0])
      finished.signal()
    }
    guard finished.wait(timeout: .now() + orientationTimeout) == .success else {
      return candidates[0]
    }
    return outcome.useSecond ? candidates[1] : candidates[0]
  }

  /// A small copy of `image`, for orientation detection only.
  private static func probeCopy(of image: CIImage) -> CIImage {
    let longSide = max(image.extent.width, image.extent.height)
    guard longSide > orientationProbeSize else { return image }
    let scale = orientationProbeSize / longSide
    return image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  }

  /// Carries the orientation verdict out of the OCR queue. Only read after the queue has
  /// signalled, so there is never a concurrent read and write.
  private final class OrientationOutcome: @unchecked Sendable {
    var useSecond = false
  }

  /// Runs one small text request at launch of the scanner so Vision's models are loaded (and,
  /// on a new install, compiled) while the user is still pointing the camera, not when they
  /// have just taken the shot. Safe to call repeatedly; only the first does anything.
  static func warmUpTextRecognition() {
    _ = warmUpOnce
  }

  /// Runs the live edge detector once on a card-like picture. It is a separate model from the text
  /// reader, and is the first thing the scanner runs on the camera: left cold, the outline does not
  /// appear for the first stretch after a fresh install while the model loads, which reads as the
  /// first scan taking forever.
  private static func warmUpEdgeDetection() {
    let size = CGSize(width: 640, height: 480)
    let image = UIGraphicsImageRenderer(size: size).image { context in
      UIColor.darkGray.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIColor.white.setFill()
      context.fill(CGRect(x: 110, y: 120, width: 420, height: 240))
    }
    guard let cgImage = image.cgImage else { return }
    let request = VNDetectDocumentSegmentationRequest()
    try? VNImageRequestHandler(cgImage: cgImage, orientation: .right, options: [:]).perform([request])
  }

  /// A lazily initialised static runs its initialiser exactly once, on whichever thread asks
  /// first, which is the once-only guarantee wanted here.
  private static let warmUpOnce: Void = {
    // Low priority and a few seconds late: this is kicked off as the app launches, and the first
    // run on a new install compiles models for a long time. Starting it at once competed with the
    // app's own startup (sign-in, loading the library, decoding thumbnails) and slowed the open.
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1.5) {
      warmUpEdgeDetection()
      let size = CGSize(width: 400, height: 120)
      let image = UIGraphicsImageRenderer(size: size).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        ("Warm up 0123 Rolo" as NSString).draw(
          at: CGPoint(x: 12, y: 30),
          withAttributes: [.font: UIFont.systemFont(ofSize: 44), .foregroundColor: UIColor.black]
        )
      }
      guard let cgImage = image.cgImage else { return }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .fast
      request.usesLanguageCorrection = false
      try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    }
  }()

  /// Summed confidence of whatever text Vision picks out. Only ever compared against the same
  /// image at the opposite rotation, so the absolute number means nothing on its own.
  private static func legibility(of image: CIImage) -> Float {
    let request = VNRecognizeTextRequest()
    // Fast beats accurate here: this only has to tell upside-down from right-way-up, and it runs
    // between the shutter flash and the review sheet.
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    try? handler.perform([request])
    return (request.results ?? []).reduce(into: Float(0)) { total, observation in
      total += observation.topCandidates(1).first?.confidence ?? 0
    }
  }

  private static func write(_ image: CIImage) -> String? {
    guard let colorSpace = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB),
          let data = ciContext.jpegRepresentation(
            of: image,
            colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]
          ) else {
      return nil
    }
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("card-scan-\(UUID().uuidString).jpg")
    do {
      try data.write(to: url)
      return url.absoluteString
    } catch {
      return nil
    }
  }
}
