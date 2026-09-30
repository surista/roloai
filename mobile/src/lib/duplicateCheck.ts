import { Alert } from 'react-native';
import { findDuplicates } from '@roloai/shared';
import { fetchAllCards } from './cards';

/**
 * Thrown from a form's onSave to stop a save the user backed out of. CardForm treats it as a
 * silent stop: no "Save failed" alert, just the spinner clearing so the form is usable again.
 */
/** What findDuplicates judges identity on (the shared package does not export its own name for it). */
type Identifiable = Parameters<typeof findDuplicates>[0];

export class SaveAborted extends Error {}

type Choice = 'save' | 'cancel' | { view: string };

function describe(key: string): string {
  return key.startsWith('email:') ? 'same email' : 'same name and company';
}

function ask(message: string, existingId: string): Promise<Choice> {
  return new Promise((resolve) => {
    Alert.alert('Possible duplicate', message, [
      { text: 'Save anyway', onPress: () => resolve('save') },
      { text: 'View existing', onPress: () => resolve({ view: existingId }) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') });
  });
}

/**
 * Warns before a save that would probably add a second copy of someone already on file.
 * Resolves when the user says to go ahead; throws SaveAborted otherwise (after calling
 * `onView` if they chose to look at the existing card).
 *
 * The library is fetched once here rather than kept subscribed: this runs at most once per Save
 * tap, and a stale copy from an earlier screen could miss a card added a moment ago. If the
 * fetch itself fails the save goes ahead — the check is a courtesy, and a save with no network
 * fails on its own with a proper message.
 */
export async function confirmNoDuplicate(
  fields: Identifiable,
  onView: (cardId: string) => void,
  ignoreId?: string
): Promise<void> {
  let matches: ReturnType<typeof findDuplicates>;
  try {
    matches = findDuplicates(fields, await fetchAllCards(), ignoreId);
  } catch (e) {
    console.warn('Duplicate check skipped:', e);
    return;
  }
  if (!matches.length) return;

  const lines = matches.map(
    ({ card, key }) =>
      `${`${card.firstName} ${card.lastName}`.trim() || 'Unnamed card'} (${describe(key)})`
  );
  const choice = await ask(
    `Already on file: ${lines.join('; ')}.`,
    matches[0].card.id
  );
  if (choice === 'save') return;
  if (choice !== 'cancel') onView(choice.view);
  throw new SaveAborted();
}
