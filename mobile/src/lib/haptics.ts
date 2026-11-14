import * as Haptics from 'expo-haptics';

/**
 * The app's haptic vocabulary, mapped to the system feedback types the HIG assigns them.
 * Fire-and-forget: a device without a Taptic Engine (or with System Haptics off) rejects or
 * no-ops, and that must never surface as an error.
 *
 * https://developer.apple.com/design/human-interface-guidelines/playing-haptics
 */
const swallow = () => {};

export const haptics = {
  /** A task finished: card saved, contact added. */
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(swallow),
  /** Something needs attention before continuing: a possible duplicate. */
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(swallow),
  /** Something failed. */
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(swallow),
  /** A discrete thing was detected or snapped into place: a QR code was read. */
  impact: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(swallow),
  /** A value changed in a picker or segmented control. */
  selection: () => void Haptics.selectionAsync().catch(swallow),
};
