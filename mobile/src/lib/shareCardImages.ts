import { ActionSheetIOS, Alert } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { cardImageFileName, cardToVCard, type Card } from '@roloai/shared';
import { FILE_UTI, safeFileName, shareTextFile } from './shareFile';

export type ImageSide = 'front' | 'back';

const urlOf = (card: Card, side: ImageSide) => (side === 'front' ? card.imageUrl : card.imageBackUrl);

/**
 * Downloads one side of the card's photo to the cache and returns the local file.
 *
 * The share sheet needs a local file, not the storage url (which is signed-in-only and carries a
 * token). `idempotent` so a photo retaken since the last share replaces the stale copy instead of
 * failing with DestinationAlreadyExists.
 */
async function downloadCardImage(card: Card, side: ImageSide): Promise<File> {
  const url = urlOf(card, side);
  if (!url) throw new Error(`This card has no ${side} photo.`);
  const dest = new File(Paths.cache, cardImageFileName(card, side));
  return File.downloadFileAsync(url, dest, { idempotent: true });
}

async function shareImageFile(file: File): Promise<void> {
  await Sharing.shareAsync(file.uri, { UTI: 'public.jpeg', mimeType: 'image/jpeg' });
}

/** Resolves true for "Share back", false for "Done". */
function askShareBack(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Share the back now?', undefined, [
      { text: 'Done', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Share back', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Shares card photos. expo-sharing takes ONE file per call, so `both` is sequential: the front
 * first and, once that sheet is dismissed, a prompt before the back (a second sheet opening
 * unasked would feel like a glitch). Both are downloaded up front so the prompt-to-sheet gap is
 * instant. Throws on a failed download; the caller shows the alert.
 */
export async function shareCardImages(card: Card, which: ImageSide | 'both'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  if (which !== 'both') {
    await shareImageFile(await downloadCardImage(card, which));
    return;
  }
  const [front, back] = await Promise.all([
    downloadCardImage(card, 'front'),
    downloadCardImage(card, 'back'),
  ]);
  await shareImageFile(front);
  if (await askShareBack()) await shareImageFile(back);
}

/** Shares the contact as a .vcf. The photo link is left out: it is a signed-in-only storage url. */
export async function shareCardContact(card: Card): Promise<void> {
  const name = `${card.firstName} ${card.lastName}`.trim() || 'Unnamed card';
  await shareTextFile(`${safeFileName(name)}.vcf`, cardToVCard({ ...card, imageUrl: '' }), FILE_UTI.vcard);
}

/**
 * The share menu shared by Card Detail and My Card: contact, plus whichever photos exist.
 * `setBusy` is toggled around photo downloads (the .vcf is instant) so the screen can show
 * progress; the menu is not offered again while busy.
 */
export function presentShareMenu(card: Card, setBusy: (busy: boolean) => void): void {
  const hasFront = Boolean(card.imageUrl);
  const hasBack = Boolean(card.imageBackUrl);
  const options: { label: string; run: () => Promise<void>; photos: boolean }[] = [
    { label: 'Contact (.vcf)', run: () => shareCardContact(card), photos: false },
  ];
  if (hasFront) options.push({ label: 'Front photo', run: () => shareCardImages(card, 'front'), photos: true });
  if (hasBack) options.push({ label: 'Back photo', run: () => shareCardImages(card, 'back'), photos: true });
  if (hasFront && hasBack) options.push({ label: 'Both photos', run: () => shareCardImages(card, 'both'), photos: true });

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Share',
      options: [...options.map((o) => o.label), 'Cancel'],
      cancelButtonIndex: options.length,
    },
    async (index) => {
      const choice = options[index];
      if (!choice) return;
      if (choice.photos) setBusy(true);
      try {
        await choice.run();
      } catch (e) {
        console.error('Share failed:', e);
        Alert.alert(
          'Could not share',
          choice.photos
            ? 'The photo could not be downloaded. Check your connection and try again.'
            : 'Something went wrong opening the share sheet.'
        );
      } finally {
        if (choice.photos) setBusy(false);
      }
    }
  );
}
