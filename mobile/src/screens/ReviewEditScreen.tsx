import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { myCardOf, type CardDraft } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import CardForm from '../components/CardForm';
import { createCard, fetchAllCards, saveScannedMyCard } from '../lib/cards';
import { confirmNoDuplicate } from '../lib/duplicateCheck';
import { CardExtractionError } from '../lib/functions';
import { forgetPhotos, readCard } from '../lib/scanReader';
import { addQueuedScan, removeQueuedScan } from '../lib/scanQueue';
import { captureMetPlace, type MetPlace } from '../lib/location';
import { haptics } from '../lib/haptics';
import { kickQueueReader } from '../lib/queueReader';

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
  const { scan, localImageUri, localBackImageUri, queuedId, mine } = route.params;
  const [draft, setDraft] = useState<CardDraft | undefined>(route.params.draft);
  const [images, setImages] = useState({
    front: localImageUri ?? scan?.frontUri,
    back: localBackImageUri ?? scan?.backUri,
  });
  const [attempt, setAttempt] = useState(0);
  const leaveTo = useRef<() => void>(() => navigation.popToTop());
  // Set when leaving without saving is fine (the scan was queued or deliberately discarded); the
  // form's unsaved-card guard is lifted first, then the navigation runs.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  useEffect(() => {
    leaving?.();
  }, [leaving]);

  // Where the card was received, looked up while it is being read so it is ready by Save. Only a
  // live scan has a "here": a queued scan was taken somewhere else, earlier.
  // Lazy state, not useRef(captureMetPlace()): that would start a new GPS fix and geocode on
  // every render and throw it away.
  const [placePromise] = useState<Promise<MetPlace>>(() =>
    !queuedId && !mine ? captureMetPlace() : Promise.resolve({})
  );
  const place = useRef(placePromise);

  // The scan reader caches each photo's read so the Scan screen can start it early. Once this
  // screen is gone nothing will ask for those reads again.
  useEffect(() => () => forgetPhotos(scan?.frontUri, scan?.backUri), [scan]);

  const saveForLater = async () => {
    if (!scan) return;
    try {
      await addQueuedScan(scan.frontUri, scan.backUri);
      kickQueueReader();
      // Leaving an unsaved card normally asks first; this one is safely queued.
      setLeaving(() => () => navigation.popToTop());
    } catch (e) {
      console.error('Could not queue scan:', e);
      Alert.alert('Couldn’t Save Scan', 'There may not be enough storage space.');
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
        // The rendered copies rather than the originals: these are the size that should be stored.
        setImages({ front: result.front.uri, back: result.back?.uri });
        setDraft(result.draft);
        haptics.success();
      } catch (e) {
        if (cancelled) return;
        console.error('Card extraction failed:', e);
        haptics.error();
        const buttons: { text: string; style?: 'cancel'; onPress: () => void }[] = [
          { text: 'Try Again', onPress: () => setAttempt((n) => n + 1) },
          { text: 'Enter Manually', onPress: () => setDraft(BLANK_DRAFT) },
        ];
        // Queueing helps when the network is the problem; a too-much-text failure would just
        // fail again later. A scan that is already queued stays queued if the user backs out.
        if (!(e instanceof CardExtractionError) && !queuedId && !mine) {
          buttons.push({ text: 'Read Later', onPress: () => void saveForLater() });
        }
        Alert.alert(
          'Couldn’t Read Card',
          e instanceof CardExtractionError
            ? e.message
            : 'Check your connection and try again, or fill in the details yourself.' +
                (!queuedId && !mine ? ' Read Later keeps the photos and reads them when you’re back online.' : ''),
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
    Alert.alert('Discard This Scan?', 'The photos will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          await removeQueuedScan(queuedId);
          setLeaving(() => () => navigation.popToTop());
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
      isNew
      allowLeave={leaving !== null}
      imageUri={images.front}
      backImageUri={images.back}
      saveLabel="Save"
      footerActions={queuedId ? [{ label: 'Discard Scan', onPress: discardQueued, destructive: true }] : undefined}
      onSave={async (fields) => {
        if (mine) {
          // Your own card is not a duplicate of anyone, and replaces the one already set.
          const existing = myCardOf(await fetchAllCards());
          await saveScannedMyCard(existing, fields, draft?.rawOcrText, images.front, images.back);
          // popTo, not navigate: navigate would push a second My Card over this saved form.
          leaveTo.current = () => navigation.popTo('MyCard');
          return;
        }
        // "View existing" opens the other card on top; Back returns here to finish this one.
        await confirmNoDuplicate(fields, (cardId) => navigation.navigate('CardDetail', { cardId }));
        const met = await place.current;
        const id = await createCard(
          {
            ...fields,
            ...met,
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
        // Land on the new card, as Contacts does after creating one.
        leaveTo.current = () => {
          navigation.popToTop();
          navigation.navigate('CardDetail', { cardId: id });
        };
      }}
      onSaved={() => leaveTo.current()}
    />
  );
}
