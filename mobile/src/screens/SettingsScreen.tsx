import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActionSheetIOS,
  ActivityIndicator,
  Linking,
  Switch,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BackupFormatError,
  backupFileName,
  cardsToBackup,
  cardsToCsv,
  cardsToVCard,
  findDuplicates,
  withoutMine,
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
import { setPreference, usePreferences } from '../lib/preferences';
import { requestLocationPermission } from '../lib/location';
import { haptics } from '../lib/haptics';
import { APP_VERSION } from '../lib/version';
import { colors, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const pluralCards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/** Newest first, the order the list and the web exports use. */
const newestFirst = (cards: Card[]) => [...cards].sort((a, b) => b.createdAt - a.createdAt);

/**
 * Account, capture options, backup/import/export, and app info — in the iOS inset-grouped style.
 *
 * Import is the one bulk-destructive thing here (a restore overwrites by id), so picking a file
 * only parses it; nothing is written until the user has seen the counts and confirmed.
 */
export default function SettingsScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const prefs = usePreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      console.error(`${label} failed:`, e);
      haptics.error();
      setError(e instanceof BackupFormatError ? e.message : `${label} failed. Check your connection and try again.`);
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
      if (format === 'json') await shareTextFile(backupFileName(now), cardsToBackup(cards, now), FILE_UTI.json);
      else if (format === 'vcf') await shareTextFile(vCardFileName(now), cardsToVCard(cards), FILE_UTI.vcard);
      else await shareTextFile(`roloai-cards-${now.toISOString().slice(0, 10)}.csv`, cardsToCsv(cards), FILE_UTI.csv);
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
        // Any type: iOS labels .vcf and .json inconsistently across Files providers.
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
      'Restore Backup?',
      `${pluralCards(cards.length)} in ${fileName}. Restoring overwrites any card that shares an id with one in the file.`,
      'Restore'
    );
    if (!ok) return;
    const count = await restoreCards(cards);
    haptics.success();
    setNotice(`Restored ${pluralCards(count)}.`);
  };

  const importVCards = async (fileName: string, drafts: CardDraft[]) => {
    if (!drafts.length) throw new BackupFormatError('No contacts found in that file.');
    // A vCard has no ids to match on, so contacts that look like someone already on file — or an
    // earlier contact in the same file — are skipped, and the count is reported.
    const known = withoutMine(await fetchAllCards());
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
      'Import Contacts?',
      `${fresh.length} new ${fresh.length === 1 ? 'contact' : 'contacts'} in ${fileName} will be added as cards.` +
        (skipped ? ` ${skipped} skipped as possible duplicates.` : ''),
      'Import'
    );
    if (!ok) return;
    const count = await importCards(fresh);
    haptics.success();
    setNotice(`Imported ${count} ${count === 1 ? 'contact' : 'contacts'}.` + (skipped ? ` Skipped ${skipped} possible duplicates.` : ''));
  };

  /** The system permission prompt is tied to this switch, so it always appears in context. */
  const toggleLocation = async (on: boolean) => {
    if (!on) return setPreference('recordLocation', false);
    const { granted, canAskAgain } = await requestLocationPermission();
    if (granted) {
      await setPreference('recordLocation', true);
      haptics.success();
    } else if (!canAskAgain) {
      Alert.alert('Location Is Off', 'To record where you meet people, allow location for RoloAI in Settings.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
    }
  };

  const handleSignOut = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Sign out of RoloAI?',
        message: 'Your cards stay in your account. Scans waiting to be read stay on this iPhone.',
        options: ['Sign Out', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => {
        if (i === 0) void logout();
      }
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <Group header="Account" footer="Every card is stored against this account and syncs to your other devices and the web app.">
        <Row first symbol="person.crop.circle.fill" symbolBg={colors.tint} label={user?.email ?? 'Not signed in'} />
      </Group>

      <Group header="My Card" footer="Your own details, with a QR code others can scan. Synced with your account.">
        <Row first symbol="person.text.rectangle.fill" symbolBg={colors.success} label="My Card" chevron onPress={() => navigation.navigate('MyCard')} />
      </Group>

      <Group
        header="Scanning"
        footer="Records the place each card was scanned — “Shibuya, Tokyo” — so you can remember where you met. Location is used only at the moment of scanning."
      >
        <Row first symbol="location.fill" symbolBg={colors.tint} label="Record Where I Meet People">
          <Switch
            value={prefs?.recordLocation ?? false}
            onValueChange={(v) => void toggleLocation(v)}
            accessibilityLabel="Record where I meet people"
          />
        </Row>
      </Group>

      <Group
        header="Shortcuts"
        footer="Touch and hold the RoloAI icon on the Home Screen for Scan Card. In the Shortcuts app, an “Open URL” action with roloai://scan opens the scanner from Siri, the Action button or a widget."
      >
        <Row first symbol="bolt.fill" symbolBg={colors.warning} label="Open Shortcuts" chevron onPress={() => void Linking.openURL('shortcuts://')} />
      </Group>

      <Group
        header="Export and Import"
        footer="Exports link to the card photos rather than containing them, so the links work only while you’re signed in. A .json backup restores cards exactly, overwriting any with the same id; a .vcf file adds new cards and skips likely duplicates."
      >
        <Row first symbol="externaldrive.fill" symbolBg={colors.tint} label="Export Backup (.json)" disabled={!!busy} onPress={() => handleExport('json')} />
        <Row symbol="person.2.fill" symbolBg={colors.tint} label="Export Contacts (.vcf)" disabled={!!busy} onPress={() => handleExport('vcf')} />
        <Row symbol="tablecells.fill" symbolBg={colors.success} label="Export Spreadsheet (.csv)" disabled={!!busy} onPress={() => handleExport('csv')} />
        <Row symbol="square.and.arrow.down.fill" symbolBg={colors.warning} label="Import Backup or Contacts" disabled={!!busy} onPress={handleImport} />
      </Group>

      {(busy || error || notice) && (
        <View style={styles.status} accessibilityLiveRegion="polite">
          {busy && <ActivityIndicator size="small" />}
          {busy && <Text style={styles.footer}>{busy === 'Import' ? 'Importing…' : 'Preparing export…'}</Text>}
          {error && <Text style={[styles.footer, { color: colors.destructive }]}>{error}</Text>}
          {notice && <Text style={[styles.footer, { color: colors.success }]}>{notice}</Text>}
        </View>
      )}

      <Group header="About">
        <Row first label="Version" detail={APP_VERSION} />
      </Group>

      <Group>
        <Button style={styles.signOut} pressedStyle={styles.rowPressed} hitSlop={undefined} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Button>
      </Group>
    </ScrollView>
  );
}

