import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Button from '../components/Button';
import {
  EMPTY_MY_CARD,
  hasMyCardContent,
  loadMyCard,
  myCardToVCard,
  saveMyCard,
  type MyCard,
} from '../lib/myCard';
import { FILE_UTI, safeFileName, shareTextFile } from '../lib/shareFile';

const FIELDS: { key: keyof MyCard; label: string; keyboard?: 'phone-pad' | 'email-address' | 'url' }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone', keyboard: 'phone-pad' },
  { key: 'email', label: 'Email', keyboard: 'email-address' },
  { key: 'website', label: 'Website', keyboard: 'url' },
  { key: 'address', label: 'Address' },
];

/**
 * The owner's own card: a QR code for others to scan and a .vcf to send. The details live on
 * this device only (see lib/myCard).
 */
export default function MyCardScreen() {
  const [card, setCard] = useState<MyCard>(EMPTY_MY_CARD);

  useEffect(() => {
    loadMyCard().then(setCard);
  }, []);

  const update = (key: keyof MyCard, value: string) => {
    const next = { ...card, [key]: value };
    setCard(next);
    // Saved as you type: there is no other place these could be lost from, and a Save button
    // would be one more thing to forget before leaving the screen.
    try {
      saveMyCard(next);
    } catch (e) {
      console.warn('Could not save My Card:', e);
    }
  };

  const ready = hasMyCardContent(card);
  const vcard = ready ? myCardToVCard(card) : '';

  const share = async () => {
    try {
      const name = safeFileName(`${card.firstName} ${card.lastName}`);
      await shareTextFile(`${name}.vcf`, vcard, FILE_UTI.vcard);
    } catch (e) {
      console.error('Share failed:', e);
      Alert.alert('Could not share', 'Something went wrong opening the share sheet.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={styles.hint}>
        These details stay on this device. They are not stored in your RoloAI library.
      </Text>

      {ready && (
        <View style={styles.qr}>
          <QRCode value={vcard} size={220} />
          <Text style={styles.hint}>Others can scan this with their camera to add you.</Text>
        </View>
      )}

      {FIELDS.map(({ key, label, keyboard }) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={styles.input}
            value={card[key]}
            onChangeText={(v) => update(key, v)}
            keyboardType={keyboard}
            autoCapitalize={keyboard ? 'none' : 'sentences'}
            autoCorrect={false}
          />
        </View>
      ))}

      <Button
        style={[styles.shareButton, !ready && styles.disabled]}
        disabled={!ready}
        onPress={share}
        accessibilityLabel="Share my card"
      >
        <Text style={styles.shareText}>Share my card</Text>
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10, paddingBottom: 48 },
  hint: { color: '#666', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  qr: { alignItems: 'center', gap: 12, marginVertical: 8 },
  field: { gap: 2 },
  label: { fontSize: 13, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  shareButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  disabled: { opacity: 0.4 },
  shareText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
