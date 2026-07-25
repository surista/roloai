import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import CardForm from '../components/CardForm';
import { createCard } from '../lib/cards';

type Props = NativeStackScreenProps<RootStackParamList, 'ReviewEdit'>;

export default function ReviewEditScreen({ route, navigation }: Props) {
  const { draft, localImageUri, localBackImageUri } = route.params;

  return (
    <CardForm
      draft={draft}
      imageUri={localImageUri}
      backImageUri={localBackImageUri}
      saveLabel="Save Card"
      onSave={async (fields) => {
        await createCard(
          { ...fields, imageUrl: '', source: draft.source, rawOcrText: draft.rawOcrText },
          localImageUri,
          localBackImageUri
        );
        navigation.popToTop();
      }}
    />
  );
}