function Group({ header, footer, children }: { header?: string; footer?: string; children: React.ReactNode }) {
  return (
    <View>
      {header && (
        <Text style={styles.header} accessibilityRole="header">
          {header}
        </Text>
      )}
      <View style={styles.group}>{children}</View>
      {footer && <Text style={[styles.footer, styles.footerSpacing]}>{footer}</Text>}
    </View>
  );
}

function Row(props: {
  label: string;
  first?: boolean;
  symbol?: SFSymbol;
  symbolBg?: typeof colors.tint;
  detail?: string;
  chevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const content = (
    <>
      {props.symbol && (
        <View style={[styles.icon, { backgroundColor: props.symbolBg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SymbolView name={props.symbol} size={16} tintColor={colors.onTint} />
        </View>
      )}
      <View style={[styles.rowInner, !props.first && styles.rowSeparator]}>
        <Text style={[styles.rowLabel, props.onPress && !props.chevron && styles.rowAction]} numberOfLines={2}>
          {props.label}
        </Text>
        {props.detail && <Text style={styles.detail}>{props.detail}</Text>}
        {props.children}
        {props.chevron && <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />}
      </View>
    </>
  );
  if (!props.onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Button style={styles.row} pressedStyle={styles.rowPressed} hitSlop={undefined} disabled={props.disabled} onPress={props.onPress}>
      {content}
    </Button>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground },
  container: { padding: 16, gap: 24, paddingBottom: 48 },
  header: { ...type.footnote, color: colors.secondaryLabel, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 },
  footer: { ...type.footnote, color: colors.secondaryLabel },
  footerSpacing: { marginHorizontal: 16, marginTop: 6 },
  group: { backgroundColor: colors.cell, borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 44 },
  rowPressed: { backgroundColor: colors.fill },
  rowInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingRight: 16, paddingVertical: 8, marginLeft: 0 },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  icon: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowLabel: { ...type.body, color: colors.label, flex: 1 },
  rowAction: { color: colors.tint },
  detail: { ...type.body, color: colors.secondaryLabel },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' },
  signOut: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  signOutText: { ...type.body, color: colors.destructive },
});
