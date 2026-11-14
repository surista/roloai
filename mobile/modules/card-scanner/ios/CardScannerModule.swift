import AVFoundation
import CoreSpotlight
import ExpoModulesCore
import UniformTypeIdentifiers

public class CardScannerModule: Module {
  /// The live module, so the app delegate subscriber can hand it a Spotlight tap. Weak: the
  /// module's lifetime belongs to the React runtime.
  static weak var current: CardScannerModule?
  /// A Spotlight result tapped before JS was listening (a cold launch). JS collects it on start.
  static var pendingCardId: String?

  public func definition() -> ModuleDefinition {
    Name("CardScanner")

    Events("onOpenCard")

    OnStartObserving {
      CardScannerModule.current = self
    }

    // Signed out (no JS listener): a Spotlight tap must wait in pendingCardId, not be sent to
    // nobody.
    OnStopObserving {
      if CardScannerModule.current === self { CardScannerModule.current = nil }
    }

    View(ContextMenuView.self) {
      Events("onSelect")
      Prop("actions") { (view: ContextMenuView, actions: [ContextMenuAction]) in
        view.actions = actions
      }
    }

    /// The card a Spotlight tap launched the app for, once; nil afterwards.
    Function("takePendingCardId") { () -> String? in
      defer { CardScannerModule.pendingCardId = nil }
      return CardScannerModule.pendingCardId
    }

    /**
     Finds the card in a photo picked from the library, crops and straightens it, and resolves
     with a file uri — or the photo unchanged if no card edge can be found.
     */
    AsyncFunction("cropCardFromPhoto") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri) else {
        promise.resolve(nil)
        return
      }
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(CardScannerViewController.cropCard(fromFile: url))
      }
    }

    /// One share sheet for several files (both sides of a card). expo-sharing takes one at a time.
    AsyncFunction("shareFiles") { (uris: [String], promise: Promise) in
      let urls = uris.compactMap { URL(string: $0) }
      guard !urls.isEmpty, let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.resolve(false)
        return
      }
      let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
      sheet.completionWithItemsHandler = { _, completed, _, _ in promise.resolve(completed) }
      // iPad (and Mac) present the sheet as a popover, which needs an anchor or it crashes.
      sheet.popoverPresentationController?.sourceView = presenter.view
      sheet.popoverPresentationController?.sourceRect = CGRect(
        x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 80, width: 0, height: 0
      )
      presenter.present(sheet, animated: true)
    }
    .runOnQueue(.main)

    /**
     Replaces the Spotlight index with these cards, so a system search for a name or company
     finds them. Indexed on-device only (not in iCloud) and removed on sign-out.
     */
    AsyncFunction("indexCards") { (items: [[String: String]], promise: Promise) in
      let searchable = items.compactMap { item -> CSSearchableItem? in
        guard let id = item["id"] else { return nil }
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.contact)
        attributes.title = item["title"]
        attributes.contentDescription = item["subtitle"]
        attributes.keywords = item["keywords"]?.split(separator: "\n").map(String.init)
        return CSSearchableItem(uniqueIdentifier: id, domainIdentifier: "cards", attributeSet: attributes)
      }
      let index = CSSearchableIndex.default()
      index.deleteSearchableItems(withDomainIdentifiers: ["cards"]) { _ in
        index.indexSearchableItems(searchable) { error in
          if let error { promise.reject("E_SPOTLIGHT", error.localizedDescription) } else { promise.resolve(nil) }
        }
      }
    }

    AsyncFunction("removeFromSpotlight") { (ids: [String], promise: Promise) in
      CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids) { _ in promise.resolve(nil) }
    }

    AsyncFunction("clearSpotlight") { (promise: Promise) in
      CSSearchableIndex.default().deleteAllSearchableItems { _ in promise.resolve(nil) }
    }

    // Load Vision's text models in the background as the app starts, so the first scan of a
    // session (or of a new install) does not pay for it between the shutter and the review.
    OnCreate {
      CardScannerViewController.warmUpTextRecognition()
    }

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
