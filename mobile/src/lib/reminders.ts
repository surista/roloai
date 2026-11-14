import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { displayName, type Card } from '@roloai/shared';

/**
 * Follow-up reminders: one local notification per card, identified by the card's id so setting
 * a new date replaces the old one. The date itself is stored on the card (followUpAt) so it shows
 * on every device, and useFollowUpSync schedules the matching notification on each device that
 * sees it — so a date set on the web or another phone still reminds you here.
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
      data: { cardId: card.id, at: when.getTime() },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
}

export async function cancelFollowUp(cardId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idFor(cardId)).catch(() => {});
}

/** On sign-out: reminders name people, and must not keep firing for a library no longer here. */
export async function cancelAllFollowUps(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith('followup-'))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
  );
}

/** The card a tapped reminder points at, if the response is a reminder tap. */
export function cardIdFromResponse(response: Notifications.NotificationResponse | null | undefined): string | undefined {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return undefined;
  const id = response.notification.request.content.data?.cardId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Keeps this device's scheduled reminders in step with the cards' follow-up dates: schedules the
 * ones set elsewhere (web, another phone), moves ones whose date changed, and drops ones whose
 * card lost its date or was deleted. Never prompts for permission — that only happens when the
 * owner sets a reminder themselves — so without it this quietly does nothing.
 */
export function useFollowUpSync(cards: Card[], loaded: boolean): void {
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted || cancelled) return;
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        const at = new Map<string, unknown>();
        for (const n of scheduled) {
          if (n.identifier.startsWith('followup-')) at.set(n.identifier, n.content.data?.at);
        }
        const wanted = new Set<string>();
        const now = Date.now();
        for (const card of cards) {
          if (!card.followUpAt || card.followUpAt <= now) continue;
          const id = idFor(card.id);
          wanted.add(id);
          if (at.get(id) === card.followUpAt || cancelled) continue;
          await scheduleFollowUp(card, new Date(card.followUpAt)).catch((e) =>
            console.warn('Could not schedule follow-up:', e)
          );
        }
        for (const id of at.keys()) {
          if (!wanted.has(id) && !cancelled) {
            await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
          }
        }
      })();
    }, 1500); // snapshots arrive in bursts; reconcile once they settle
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cards, loaded]);
}
