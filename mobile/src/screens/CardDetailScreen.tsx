import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Alert } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { cardFromFirestore, type Card } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { db } from '../lib/firebase';
import { deleteCard, updateCard, updateCardImage } from '../lib/cards';
import CardForm from '../components/CardForm';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

export default function CardDetailScreen({ route, navigation }: Props) {
  const { cardId } = route.params;
  const [card, setCard] = useState<Card | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'cards', cardId), (snap) => {
      if (!snap.exists()) {
        setCard(null);
        return;
      }
      setCard(cardFromFirestore(snap.id, snap.data()));
    });
  }, [cardId]);

  if (!card) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const handleDelete = () => {
    Alert.alert('Delete card', `Delete ${card.firstName} ${card.lastName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCard(cardId, [card.imageUrl, card.imageBackUrl]);
          navigation.popToTop();
        },
      },
    ]);
  };

  return (
    <CardForm
      draft={card}
      imageUri={card.imageUrl || undefined}
      backImageUri={card.imageBackUrl || undefined}
      saveLabel="Save Changes"
      onSave={async (fields) => {
        await updateCard(cardId, fields);
      }}
      onRetakePhoto={async (side, localUri) => {
        const previousUrl = side === 'front' ? card.imageUrl : card.imageBackUrl;
        await updateCardImage(cardId, localUri, side, previousUrl || undefined);
      }}
      extraAction={{ label: 'Delete Card', onPress: handleDelete, destructive: true }}
    />
  );
}
