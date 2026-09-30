import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  cardFromFirestore,
  cardImageUrls,
  cardToVCard,
  pairCandidates,
  partnerOf,
  type Card,
} from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { db } from '../lib/firebase';
import {
  deleteCard,
  linkCards,
  subscribeToCards,
  unlinkCards,
  updateCard,
  updateCardImage,
} from '../lib/cards';
import { confirmNoDuplicate } from '../lib/duplicateCheck';
import { FILE_UTI, safeFileName, shareTextFile } from '../lib/shareFile';
import Button from '../components/Button';
import CardForm from '../components/CardForm';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

const displayName = (c: Card) => `${c.firstName} ${c.lastName}`.trim() || 'Unnamed card';

export default function CardDetailScreen({ route, navigation }: Props) {
  const { cardId } = route.params;
  const [card, setCard] = useState<Card | null>(null);
  // Every card, only to find this one's pairing partner and candidates.
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'cards', cardId), (snap) => {
      if (!snap.exists()) {
        setCard(null);
        return;
      }
      setCard(cardFromFirestore(snap.id, snap.data()));
    });
  }, [cardId]);

  useEffect(() => subscribeToCards(setAllCards), []);

  const { partner, candidates } = useMemo(() => {
    if (!card) return { partner: undefined, candidates: [] as Card[] };
    // Judge against the live list's copy of this card, so pairing state is consistent with its
    // partner's (both come from the same snapshot).
    const self = allCards.find((c) => c.id === card.id) ?? card;
    const byId = new Map(allCards.map((c) => [c.id, c]));
    return { partner: partnerOf(self, byId), candidates: pairCandidates(self, allCards) };
  }, [card, allCards]);

  if (!card) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const runLinking = async (action: () => Promise<void>) => {
    if (linking) return;
    setLinking(true);
    try {
      await action();
    } catch (e) {
      console.error('Pairing failed:', e);
      Alert.alert('Could not update the link', 'Check your connection and try again.');
    } finally {
      setLinking(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete card', `Delete ${card.firstName} ${card.lastName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCard(cardId, cardImageUrls(card), card.pairedWith);
          navigation.popToTop();
        },
      },
    ]);
  };

  const handleShare = async () => {
    try {
      // The photo link is left out: it is a signed-in-only storage url, meaningless to the
      // recipient, and carries an access token.
      const vcard = cardToVCard({ ...card, imageUrl: '' });
      await shareTextFile(`${safeFileName(displayName(card))}.vcf`, vcard, FILE_UTI.vcard);
    } catch (e) {
      console.error('Share failed:', e);
      Alert.alert('Could not share', 'Something went wrong opening the share sheet.');
    }
  };

  const header = (partner || candidates.length > 0) && (
    <View style={styles.banner}>
      {partner ? (
        <>
          <Text style={styles.bannerText}>Also on file: {displayName(partner)}</Text>
          <View style={styles.bannerActions}>
            <Button
              onPress={() => navigation.push('CardDetail', { cardId: partner.id })}
              accessibilityLabel={`Open ${displayName(partner)}`}
            >
              <Text style={styles.bannerLink}>Open</Text>
            </Button>
            <Button
              disabled={linking}
              onPress={() => runLinking(() => unlinkCards(card.id, partner.id))}
              accessibilityLabel="Unlink cards"
            >
              <Text style={styles.bannerLink}>Unlink</Text>
            </Button>
          </View>
        </>
      ) : (
        candidates.slice(0, 3).map((other) => (
          <View key={other.id} style={styles.candidate}>
            <Text style={styles.bannerText}>
              This looks like the same person: {displayName(other)}
            </Text>
            <Button
              disabled={linking}
              onPress={() => runLinking(() => linkCards(card.id, other.id))}
              accessibilityLabel={`Link with ${displayName(other)}`}
            >
              <Text style={styles.bannerLink}>Link cards</Text>
            </Button>
          </View>
        ))
      )}
    </View>
  );

  return (
    <CardForm
      draft={card}
      header={header || undefined}
      imageUri={card.imageUrl || undefined}
      backImageUri={card.imageBackUrl || undefined}
      saveLabel="Save Changes"
      onSave={async (fields) => {
        await confirmNoDuplicate(
          fields,
          (existingId) => navigation.push('CardDetail', { cardId: existingId }),
          cardId
        );
        await updateCard(cardId, fields);
      }}
      onRetakePhoto={async (side, localUri) => {
        const previousUrl = side === 'front' ? card.imageUrl : card.imageBackUrl;
        await updateCardImage(
          cardId,
          localUri,
          side,
          previousUrl || undefined,
          side === 'front' ? card.thumbUrl : undefined
        );
      }}
      secondaryAction={{ label: 'Share', onPress: handleShare }}
      extraAction={{ label: 'Delete Card', onPress: handleDelete, destructive: true }}
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: '#f1f8ee',
    gap: 8,
  },
  candidate: { gap: 6 },
  bannerText: { color: '#234', fontSize: 14 },
  bannerActions: { flexDirection: 'row', gap: 24 },
  bannerLink: { color: '#0a7cff', fontWeight: '600', fontSize: 14 },
});
