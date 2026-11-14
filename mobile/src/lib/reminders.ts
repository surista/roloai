import * as Notifications from 'expo-notifications';
import { displayName, type Card } from '@roloai/shared';

/**
 * Follow-up reminders: one local notification per card, identified by the card's id so setting
 * a new date replaces the old one. The date itself is stored on the card (followUpAt) so it shows
 * on every device; the notification is scheduled on the device where it was set.
 */

// Shown even when the app is open: a reminder that fires while you are using the app should
// still appear, as Reminders' own do.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const idFor = (cardId: string) => `followup-${cardId}`;

/** Resolves false when the owner has said no; the caller explains. Never prompts twice. */
async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return next.granted;
}

export class RemindersDenied extends Error {}

/** A follow-up at 9am local, the morning of `date`. */
export function followUpMorning(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(9, 0, 0, 0);
  return d;
}

export async function scheduleFollowUp(card: Card, when: Date): Promise<void> {
  if (!(await ensurePermission())) throw new RemindersDenied();
  await Notifications.cancelScheduledNotificationAsync(idFor(card.id)).catch(() => {});
  const company = card.company ? ` (${card.company})` : '';
  await Notifications.scheduleNotificationAsync({
    identifier: idFor(card.id),
    content: {
      title: 'Follow up',
      body: `Get back in touch with ${displayName(card)}${company}.`,
      data: { cardId: card.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
}

export async function cancelFollowUp(cardId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idFor(cardId)).catch(() => {});
}

/** The card a tapped reminder points at, if the response is a reminder tap. */
export function cardIdFromResponse(response: Notifications.NotificationResponse | null | undefined): string | undefined {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return undefined;
  const id = response.notification.request.content.data?.cardId;
  return typeof id === 'string' ? id : undefined;
}
