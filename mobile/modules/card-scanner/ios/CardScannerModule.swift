import AVFoundation
import ExpoModulesCore

public class CardScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardScanner")

    /**
     Presents the card scanner and resolves with the cropped JPEG's file path, or null if the
     user cancelled or denied camera access. Resolves only after the scanner has fully dismissed,
     so the caller can present its own UI immediately without racing the dismissal.
     */
    AsyncFunction("scanCard") { (promise: Promise) in
      Self.ensureCameraAccess { granted in
        guard granted else {
          promise.resolve(nil)
          return
        }
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject(CardScannerNoViewControllerException())
          return
        }

        let scanner = CardScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onResult = { path in
          promise.resolve(path)
        }
        presenter.present(scanner, animated: true)
      }
    }
    .runOnQueue(.main)
  }

  private static func ensureCameraAccess(_ completion: @escaping (Bool) -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      completion(true)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { completion(granted) }
      }
    default:
      completion(false)
    }
  }
}

internal final class CardScannerNoViewControllerException: Exception {
  override var reason: String {
    "Could not find a view controller to present the card scanner from"
  }
}
