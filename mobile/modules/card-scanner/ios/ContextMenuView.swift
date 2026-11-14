import ExpoModulesCore
import UIKit

struct ContextMenuAction: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  /// An SF Symbol name.
  @Field var image: String? = nil
  @Field var destructive: Bool = false
}

/// A long-press context menu around React Native content, as on a row in Contacts or Mail.
///
/// A plain view with `UIContextMenuInteraction`, deliberately not a `UIButton`: the menu library
/// this replaces hosted its children in a `UIButton`, whose own menu gesture cancelled React
/// Native's touch on every tap, so rows inside it could never be opened.
class ContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  var actions: [ContextMenuAction] = []
  let onSelect = EventDispatcher()

  /// The chosen action is reported once the menu has finished dismissing — whichever of the two
  /// callbacks UIKit makes last — so JS can present a confirmation sheet without colliding with
  /// the dismissal animation.
  private var pendingId: String?
  private var menuEnded = true

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !actions.isEmpty else { return nil }
    let actions = self.actions
    menuEnded = false
    pendingId = nil
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      UIMenu(children: actions.map { action in
        UIAction(
          title: action.title,
          image: action.image.flatMap { UIImage(systemName: $0) },
          attributes: action.destructive ? .destructive : []
        ) { _ in
          self?.pendingId = action.id
          self?.fireIfReady()
        }
      })
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    let finish = { [weak self] in
      self?.menuEnded = true
      self?.fireIfReady()
    }
    if let animator {
      animator.addCompletion(finish)
    } else {
      finish()
    }
  }

  private func fireIfReady() {
    guard menuEnded, let id = pendingId else { return }
    pendingId = nil
    onSelect(["id": id])
  }
}
