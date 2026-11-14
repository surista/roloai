import CoreSpotlight
import ExpoModulesCore

/// Routes a tapped Spotlight result to the card it names.
public class CardScannerAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    guard userActivity.activityType == CSSearchableItemActionType,
          let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String else {
      return false
    }
    if let module = CardScannerModule.current {
      module.sendEvent("onOpenCard", ["id": id])
    } else {
      CardScannerModule.pendingCardId = id
    }
    return true
  }
}
