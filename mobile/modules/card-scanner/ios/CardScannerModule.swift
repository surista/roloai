import AVFoundation
import ExpoModulesCore

public class CardScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CardScanner")

    /**
     Presents the card scanner and resolves with `{ status, uri? }`:

     - `ok` with a `uri` pointing at the cropped JPEG
     - `cancelled` — the user tapped Cancel
     - `denied` — camera permission was refused, and only Settings can restore it
     - `unavailable` — no usable camera (in use elsewhere, or a simulator)

     The distinction matters: JS has to stay silent on a cancel but must explain the other two,
     and a single null return made every one of them look like the button did nothing.

     Resolves only after the scanner has fully dismissed, so the caller can present its own UI
     immediately without racing the dismissal.
     */
    AsyncFunction("scanCard") { (promise: Promise) in
      Self.ensureCameraAccess { granted in
        guard granted else {
          promise.resolve(["status": "denied"])
          return
        }
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject(CardScannerNoViewControllerException())
          return
        }

        let scanner = CardScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onResult = { outcome in
          switch outcome {
          case .captured(let path):
            promise.resolve(["status": "ok", "uri": path])
          case .cancelled:
            promise.resolve(["status": "cancelled"])
          case .unavailable:
            promise.resolve(["status": "unavailable"])
          }
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

internal final class CardScannerNoViewControllerException: Exception, @unchecked Sendable {
  override var reason: String {
    "Could not find a view controller to present the card scanner from"
  }
}
