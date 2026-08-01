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
final class CardScannerViewController: UIViewController {
  /// Called exactly once, with the cropped JPEG's file path or nil if the user cancelled.
  /// Invoked only after this controller has fully dismissed, so the caller is free to present
  /// something of its own without racing the dismissal.
  var onResult: ((String?) -> Void)?

  private let session = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private let sessionQueue = DispatchQueue(label: "com.roloai.cardscanner.session")
  private let videoQueue = DispatchQueue(label: "com.roloai.cardscanner.video")
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let quadLayer = CAShapeLayer()
  private let hintLabel = UILabel()

  /// Consecutive frames the detected quad has held still. Auto-capture fires once this reaches
  /// `requiredStableFrames`, so a card still being positioned doesn't trigger a shot.
  private var stableCount = 0
  private var lastQuad: VNRectangleObservation?
  private var hasFired = false
  private var didReport = false

  private let requiredStableFrames = 8
  /// Normalized corner movement below which two detections count as the same, settled card.
  private let stabilityTolerance: CGFloat = 0.025
  /// Reject quads covering less than this fraction of the frame — usually a distant or partial card.
  private let minimumQuadArea: CGFloat = 0.10
  private let minimumConfidence: VNConfidence = 0.6

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

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
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
    // .photo gives the full-resolution still that the final crop is taken from; small text on a
    // business card doesn't survive a 1080p video frame well enough for reliable extraction.
    session.sessionPreset = .photo

    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
      session.commitConfiguration()
      report(nil)
      return
    }
    session.addInput(input)

    if session.canAddOutput(videoOutput) {
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
      session.addOutput(videoOutput)
    }
    if session.canAddOutput(photoOutput) {
      session.addOutput(photoOutput)
    }

    session.commitConfiguration()

    try? device.lockForConfiguration()
    if device.isFocusModeSupported(.continuousAutoFocus) {
      device.focusMode = .continuousAutoFocus
    }
    device.unlockForConfiguration()
  }

  // MARK: - Result

  @objc private func handleCancel() {
    report(nil)
  }

  /// Stops the session, dismisses, and reports back — exactly once.
  private func report(_ path: String?) {
    guard !didReport else { return }
    didReport = true
    sessionQueue.async { [weak self] in
      guard let self, self.session.isRunning else { return }
      self.session.stopRunning()
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.dismiss(animated: true) {
        self.onResult?(path)
        self.onResult = nil
      }
    }
  }

  /// A capture that produced nothing usable shouldn't strand the user on a frozen camera.
  private func resumeAfterFailedCapture() {
    hasFired = false
    stableCount = 0
    lastQuad = nil
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
    guard !hasFired, !didReport, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }

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

    let settled = stableCount >= requiredStableFrames
    DispatchQueue.main.async { [weak self] in
      self?.draw(quad)
      self?.hintLabel.text = settled ? "Capturing…" : "Hold steady"
    }

    if settled {
      hasFired = true
      let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
      photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  private func draw(_ quad: VNRectangleObservation) {
    guard let preview = previewLayer else { return }
    // Vision reports normalized points with the origin bottom-left; AVFoundation's capture-device
    // space has it top-left, so flip y on the way through.
    let points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].map { point in
      preview.layerPointConverted(fromCaptureDevicePoint: CGPoint(x: point.x, y: 1 - point.y))
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

extension CardScannerViewController: AVCapturePhotoCaptureDelegate {
  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishProcessingPhoto photo: AVCapturePhoto,
    error: Error?
  ) {
    guard error == nil,
          let data = photo.fileDataRepresentation(),
          let image = UIImage(data: data),
          let cropped = Self.cropToCard(image),
          let path = Self.write(cropped) else {
      resumeAfterFailedCapture()
      return
    }
    report(path)
  }

  /// Perspective-corrects the card out of the full still. Detection is re-run here rather than
  /// reusing the video frame's quad: the still has its own resolution and orientation, and the
  /// corners have to be in *its* coordinate space to crop correctly.
  private static func cropToCard(_ image: UIImage) -> CIImage? {
    guard let base = CIImage(image: image) else { return nil }
    let oriented = base.oriented(forExifOrientation: image.imageOrientation.exifValue)

    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(ciImage: oriented, options: [:])
    try? handler.perform([request])

    guard let quad = request.results?.first else {
      // Detection can miss on the still even when it held on video. An uncropped card still
      // extracts fine, so return the full frame rather than throwing the capture away.
      return oriented
    }

    let size = oriented.extent.size
    func denormalize(_ point: CGPoint) -> CIVector {
      CIVector(x: point.x * size.width, y: point.y * size.height)
    }

    return oriented.applyingFilter("CIPerspectiveCorrection", parameters: [
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

private extension UIImage.Orientation {
  /// CIImage.oriented(forExifOrientation:) wants the EXIF integer, which doesn't match the
  /// raw value of UIImage.Orientation.
  var exifValue: Int32 {
    switch self {
    case .up: return 1
    case .upMirrored: return 2
    case .down: return 3
    case .downMirrored: return 4
    case .leftMirrored: return 5
    case .right: return 6
    case .rightMirrored: return 7
    case .left: return 8
    @unknown default: return 1
    }
  }
}
