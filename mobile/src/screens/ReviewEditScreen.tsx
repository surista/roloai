import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CardDraft } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import CardForm from '../components/CardForm';
import { createCard } from '../lib/cards';
import { confirmNoDuplicate } from '../lib/duplicateCheck';
import { CardExtractionError } from '../lib/functions';
import { forgetPhotos, readCard } from '../lib/scanReader';
import { addQueuedScan, removeQueuedScan } from '../lib/scanQueue';

type Props = NativeStackScreenProps<RootStackParamList, 'ReviewEdit'>;

/** What the form starts from when there is nothing to read, or reading failed. */
const BLANK_DRAFT: CardDraft = {
  firstName: '',
  lastName: '',
  phones: [],
  emails: [],
  tags: [],
  imageUrl: '',
  source: 'scan',
};

/**
 * Where a scan lands. The photos are read here rather than before navigating: reading takes
 * anywhere from a few seconds to over half a minute, and doing it on the Scan screen meant a
 * bare spinner on black for all of it. Here the card is on screen from the first frame and the
 * fields fill in when Claude answers.
 */
export default function ReviewEditScreen({ route, navigation }: Props) {
  const { scan, localImageUri, localBackImageUri, queuedId } = route.params;
  const [draft, setDraft] = useState<CardDraft | undefined>(route.params.draft);
  const [images, setImages] = useState({
    front: localImageUri ?? scan?.frontUri,
    back: localBackImageUri ?? scan?.backUri,
  });
  const [attempt, setAttempt] = useState(0);

  // The scan reader caches each photo's read so the Scan screen can start it early. Once this
  // screen is gone nothing will ask for those reads again.
  useEffect(() => () => forgetPhotos(scan?.frontUri, scan?.backUri), [scan]);

  const saveForLater = async () => {
    if (!scan) return;
    try {
      await addQueuedScan(scan.frontUri, scan.backUri);
      navigation.popToTop();
    } catch (e) {
      console.error('Could not queue scan:', e);
      Alert.alert('Could not save the scan', 'There may not be enough storage space.');
    }
  };

  useEffect(() => {
    if (!scan || draft) return;
    let cancelled = false;

    (async () => {
      try {
        // Usually already under way (or finished) from when the front was accepted.
        const result = await readCard(scan.frontUri, scan.backUri);
        if (cancelled) return;
        // The rendered copies rather than the originals: Save uploads whatever the form holds,
        // and these are the size that should be stored, not the scanner's full-resolution crop.
        setImages({ front: result.front.uri, back: result.back?.uri });
        setDraft(result.draft);
      } catch (e) {
        if (cancelled) return;
        console.error('Card extraction failed:', e);
        const buttons = [
          { text: 'Enter manually', onPress: () => setDraft(BLANK_DRAFT) },
          { text: 'Try again', onPress: () => setAttempt((n) => n + 1) },
        ];
        // Queueing helps when the network is the problem; a too-much-text failure would just
        // fail again later. A scan that is already queued stays queued if the user backs out.
        if (!(e instanceof CardExtractionError) && !queuedId) {
          buttons.push({ text: 'Save for later', onPress: () => void saveForLater() });
        }
        Alert.alert(
          'Could not read the card',
          e instanceof CardExtractionError
            ? e.message
            : 'Check your connection and try again, or fill the details in yourself.',
          buttons
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // `attempt` is the retry trigger; scan and draft are read at the time it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const discardQueued = () => {
    if (!queuedId) return;
    Alert.alert('Discard this scan?', 'The photos will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await removeQueuedScan(queuedId);
          navigation.popToTop();
        },
      },
    ]);
  };

  return (
    <CardForm
      // Remounted once the draft lands so the form's fields start from it.
      key={draft ? 'ready' : 'reading'}
      draft={draft ?? BLANK_DRAFT}
      reading={!draft}
      imageUri={images.front}
      backImageUri={images.back}
      saveLabel="Save Card"
      extraAction={
        queuedId ? { label: 'Discard scan', onPress: discardQueued, destructive: true } : undefined
      }
      onSave={async (fields) => {
        await confirmNoDuplicate(fields, (cardId) =>
          navigation.navigate('CardDetail', { cardId })
        );
        await createCard(
          {
            ...fields,
            imageUrl: '',
            source: draft?.source ?? 'scan',
            rawOcrText: draft?.rawOcrText,
          },
          images.front,
          images.back
        );
        // Only now is the queued scan done with; removing it earlier would lose the photos if
        // the save failed.
        if (queuedId) await removeQueuedScan(queuedId);
        navigation.popToTop();
      }}
    />
  );
}
