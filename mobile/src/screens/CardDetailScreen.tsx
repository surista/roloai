import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, ActionSheetIOS, Alert, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  displayName,
  pairCandidates,
  partnerOf,
  withoutMine,
  type Card,
} from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { useCards } from '../lib/CardsContext';
import { clearMyCard, linkCards, setMyCard, unlinkCards, updateCard } from '../lib/cards';
import { presentShareMenu } from '../lib/shareCardImages';
import {
  addToContacts,
  call,
  email,
  message,
  openMap,
  openUrl,
  openWebsite,
} from '../lib/contactActions';
import { mailtoUrl, smsUrl, telUrl } from '@roloai/shared';
import { confirmDelete } from '../lib/deleteFlow';
import { cancelFollowUp, followUpMorning, RemindersDenied, scheduleFollowUp } from '../lib/reminders';
import { haptics } from '../lib/haptics';
import Button from '../components/Button';
import ImageViewerModal from '../components/ImageViewerModal';
import { colors, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A card, read-only, laid out like a contact in Contacts: who they are, buttons to reach them,
 * then their details as tappable rows. Editing is a separate sheet (Edit, top right) — the old
 * screen was an always-editable form, which made every tap on a phone number a text edit and
 * offered no way to actually call it.
 */
export default function CardDetailScreen({ route, navigation }: Props) {
  const { cardId } = route.params;
  const { all: allCards, loaded } = useCards();
  const card = useMemo(() => allCards.find((c) => c.id === cardId) ?? null, [allCards, cardId]);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const { partner, candidates } = useMemo(() => {
    if (!card) return { partner: undefined, candidates: [] as Card[] };
    const byId = new Map(allCards.map((c) => [c.id, c]));
    return {
      partner: partnerOf(card, byId),
      candidates: card.isMine ? [] : pairCandidates(card, withoutMine(allCards)),
    };
  }, [card, allCards]);

  useLayoutEffect(() => {
    if (!card) return;
    navigation.setOptions({
      unstable_headerRightItems: () => [
        {
          type: 'button',
          label: 'Share',
          icon: { type: 'sfSymbol', name: 'square.and.arrow.up' },
          disabled: sharing,
          onPress: () => presentShareMenu(card, setSharing),
          accessibilityLabel: 'Share',
        },
        {
          type: 'button',
          label: 'Edit',
          onPress: () => navigation.navigate('EditCard', { cardId: card.id }),
        },
      ],
    });
  }, [navigation, card, sharing]);

  if (!card) {
    return (
      <View style={styles.center}>
        {loaded ? <Text style={styles.secondary}>This card was deleted.</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      console.error('Card update failed:', e);
      Alert.alert('Couldn’t Update Card', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string, what: string) => {
    void Clipboard.setStringAsync(value);
    haptics.success();
    Alert.alert(`${what} Copied`);
  };

  /** Long-press on a value row: the actions Contacts offers there. */
  const rowMenu = (value: string, what: string, extra: { label: string; run: () => void }[] = []) => () => {
    const options = [...extra, { label: `Copy ${what}`, run: () => copy(value, what) }];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: value, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length },
      (i) => options[i]?.run()
    );
  };

  const setFollowUp = () => {
    const choices: { label: string; days?: number }[] = [
      { label: 'Tomorrow', days: 1 },
      { label: 'In 3 Days', days: 3 },
      { label: 'Next Week', days: 7 },
      { label: 'In 2 Weeks', days: 14 },
      { label: 'In a Month', days: 30 },
    ];
    const hasOne = Boolean(card.followUpAt);
    const labels = [...choices.map((c) => c.label), ...(hasOne ? ['Remove Reminder'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Follow Up',
        message: 'You’ll get a reminder at 9 AM on the day.',
        options: labels,
        destructiveButtonIndex: hasOne ? choices.length : undefined,
        cancelButtonIndex: labels.length - 1,
      },
      (i) => {
        if (i < choices.length) {
          const when = followUpMorning(choices[i].days!);
          void run(async () => {
            try {
              await scheduleFollowUp(card, when);
            } catch (e) {
              if (e instanceof RemindersDenied) {
                Alert.alert(
                  'Notifications Are Off',
                  'The follow-up date is saved, but RoloAI can’t remind you. Turn on notifications in Settings.',
                  [{ text: 'OK' }, { text: 'Settings', onPress: () => void Linking.openSettings() }]
                );
              } else throw e;
            }
            await updateCard(card.id, { followUpAt: when.getTime() });
            haptics.success();
          });
        } else if (hasOne && i === choices.length) {
          void run(async () => {
            await cancelFollowUp(card.id);
            await updateCard(card.id, { followUpAt: undefined });
          });
        }
      }
    );
  };

  const subtitle = [card.jobTitle, card.company].filter(Boolean).join(' · ');
  const images = [
    card.imageUrl && { uri: card.imageUrl, label: 'Front' },
    card.imageBackUrl && { uri: card.imageBackUrl, label: 'Back' },
  ].filter((i): i is { uri: string; label: string } => Boolean(i));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <View style={styles.hero}>
        {images[0] ? (
          <Button
            hitSlop={undefined}
            onPress={() => setViewerIndex(0)}
            accessibilityRole="imagebutton"
            accessibilityLabel="Front of card"
            accessibilityHint="Opens the photo full screen"
          >
            <Image source={{ uri: card.thumbUrl || card.imageUrl }} style={styles.heroImage} contentFit="contain" transition={150} cachePolicy="memory-disk" />
          </Button>
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder]}>
            <SymbolView name="person.text.rectangle" size={44} tintColor={colors.tertiaryLabel} />
          </View>
        )}
        <Text style={styles.name} accessibilityRole="header">
          {displayName(card)}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.actions}>
        <ActionButton symbol="message.fill" label="message" disabled={!card.phones.some((p) => smsUrl(p.number))} onPress={() => void message(card)} />
        <ActionButton symbol="phone.fill" label="call" disabled={!card.phones.some((p) => telUrl(p.number))} onPress={() => void call(card)} />
        <ActionButton symbol="envelope.fill" label="mail" disabled={!card.emails.some((e) => mailtoUrl(e.address))} onPress={() => void email(card)} />
        <ActionButton symbol="person.crop.circle.badge.plus" label="contacts" onPress={() => void addToContacts(card)} />
      </View>

      {card.phones.length > 0 && (
        <Group>
          {card.phones.map((p, i) => (
            <ValueRow
              key={`p${i}`}
              first={i === 0}
              label={p.label}
              value={p.number}
              onPress={() => void openUrl(telUrl(p.number))}
              onLongPress={rowMenu(p.number, 'Number', [{ label: 'Send Message', run: () => void openUrl(smsUrl(p.number)) }])}
              hint="Calls this number"
            />
          ))}
        </Group>
      )}

      {card.emails.length > 0 && (
        <Group>
          {card.emails.map((e, i) => (
            <ValueRow
              key={`e${i}`}
              first={i === 0}
              label={e.label}
              value={e.address}
              onPress={() => void openUrl(mailtoUrl(e.address))}
              onLongPress={rowMenu(e.address, 'Email')}
              hint="Writes an email"
            />
          ))}
        </Group>
      )}

      {(card.website || card.address) && (
        <Group>
          {card.website ? (
            <ValueRow first label="website" value={card.website} onPress={() => void openWebsite(card)} onLongPress={rowMenu(card.website, 'Website')} hint="Opens in Safari" />
          ) : null}
          {card.address ? (
            <ValueRow first={!card.website} label="address" value={card.address} onPress={() => void openMap(card)} onLongPress={rowMenu(card.address, 'Address')} hint="Opens in Maps" />
          ) : null}
        </Group>
      )}

      <Group>
        <ValueRow first label="added" value={dateFormat.format(card.createdAt)} plain />
        {card.event ? <ValueRow label="met at" value={card.event} plain /> : null}
        {card.metPlace ? (
          <ValueRow
            label="where"
            value={card.metPlace}
            onPress={() =>
              void openUrl(
                card.metLocation
                  ? `https://maps.apple.com/?ll=${card.metLocation.lat},${card.metLocation.lng}&q=${encodeURIComponent(card.metPlace!)}`
                  : `https://maps.apple.com/?q=${encodeURIComponent(card.metPlace!)}`
              )
            }
            hint="Opens in Maps"
          />
        ) : null}
        <ValueRow
          label="follow up"
          value={card.followUpAt ? dateTimeFormat.format(card.followUpAt) : 'Add Reminder'}
          onPress={setFollowUp}
          hint="Sets a follow-up reminder"
          muted={!card.followUpAt}
        />
      </Group>

      {(card.tags.length > 0 || card.notes) && (
        <Group>
          {card.tags.length > 0 ? <ValueRow first label="tags" value={card.tags.map((t) => `#${t}`).join('  ')} plain /> : null}
          {card.notes ? <ValueRow first={!card.tags.length} label="notes" value={card.notes} plain selectable /> : null}
        </Group>
      )}

      {images.length > 0 && (
        <View>
          <Text style={styles.groupHeader}>Photos</Text>
          <View style={styles.photos}>
            {images.map((img, i) => (
              <Button
                key={img.label}
                style={styles.photoTile}
                hitSlop={undefined}
                onPress={() => setViewerIndex(i)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${img.label} of card`}
              >
                <Image source={{ uri: img.uri }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                <Text style={styles.photoLabel}>{img.label}</Text>
              </Button>
            ))}
          </View>
        </View>
      )}

      {(partner || candidates.length > 0) && (
        <Group>
          {partner ? (
            <>
              <ValueRow first label="also on file" value={displayName(partner)} onPress={() => navigation.push('CardDetail', { cardId: partner.id })} hint="Opens the linked card" chevron />
              <LinkRow label="Unlink Cards" disabled={busy} onPress={() => void run(() => unlinkCards(card.id, partner.id))} />
            </>
          ) : (
            candidates.slice(0, 3).map((other, i) => (
              <LinkRow
                key={other.id}
                first={i === 0}
                label={`Link with ${displayName(other)}`}
                footnote="Looks like the same person"
                disabled={busy}
                onPress={() => void run(() => linkCards(card.id, other.id))}
              />
            ))
          )}
        </Group>
      )}

      <Group>
        <LinkRow first label={card.isMine ? 'Stop Using as My Card' : 'Use as My Card'} disabled={busy} onPress={() => void run(() => (card.isMine ? clearMyCard(card.id) : setMyCard(card.id)))} />
        <LinkRow label={sharing ? 'Preparing Photos…' : 'Share Card'} disabled={sharing} onPress={() => presentShareMenu(card, setSharing)} />
      </Group>

      <Group>
        <LinkRow first label="Delete Card" destructive onPress={() => confirmDelete(card, () => navigation.popToTop())} />
      </Group>

      <ImageViewerModal visible={viewerIndex !== null} images={images} initialIndex={viewerIndex ?? 0} onClose={() => setViewerIndex(null)} />
    </ScrollView>
  );
}

function ActionButton(props: { symbol: SFSymbol; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Button
      style={styles.actionButton}
      hitSlop={undefined}
      disabled={props.disabled}
      onPress={props.onPress}
      accessibilityLabel={props.label}
    >
      <SymbolView name={props.symbol} size={22} tintColor={props.disabled ? colors.tertiaryLabel : colors.tint} />
      <Text style={[styles.actionLabel, props.disabled && styles.actionLabelDisabled]}>{props.label}</Text>
    </Button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

function ValueRow(props: {
  label: string;
  value: string;
  first?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  hint?: string;
  plain?: boolean;
  muted?: boolean;
  selectable?: boolean;
  chevron?: boolean;
}) {
  const content = (
    <>
      <Text style={styles.rowLabel}>{props.label}</Text>
      <Text
        style={[styles.rowValue, !props.plain && styles.rowValueAction, props.muted && styles.rowValueMuted]}
        selectable={props.selectable}
      >
        {props.value}
      </Text>
    </>
  );
  const style = [styles.row, !props.first && styles.rowSeparator];
  if (!props.onPress) return <View style={style} accessible accessibilityLabel={`${props.label}, ${props.value}`}>{content}</View>;
  return (
    <Button
      style={[style, props.chevron && styles.rowWithChevron]}
      pressedStyle={styles.rowPressed}
      hitSlop={undefined}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      accessibilityLabel={`${props.label}, ${props.value}`}
      accessibilityHint={props.hint}
    >
      <View style={{ flex: 1 }}>{content}</View>
      {props.chevron && <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />}
    </Button>
  );
}

function LinkRow(props: { label: string; first?: boolean; destructive?: boolean; disabled?: boolean; footnote?: string; onPress: () => void }) {
  return (
    <Button
      style={[styles.linkRow, !props.first && styles.rowSeparator]}
      pressedStyle={styles.rowPressed}
      hitSlop={undefined}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={[styles.linkText, props.destructive && styles.destructive]}>{props.label}</Text>
      {props.footnote ? <Text style={styles.footnote}>{props.footnote}</Text> : null}
    </Button>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground },
  container: { padding: 16, gap: 20, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground },
  secondary: { ...type.body, color: colors.secondaryLabel },
  hero: { alignItems: 'center', gap: 6 },
  heroImage: { width: 240, height: 145, borderRadius: 10, marginBottom: 8 },
  heroPlaceholder: { backgroundColor: colors.tertiaryFill, alignItems: 'center', justifyContent: 'center' },
  name: { ...type.title2, color: colors.label, textAlign: 'center' },
  subtitle: { ...type.subheadline, color: colors.secondaryLabel, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cell,
  },
  actionLabel: { ...type.caption, color: colors.tint },
  actionLabelDisabled: { color: colors.tertiaryLabel },
  group: { backgroundColor: colors.cell, borderRadius: 10, overflow: 'hidden' },
  groupHeader: { ...type.footnote, color: colors.secondaryLabel, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 },
  row: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  rowWithChevron: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowPressed: { backgroundColor: colors.fill },
  rowLabel: { ...type.subheadline, color: colors.label },
  rowValue: { ...type.body, color: colors.label, marginTop: 2 },
  rowValueAction: { color: colors.tint },
  rowValueMuted: { color: colors.tint },
  linkRow: { paddingHorizontal: 16, paddingVertical: 11, minHeight: 44, justifyContent: 'center' },
  linkText: { ...type.body, color: colors.tint },
  destructive: { color: colors.destructive },
  footnote: { ...type.footnote, color: colors.secondaryLabel, marginTop: 2 },
  photos: { flexDirection: 'row', gap: 12 },
  photoTile: { flex: 1, gap: 4 },
  photo: { width: '100%', aspectRatio: 91 / 55, borderRadius: 8, backgroundColor: colors.tertiaryFill },
  photoLabel: { ...type.footnote, color: colors.secondaryLabel, textAlign: 'center' },
});
