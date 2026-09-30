import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BackupFormatError,
  backupFileName,
  cardsToBackup,
  cardsToCsv,
  cardsToVCard,
  findDuplicates,
  parseBackup,
  parseVCards,
  vCardFileName,
  type Card,
  type CardDraft,
} from '@roloai/shared';
import Button from '../components/Button';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../lib/AuthContext';
import { fetchAllCards, importCards, restoreCards } from '../lib/cards';
import { FILE_UTI, shareTextFile } from '../lib/shareFile';
import { APP_VERSION } from '../lib/version';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const pluralCards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/** Newest first, the order the list and the web exports use. */
const newestFirst = (cards: Card[]) => [...cards].sort((a, b) => b.createdAt - a.createdAt);

/**
 * Account, backup/import/export, and app info.
 *
 * Import is the one bulk-destructive thing here (a restore overwrites by id), so picking a file
 * only parses it; nothing is written until the user has seen the counts and confirmed.
 */
export default function SettingsScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Runs one action with the busy label showing, and turns a throw into the on-screen error. */
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      console.error(`${label} failed:`, e);
      setError(
        e instanceof BackupFormatError
          ? e.message
          : `${label} failed. Check your connection and try again.`
      );
    } finally {
      setBusy(null);
    }
  };

  const handleExport = (format: 'json' | 'vcf' | 'csv') =>
    run('Export', async () => {
      const cards = newestFirst(await fetchAllCards());
      if (!cards.length) {
        setNotice('There are no cards to export yet.');
        return;
      }
      const now = new Date();
      if (format === 'json') {
        await shareTextFile(backupFileName(now), cardsToBackup(cards, now), FILE_UTI.json);
      } else if (format === 'vcf') {
        await shareTextFile(vCardFileName(now), cardsToVCard(cards), FILE_UTI.vcard);
      } else {
        await shareTextFile(`roloai-cards-${now.toISOString().slice(0, 10)}.csv`, cardsToCsv(cards), FILE_UTI.csv);
      }
    });

  const confirm = (title: string, message: string, action: string) =>
    new Promise<boolean>((resolve) => {
      Alert.alert(
        title,
        message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: action, onPress: () => resolve(true) },
        ],
        { onDismiss: () => resolve(false) }
      );
    });

  const handleImport = () =>
    run('Import', async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        // Any type: iOS labels .vcf and .json inconsistently across Files providers, so the
        // filter would hide files the user can see elsewhere. The content decides below.
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const text = await new File(asset.uri).text();

      if (asset.name.toLowerCase().endsWith('.vcf') || text.trimStart().startsWith('BEGIN:VCARD')) {
        await importVCards(asset.name, parseVCards(text));
      } else {
        await restoreBackup(asset.name, parseBackup(text));
      }
    });

  const restoreBackup = async (fileName: string, cards: Card[]) => {
    const ok = await confirm(
      'Restore backup?',
      `${pluralCards(cards.length)} in ${fileName}. Restoring overwrites any card that shares an id with one in the file.`,
      'Restore'
    );
    if (!ok) return;
    const count = await restoreCards(cards);
    setNotice(`Restored ${pluralCards(count)}.`);
  };

  const importVCards = async (fileName: string, drafts: CardDraft[]) => {
    if (!drafts.length) throw new BackupFormatError('No contacts found in that file.');
    // Unlike a backup, a vCard has no ids to match on, so importing twice would double the
    // library. Contacts that look like someone already on file — or an earlier contact in the
    // same file — are skipped; the count is reported so it is not silent.
    const known = await fetchAllCards();
    const fresh: CardDraft[] = [];
    drafts.forEach((draft, i) => {
      if (findDuplicates(draft, known).length) return;
      fresh.push(draft);
      known.push({ ...draft, id: `import-${i}`, createdAt: 0, updatedAt: 0 });
    });
    const skipped = drafts.length - fresh.length;
    if (!fresh.length) {
      setNotice(`Nothing imported: all ${drafts.length} contacts in ${fileName} look like duplicates.`);
      return;
    }
    const ok = await confirm(
      'Import contacts?',
      `${fresh.length} new ${fresh.length === 1 ? 'contact' : 'contacts'} in ${fileName} will be added as cards.` +
        (skipped ? ` ${skipped} skipped as possible duplicates.` : ''),
      'Import'
    );
    if (!ok) return;
    const count = await importCards(fresh);
    setNotice(
      `Imported ${count} ${count === 1 ? 'contact' : 'contacts'}.` +
        (skipped ? ` Skipped ${skipped} possible duplicates.` : '')
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Text style={styles.value}>{user?.email ?? 'Not signed in'}</Text>
        <Text style={styles.hint}>
          This is the account that owns every card. Cards are stored against it, so signing in as
          anyone else shows an empty library rather than this one.
        </Text>
        <Button style={styles.signOutButton} onPress={logout} accessibilityLabel="Sign out">
          <Text style={styles.signOutText}>Sign out</Text>
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My card</Text>
        <Text style={styles.hint}>
          Your own contact details, with a QR code others can scan. Stored on this device only.
        </Text>
        <Button style={styles.actionButton} onPress={() => navigation.navigate('MyCard')}>
          <Text style={styles.actionText}>My Card</Text>
        </Button>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Export and import</Text>
        <Text style={styles.hint}>
          Exports carry links to the card photos rather than the images themselves, so they
          resolve only while you are signed in. The backup restores everything exactly; the
          contacts file opens in Contacts and most CRMs.
        </Text>
        <Button style={styles.actionButton} disabled={!!busy} onPress={() => handleExport('json')}>
          <Text style={styles.actionText}>Export backup (JSON)</Text>
        </Button>
        <Button style={styles.actionButton} disabled={!!busy} onPress={() => handleExport('vcf')}>
          <Text style={styles.actionText}>Export contacts (.vcf)</Text>
        </Button>
        <Button style={styles.actionButton} disabled={!!busy} onPress={() => handleExport('csv')}>
          <Text style={styles.actionText}>Export spreadsheet (.csv)</Text>
        </Button>
        <Button style={styles.actionButton} disabled={!!busy} onPress={handleImport}>
          <Text style={styles.actionText}>Import backup or contacts</Text>
        </Button>
        <Text style={styles.hint}>
          A .json backup restores cards under their original ids, overwriting any card with the
          same id. A .vcf file adds new cards and skips ones that look like duplicates.
        </Text>
        {busy && (
          <View style={styles.progress}>
            <ActivityIndicator size="small" />
            <Text style={styles.hint}>{busy === 'Import' ? 'Importing…' : 'Preparing export…'}</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.value}>RoloAI v{APP_VERSION}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 24 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  value: { fontSize: 17 },
  hint: { color: '#666', fontSize: 14, lineHeight: 20 },
  actionButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  actionText: { fontSize: 16, fontWeight: '600', color: '#0a7cff' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { color: '#c00', fontSize: 14 },
  notice: { color: '#1a7f37', fontSize: 14 },
  signOutButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#c00',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#c00', fontWeight: '600', fontSize: 16 },
});
