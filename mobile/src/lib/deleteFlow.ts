import { ActionSheetIOS, Alert } from 'react-native';
import { cardImageUrls, displayName, type Card } from '@roloai/shared';
import { deleteCard } from './cards';
import { cancelFollowUp } from './reminders';
import { removeFromSpotlight } from './spotlight';
import { haptics } from './haptics';

/**
 * Confirms with a destructive action sheet (HIG: confirm from the control that started it), then
 * deletes. `leave` runs before the delete: the live listener drops the card from memory at once,
 * so there is nothing to wait for, and offline the server acknowledgement may never come — the
 * old flow awaited it and left the owner staring at a screen that never moved.
 */
export function confirmDelete(card: Card, leave?: () => void): void {
  haptics.warning();
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `Delete ${displayName(card)}?`,
      message: 'This card and its photos will be deleted from all your devices.',
      options: ['Delete Card', 'Cancel'],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (i) => {
      if (i !== 0) return;
      leave?.();
      deleteCard(card.id, cardImageUrls(card), card.pairedWith)
        .then(() => {
          void cancelFollowUp(card.id);
          removeFromSpotlight(card.id);
        })
        .catch((e) => {
          console.error('Delete failed:', e);
          haptics.error();
          Alert.alert('Couldn’t Delete Card', 'Check your connection and try again.');
        });
    }
  );
}
