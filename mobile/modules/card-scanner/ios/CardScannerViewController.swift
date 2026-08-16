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

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    configureInterface()
    sessionQueue.async { [weak self] in
      self?.configureSession()
      self?.session.startRunning()
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

    NSLayoutConstraint.activate([
      hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      hintLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      hintLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
      hintLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -40),
      cancelButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12)
    ])
  }

  private func configureSession() {
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
      return
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
      if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
      if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      device.unlockForConfiguration()
    }
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
    // The app is portrait-locked and uses the back camera, so buffers arrive rotated a quarter
    // turn from upright.
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .right, options: [:])
    try? handler.perform([request])

    guard let quad = request.results?.first,
          quad.confidence >= minimumConfidence,
          Self.area(of: quad) >= minimumQuadArea else {
      stableCount = 0
      lastQuad = nil
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

    guard settled else { return }
    hasFired = true

    // Flash first. This is the shutter moment as the user experiences it, and the crop and
    // encode below take long enough that playing it afterwards would read as lag.
    let flashEndsAt = DispatchTime.now() + Self.flashInDuration + Self.flashOutDuration
    DispatchQueue.main.async { [weak self] in self?.playCaptureFlash() }

    // The frame the quad was measured on, so its corners already describe this exact image.
    // The old path re-detected on a separately captured still, which could disagree with the
    // outline the user had just been shown.
    let upright = CIImage(cvPixelBuffer: buffer).oriented(.right)
    guard let path = Self.write(Self.crop(upright, to: quad)) else {
      resumeAfterFailedCapture()
      return
    }

    // Hand back only once the flash has played out; if the encode already outran it, this
    // fires immediately.
    DispatchQueue.main.asyncAfter(deadline: flashEndsAt) { [weak self] in
      self?.reportOnMain(.captured(path))
    }
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
