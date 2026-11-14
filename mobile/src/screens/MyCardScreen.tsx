import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { cardToVCard, type Card } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import Button from '../components/Button';
import { saveMyCard } from '../lib/cards';
import { useCards } from '../lib/CardsContext';
import {
  EMPTY_MY_CARD,
  hasMyCardContent,
  loadLegacyMyCard,
  myCardFromCard,
  myCardToFields,
  type MyCard,
} from '../lib/myCard';
import { presentShareMenu } from '../lib/shareCardImages';
import { haptics } from '../lib/haptics';
import { colors, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MyCard'>;

const FIELDS: { key: keyof MyCard; label: string; keyboard?: 'phone-pad' | 'email-address' | 'url' }[] = [
  { key: 'firstName', label: 'First' },
  { key: 'lastName', label: 'Last' },
  { key: 'jobTitle', label: 'Title' },
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
  const { myCard, loaded } = useCards();
  const stored: Card | null | undefined = loaded ? (myCard ?? null) : undefined;
  const [form, setForm] = useState<MyCard>(EMPTY_MY_CARD);
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

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
      haptics.success();
    } catch (e) {
      console.error('Could not save My Card:', e);
      haptics.error();
      Alert.alert('Couldn’t Save', 'Check your connection and try again.');
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
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {stored && vcard ? (
        <View style={styles.qr}>
          {/* Always dark-on-white: scanners read inverted codes poorly, so this doesn't follow Dark Mode. */}
          <View style={styles.qrTile} accessible accessibilityRole="image" accessibilityLabel="QR code with your contact details">
            <QRCode value={vcard} size={220} />
          </View>
          <Text style={styles.hint}>Others can scan this with their camera to add you.</Text>
          <Button
            style={[styles.shareButton, busy && styles.disabled]}
            disabled={busy}
            onPress={() => presentShareMenu(stored, setBusy)}
            accessibilityLabel="Share my card"
          >
            {busy ? <ActivityIndicator color={colors.onTint} /> : <Text style={styles.shareText}>Share My Card</Text>}
          </Button>
        </View>
      ) : null}

      <View style={styles.group}>
        {FIELDS.map(({ key, label, keyboard }, i) => (
          <View key={key} style={[styles.row, i > 0 && styles.rowSeparator]}>
            <Text style={styles.rowLabel} accessibilityElementsHidden importantForAccessibility="no">
              {label}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={label}
              placeholderTextColor={colors.placeholder}
              accessibilityLabel={label}
              value={form[key]}
              onChangeText={(v) => update(key, v)}
              keyboardType={keyboard}
              autoCapitalize={keyboard ? 'none' : 'words'}
              autoCorrect={false}
              textContentType="none"
            />
          </View>
        ))}
      </View>

      <Button
        style={[styles.groupButton, !canSave && styles.disabled]}
        disabled={!canSave || saving}
        onPress={save}
        accessibilityLabel="Save my card"
      >
        {saving ? <ActivityIndicator /> : <Text style={styles.groupButtonText}>Save</Text>}
      </Button>
      {stored && vcard ? null : (
        <Text style={styles.footnote}>Save your details to get a QR code and share your card.</Text>
      )}

      <View style={styles.group}>
        <Button
          style={styles.groupRow}
          onPress={() => navigation.navigate('Scan', { mine: true })}
          accessibilityLabel={stored ? 'Rescan my card' : 'Scan my card'}
        >
          <Text style={styles.groupButtonText}>{stored ? 'Rescan My Card' : 'Scan My Card'}</Text>
        </Button>
        {stored ? (
          <Button
            style={[styles.groupRow, styles.rowSeparator]}
            onPress={() => navigation.navigate('CardDetail', { cardId: stored.id })}
            accessibilityLabel="Add photos of my card"
          >
            <Text style={styles.groupButtonText}>Add Photos of My Card</Text>
          </Button>
        ) : null}
      </View>
      <Text style={styles.footnote}>
        Photograph your business card to fill this in{stored ? ' again (replaces what is saved)' : ''}.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground },
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  hint: { ...type.subheadline, color: colors.secondaryLabel, textAlign: 'center' },
  footnote: { ...type.footnote, color: colors.secondaryLabel, marginHorizontal: 16, marginTop: -4, marginBottom: 8 },
  qr: { alignItems: 'center', gap: 12, marginBottom: 12 },
  qrTile: { padding: 16, backgroundColor: '#fff', borderRadius: 16 },
  group: { backgroundColor: colors.cell, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 16, paddingRight: 12, gap: 10 },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowLabel: { ...type.body, color: colors.label, width: 82 },
  input: { ...type.body, color: colors.label, flex: 1, paddingVertical: 11 },
  groupRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  groupButton: { backgroundColor: colors.cell, borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  groupButtonText: { ...type.body, color: colors.tint },
  shareButton: {
    alignSelf: 'stretch',
    backgroundColor: colors.tint,
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  shareText: { ...type.headline, color: colors.onTint },
});
