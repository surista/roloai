import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { cardToVCard, myCardOf, type Card } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import Button from '../components/Button';
import { saveMyCard, subscribeToCards } from '../lib/cards';
import {
  EMPTY_MY_CARD,
  hasMyCardContent,
  loadLegacyMyCard,
  myCardFromCard,
  myCardToFields,
  type MyCard,
} from '../lib/myCard';
import { presentShareMenu } from '../lib/shareCardImages';

type Props = NativeStackScreenProps<RootStackParamList, 'MyCard'>;

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
 * The owner's own card: a QR code for others to scan, and a share menu for the contact and
 * photos. It is a real card doc (flagged isMine) so it syncs between devices; the list hides it.
 */
export default function MyCardScreen({ navigation }: Props) {
  // undefined until the first snapshot, so the form is not seeded from "no card" before we know.
  const [stored, setStored] = useState<Card | null | undefined>(undefined);
  const [form, setForm] = useState<MyCard>(EMPTY_MY_CARD);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => subscribeToCards((cards) => setStored(myCardOf(cards) ?? null)), []);

  // Seed the form once: from the doc, else from the old local file. Later snapshots (our own
  // save, another device) must not overwrite what is being typed.
  useEffect(() => {
    if (stored === undefined || seeded) return;
    setSeeded(true);
    if (stored) {
      setForm(myCardFromCard(stored));
      return;
    }
    loadLegacyMyCard().then((legacy) => {
      if (legacy) {
        setForm(legacy);
        // Not yet in Firestore: mark dirty so it is clear Save is what moves it there.
        setDirty(true);
      }
    });
  }, [stored, seeded]);

  // A rescan (or an edit on another device) changes the saved card while this screen is open.
  // Follow it unless there are unsaved edits, which must not be overwritten.
  useEffect(() => {
    if (seeded && !dirty && stored) setForm(myCardFromCard(stored));
    // Only the stored card's changes should trigger this, not the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const update = (key: keyof MyCard, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveMyCard(myCardToFields(form, stored ?? undefined), stored?.id);
      setDirty(false);
    } catch (e) {
      console.error('Could not save My Card:', e);
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (stored === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  const canSave = hasMyCardContent(form) && (dirty || !stored);
  // The QR and share act on the saved card, so they never show details that are not saved.
  const vcard = stored && hasMyCardContent(myCardFromCard(stored)) ? cardToVCard({ ...stored, imageUrl: '' }) : '';

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Button
        style={styles.scanButton}
        onPress={() => navigation.navigate('Scan', { mine: true })}
        accessibilityLabel="Scan my card"
      >
        <Text style={styles.scanText}>{stored ? 'Rescan my card' : 'Scan my card'}</Text>
      </Button>
      <Text style={styles.hint}>
        Photograph your business card to fill this in{stored ? ' again (replaces what is saved)' : ''}, or type it below.
      </Text>

      {FIELDS.map(({ key, label, keyboard }) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={styles.input}
            value={form[key]}
            onChangeText={(v) => update(key, v)}
            keyboardType={keyboard}
            autoCapitalize={keyboard ? 'none' : 'sentences'}
            autoCorrect={false}
          />
        </View>
      ))}

      <Button
        style={[styles.saveButton, !canSave && styles.disabled]}
        disabled={!canSave || saving}
        onPress={save}
        accessibilityLabel="Save my card"
      >
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Button>

      {stored && vcard ? (
        <>
          <View style={styles.qr}>
            <QRCode value={vcard} size={220} />
            <Text style={styles.hint}>Others can scan this with their camera to add you.</Text>
          </View>

          <Button
            style={[styles.shareButton, busy && styles.disabled]}
            disabled={busy}
            onPress={() => presentShareMenu(stored, setBusy)}
            accessibilityLabel="Share my card"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>Share my card</Text>}
          </Button>

          <Button
            style={styles.photosButton}
            onPress={() => navigation.navigate('CardDetail', { cardId: stored.id })}
            accessibilityLabel="Add photos of my card"
          >
            <Text style={styles.photosText}>Add photos of my card</Text>
          </Button>
        </>
      ) : (
        <Text style={styles.hint}>Save your details to get a QR code and share your card.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, gap: 10, paddingBottom: 48 },
  hint: { color: '#666', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  qr: { alignItems: 'center', gap: 12, marginVertical: 12 },
  field: { gap: 2 },
  label: { fontSize: 13, color: '#666' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  saveButton: {
    borderWidth: 1,
    borderColor: '#111',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveText: { color: '#111', fontWeight: '700', fontSize: 16 },
  shareButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  scanButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  scanText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  photosButton: { padding: 12, alignItems: 'center' },
  photosText: { color: '#0a7cff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.4 },
  shareText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
