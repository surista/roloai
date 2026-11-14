import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useCards } from '../lib/CardsContext';
import { updateCard, updateCardImage } from '../lib/cards';
import { confirmNoDuplicate } from '../lib/duplicateCheck';
import { confirmDelete } from '../lib/deleteFlow';
import CardForm from '../components/CardForm';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EditCard'>;

/** Contacts' Edit sheet: Cancel / Done in the bar, photos replaceable, Delete at the bottom. */
export default function EditCardScreen({ route, navigation }: Props) {
  const { cardId } = route.params;
  const { all } = useCards();
  const card = useMemo(() => all.find((c) => c.id === cardId), [all, cardId]);
  // Seeded once: a snapshot arriving mid-edit (our own retake, another device) must not reset
  // what is being typed.
  const draft = useMemo(() => card, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!card || !draft) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <CardForm
      draft={draft}
      imageUri={card.imageUrl || undefined}
      backImageUri={card.imageBackUrl || undefined}
      saveLabel="Done"
      showCancel
      onSave={async (fields) => {
        await confirmNoDuplicate(
          fields,
          (existingId) => {
            navigation.goBack();
            navigation.push('CardDetail', { cardId: existingId });
          },
          cardId
        );
        await updateCard(cardId, fields);
      }}
      onSaved={() => navigation.goBack()}
      onRetakePhoto={async (side, localUri) => {
        await updateCardImage(
          cardId,
          localUri,
          side,
          (side === 'front' ? card.imageUrl : card.imageBackUrl) || undefined,
          side === 'front' ? card.thumbUrl : undefined
        );
      }}
      footerActions={[
        {
          label: 'Delete Card',
          destructive: true,
          onPress: () => confirmDelete(card, () => navigation.popToTop()),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground },
});
