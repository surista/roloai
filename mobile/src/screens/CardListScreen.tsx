import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SectionList, StyleSheet, type GestureResponderEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { MenuView } from '@react-native-menu/menu';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  CARD_SORT_OPTIONS,
  allTags,
  cardThumbUrl,
  companyCounts,
  displayName,
  filterCards,
  groupPairs,
  mailtoUrl,
  sortCards,
  telUrl,
  type Card,
  type CardSort,
  type ListEntry,
} from '@roloai/shared';
import Button from '../components/Button';
import type { RootStackParamList } from '../navigation/types';
import { useCards } from '../lib/CardsContext';
import { listQueuedScans, oldestEntry, queuedScanUris, type QueuedScan } from '../lib/scanQueue';
import { subscribeToQueue } from '../lib/queueReader';
import { addToContacts, call, email, message } from '../lib/contactActions';
import { presentShareMenu } from '../lib/shareCardImages';
import { confirmDelete } from '../lib/deleteFlow';
import { haptics } from '../lib/haptics';
import { colors, type } from '../theme';

/** How many companies the filter menu lists; the rest are reachable by searching. */
const TOP_COMPANIES = 12;

type Props = NativeStackScreenProps<RootStackParamList, 'CardList'>;

interface Section {
  title: string;
  data: ListEntry[];
}

/** The letter a card files under for an alphabetical sort; anything non-Latin files under "#". */
function sectionKey(card: Card, sort: CardSort): string {
  const source = sort === 'firstName' ? card.firstName : sort === 'lastName' ? card.lastName : card.company;
  const letter = (source ?? '').trim().charAt(0).toLocaleUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
}

export default function CardListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  // The owner's own card (isMine) is kept out of the library: it is reached from My Card.
  const { cards, loaded, error } = useCards();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CardSort>('recent');
  const [tag, setTag] = useState<string | undefined>();
  const [company, setCompany] = useState<string | undefined>();
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const listRef = useRef<SectionList<ListEntry, Section>>(null);
  const pendingSection = useRef<number | null>(null);
  const retries = useRef(0);
  const scrollToSection = (i: number) => {
    if (pendingSection.current !== i) retries.current = 0;
    pendingSection.current = i;
    listRef.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewOffset: 0, animated: false });
  };

  // Refreshed on focus and whenever the background reader finishes one.
  useFocusEffect(
    useCallback(() => {
      const refresh = () => listQueuedScans().then(setQueue, () => setQueue([]));
      refresh();
      return subscribeToQueue(refresh);
    }, [])
  );

  const readQueued = () => {
    const entry = oldestEntry(queue);
    if (!entry) return;
    const uris = queuedScanUris(entry);
    // A scan the background reader already read opens with its details filled in.
    navigation.navigate(
      'ReviewEdit',
      entry.draft
        ? { draft: entry.draft, localImageUri: uris.frontUri, localBackImageUri: uris.backUri, queuedId: entry.id }
        : { scan: uris, queuedId: entry.id }
    );
  };

  const tags = useMemo(() => allTags(cards), [cards]);
  const companies = useMemo(() => companyCounts(cards).slice(0, TOP_COMPANIES), [cards]);
  const filtering = Boolean(search.trim() || tag || company);

  const { sections, matchCount } = useMemo(() => {
    const matches = filterCards(cards, { search, tag, company });
    const matchIds = new Set(matches.map((c) => c.id));
    // Pair up the *whole* sorted library and filter the rows afterwards: filtering first would
    // drop one half of a pair whenever only it matched and show the other as if it had no partner.
    const entries = groupPairs(sortCards(cards, sort)).filter(
      ({ card, partner }) => matchIds.has(card.id) || (partner && matchIds.has(partner.id))
    );
    if (sort === 'recent') return { sections: [{ title: '', data: entries }], matchCount: matches.length };
    const byKey = new Map<string, ListEntry[]>();
    for (const entry of entries) {
      const key = sectionKey(entry.card, sort);
      byKey.set(key, [...(byKey.get(key) ?? []), entry]);
    }
    return {
      sections: [...byKey].map(([title, data]) => ({ title, data })),
      matchCount: matches.length,
    };
  }, [cards, search, tag, company, sort]);

  const clearFilters = () => {
    setTag(undefined);
    setCompany(undefined);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      // The system search bar, which collapses under the large title as Contacts' does.
      headerSearchBarOptions: {
        placeholder: 'Search',
        // Under the large title, as in Contacts. On iOS 26 the default puts it in the bottom
        // toolbar, where it collides with the floating Scan Card button.
        placement: 'stacked',
        autoCapitalize: 'none',
        onChangeText: (e) => setSearch(e.nativeEvent.text),
        onCancelButtonPress: () => setSearch(''),
      },
      unstable_headerRightItems: () => [
        {
          type: 'menu',
          label: 'Sort and Filter',
          icon: {
            type: 'sfSymbol',
            name: tag || company ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease.circle',
          },
          accessibilityLabel: 'Sort and filter',
          menu: {
            items: [
              {
                type: 'submenu',
                label: 'Sort By',
                inline: true,
                items: CARD_SORT_OPTIONS.map((option) => ({
                  type: 'action' as const,
                  label: option.label,
                  state: sort === option.value ? ('on' as const) : ('off' as const),
                  onPress: () => setSort(option.value),
                })),
              },
              ...(tags.length
                ? [
                    {
                      type: 'submenu' as const,
                      label: tag ? `Tag: ${tag}` : 'Tag',
                      icon: { type: 'sfSymbol' as const, name: 'number' as const },
                      items: tags.map((t) => ({
                        type: 'action' as const,
                        label: `#${t}`,
                        state: tag === t ? ('on' as const) : ('off' as const),
                        onPress: () => setTag(tag === t ? undefined : t),
                      })),
                    },
                  ]
                : []),
              ...(companies.length
                ? [
                    {
                      type: 'submenu' as const,
                      label: company ? `Company: ${company}` : 'Company',
                      icon: { type: 'sfSymbol' as const, name: 'building.2' as const },
                      items: companies.map((c) => ({
                        type: 'action' as const,
                        label: c.company,
                        description: `${c.count} ${c.count === 1 ? 'card' : 'cards'}`,
                        state: company === c.company ? ('on' as const) : ('off' as const),
                        onPress: () => setCompany(company === c.company ? undefined : c.company),
                      })),
                    },
                  ]
                : []),
              ...(tag || company
                ? [{ type: 'action' as const, label: 'Clear Filters', destructive: true, onPress: clearFilters }]
                : []),
            ],
          },
        },
        {
          type: 'button',
          label: 'My Card',
          icon: { type: 'sfSymbol', name: 'person.text.rectangle' },
          onPress: () => navigation.navigate('MyCard'),
          accessibilityLabel: 'My Card',
        },
        {
          type: 'button',
          label: 'Settings',
          icon: { type: 'sfSymbol', name: 'gearshape' },
          onPress: () => navigation.navigate('Settings'),
          accessibilityLabel: 'Settings',
        },
      ],
    });
  }, [navigation, sort, tag, company, tags, companies]);

  const readyCount = queue.filter((q) => q.draft).length;

  const listHeader = (
    <View style={styles.headerStack}>
      {error && (
        <Banner
          symbol="exclamationmark.triangle.fill"
          tint={colors.warning}
          text="Can’t reach your cards. Check your connection — changes will sync when it’s back."
        />
      )}
      {queue.length > 0 && (
        <Banner
          symbol={readyCount ? 'checkmark.circle.fill' : 'clock.fill'}
          tint={readyCount ? colors.success : colors.warning}
          text={
            readyCount
              ? `${readyCount} ${readyCount === 1 ? 'scan is' : 'scans are'} ready to review`
              : `${queue.length} ${queue.length === 1 ? 'scan' : 'scans'} waiting — they’ll be read when you’re online`
          }
          action={readyCount ? 'Review' : 'Read Now'}
          onAction={readQueued}
        />
      )}
      {(tag || company || search.trim()) && (
        <View style={styles.filterRow}>
          <Text style={styles.filterText} accessibilityLiveRegion="polite">
            {matchCount} of {cards.length} cards
            {tag ? ` · #${tag}` : ''}
            {company ? ` · ${company}` : ''}
          </Text>
          {(tag || company) && (
            <Button onPress={clearFilters} accessibilityLabel="Clear filters">
              <Text style={styles.link}>Clear</Text>
            </Button>
          )}
        </View>
      )}
    </View>
  );

  const showIndex = sort !== 'recent' && sections.length > 3 && !filtering;

  return (
    <View style={styles.screen}>
      <SectionList
        ref={listRef}
        // Rows are measured, not fixed, so a jump to a section that hasn't rendered yet fails;
        // without this handler that failure is a fatal invariant. Scroll near it, then retry.
        onScrollToIndexFailed={(info) => {
          listRef.current?.getScrollResponder()?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
          const section = pendingSection.current;
          if (section !== null && retries.current++ < 4) setTimeout(() => scrollToSection(section), 60);
        }}
        sections={sections}
        keyExtractor={(item) => item.card.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.sectionHeader} accessibilityRole="header">
              {section.title}
            </Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          !loaded ? null : filtering ? (
            <EmptyState symbol="magnifyingglass" title="No Results" text="Check the spelling or try a different search." />
          ) : (
            <EmptyState
              symbol="person.text.rectangle"
              title="No Cards Yet"
              text="Scan a business card and RoloAI will read the details for you."
              action="Scan a Card"
              onAction={() => navigation.navigate('Scan')}
            />
          )
        }
        renderItem={({ item }) => (
          <CardRow
            entry={item}
            onOpen={() => navigation.navigate('CardDetail', { cardId: item.card.id })}
            showsChevron={!showIndex}
          />
        )}
      />

      {showIndex && (
        <SectionIndex
          letters={sections.map((s) => s.title)}
          onSelect={scrollToSection}
        />
      )}

      <Button
        style={[styles.scanButton, { bottom: insets.bottom + 12 }]}
        pressedStyle={styles.scanButtonPressed}
        onPress={() => navigation.navigate('Scan')}
        accessibilityLabel="Scan a card"
      >
        <SymbolView name="camera.viewfinder" size={22} tintColor={colors.onTint} />
        <Text style={styles.scanButtonText}>Scan Card</Text>
      </Button>
    </View>
  );
}

/**
 * One card: swipe left for call/mail/delete, long-press for the full context menu, tap to open.
 * The menu is the system UIContextMenu (with the row lifted as its preview), not an action sheet.
 */
function CardRow({ entry, onOpen, showsChevron }: { entry: ListEntry; onOpen: () => void; showsChevron: boolean }) {
  const { card, partner } = entry;
  const swipeRef = useRef<React.ComponentRef<typeof ReanimatedSwipeable>>(null);
  const [sharing, setSharing] = useState(false);
  const thumb = cardThumbUrl(card);
  const canCall = card.phones.some((p) => telUrl(p.number));
  const canMail = card.emails.some((e) => mailtoUrl(e.address));
  const close = () => swipeRef.current?.close();

  const actions = [
    canCall && { id: 'call', title: 'Call', image: 'phone' },
    canCall && { id: 'message', title: 'Message', image: 'message' },
    canMail && { id: 'email', title: 'Email', image: 'envelope' },
    { id: 'contacts', title: 'Add to Contacts', image: 'person.crop.circle.badge.plus' },
    { id: 'share', title: sharing ? 'Preparing…' : 'Share', image: 'square.and.arrow.up' },
    { id: 'delete', title: 'Delete', image: 'trash', attributes: { destructive: true } },
  ].filter(Boolean) as { id: string; title: string; image: string; attributes?: { destructive: boolean } }[];

  const run = (id: string) => {
    if (id === 'call') void call(card);
    if (id === 'message') void message(card);
    if (id === 'email') void email(card);
    if (id === 'contacts') void addToContacts(card);
    if (id === 'share') presentShareMenu(card, setSharing);
    if (id === 'delete') confirmDelete(card);
  };

  const renderRightActions = () => (
    <View style={styles.swipeActions}>
      {canCall && (
        <SwipeAction symbol="phone.fill" label="Call" color={colors.success} onPress={() => { close(); void call(card); }} />
      )}
      {canMail && (
        <SwipeAction symbol="envelope.fill" label="Email" color={colors.tint} onPress={() => { close(); void email(card); }} />
      )}
      <SwipeAction symbol="trash.fill" label="Delete" color={colors.destructive} onPress={() => { close(); confirmDelete(card); }} />
    </View>
  );

  const names = [card, partner].filter((c): c is Card => Boolean(c)).map(displayName).join(', ');
  const subtitle = [card.jobTitle, card.company].filter(Boolean).join(' · ');

  return (
    <ReanimatedSwipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false} friction={1.5} rightThreshold={40}>
      <MenuView
        shouldOpenOnLongPress
        actions={actions}
        onPressAction={({ nativeEvent }) => run(nativeEvent.event)}
      >
        <Button
          style={styles.row}
          pressedStyle={styles.rowPressed}
          hitSlop={undefined}
          onPress={onOpen}
          accessibilityLabel={[names, subtitle].filter(Boolean).join(', ')}
          accessibilityHint="Opens the card. Swipe up or down for actions."
          accessibilityActions={[
            ...(canCall ? [{ name: 'call', label: 'Call' }] : []),
            ...(canMail ? [{ name: 'email', label: 'Email' }] : []),
            { name: 'delete', label: 'Delete' },
          ]}
          onAccessibilityAction={(e) => run(e.nativeEvent.actionName)}
        >
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" transition={120} recyclingKey={card.id} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <SymbolView name="person.text.rectangle" size={20} tintColor={colors.tertiaryLabel} />
            </View>
          )}
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {displayName(card)}
              {partner && <Text style={styles.partnerName}>{'  '}{displayName(partner)}</Text>}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {card.followUpAt && card.followUpAt > Date.now() ? (
            <SymbolView name="bell.fill" size={13} tintColor={colors.warning} />
          ) : null}
          {showsChevron && <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />}
        </Button>
      </MenuView>
    </ReanimatedSwipeable>
  );
}

function SwipeAction(props: { symbol: 'phone.fill' | 'envelope.fill' | 'trash.fill'; label: string; color: typeof colors.tint; onPress: () => void }) {
  return (
    <Button style={[styles.swipeAction, { backgroundColor: props.color }]} pressedStyle={styles.swipePressed} hitSlop={undefined} onPress={props.onPress} accessibilityLabel={props.label}>
      <SymbolView name={props.symbol} size={20} tintColor={colors.onTint} />
      <Text style={styles.swipeLabel}>{props.label}</Text>
    </Button>
  );
}

/**
 * The A–Z strip down the trailing edge, as in Contacts. Dragging along it scrubs through the
 * sections; each new letter gives a selection tick.
 */
function SectionIndex({ letters, onSelect }: { letters: string[]; onSelect: (index: number) => void }) {
  const [height, setHeight] = useState(0);
  const last = useRef(-1);
  const pick = (e: GestureResponderEvent) => {
    if (!height) return;
    const i = Math.max(0, Math.min(letters.length - 1, Math.floor((e.nativeEvent.locationY / height) * letters.length)));
    if (i !== last.current) {
      last.current = i;
      haptics.selection();
      onSelect(i);
    }
  };
  return (
    <View
      style={styles.index}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => (last.current = -1)}
      accessibilityRole="adjustable"
      accessibilityLabel="Section index"
    >
      {letters.map((l) => (
        <Text key={l} style={styles.indexLetter}>
          {l}
        </Text>
      ))}
    </View>
  );
}

function Banner(props: { symbol: 'exclamationmark.triangle.fill' | 'checkmark.circle.fill' | 'clock.fill'; tint: typeof colors.tint; text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <SymbolView name={props.symbol} size={18} tintColor={props.tint} />
      <Text style={styles.bannerText}>{props.text}</Text>
      {props.action && (
        <Button onPress={props.onAction}>
          <Text style={styles.link}>{props.action}</Text>
        </Button>
      )}
    </View>
  );
}

/** Modelled on ContentUnavailableView: symbol, title, one line of help, optional action. */
function EmptyState(props: { symbol: 'magnifyingglass' | 'person.text.rectangle'; title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.empty}>
      <SymbolView name={props.symbol} size={48} tintColor={colors.tertiaryLabel} />
      <Text style={styles.emptyTitle}>{props.title}</Text>
      <Text style={styles.emptyText}>{props.text}</Text>
      {props.action && (
        <Button onPress={props.onAction} style={styles.emptyButton}>
          <Text style={styles.link}>{props.action}</Text>
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerStack: { gap: 8, paddingTop: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.secondaryBackground,
  },
  bannerText: { ...type.subheadline, color: colors.label, flex: 1 },
  link: { ...type.subheadline, color: colors.tint, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  filterText: { ...type.footnote, color: colors.secondaryLabel, flex: 1 },
  sectionHeader: {
    ...type.footnote,
    fontWeight: '600',
    color: colors.secondaryLabel,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 16 + 56 + 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 60,
    backgroundColor: colors.background,
  },
  rowPressed: { backgroundColor: colors.fill },
  thumb: { width: 56, height: 36, borderRadius: 5, backgroundColor: colors.tertiaryFill },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { ...type.headline, color: colors.label },
  partnerName: { fontWeight: '400', color: colors.secondaryLabel },
  subtitle: { ...type.subheadline, color: colors.secondaryLabel, marginTop: 1 },
  swipeActions: { flexDirection: 'row' },
  swipeAction: { width: 74, alignItems: 'center', justifyContent: 'center', gap: 4 },
  swipePressed: { opacity: 0.8 },
  swipeLabel: { ...type.caption, color: colors.onTint, fontWeight: '600' },
  index: { position: 'absolute', right: 2, top: 120, bottom: 140, justifyContent: 'center', paddingHorizontal: 4 },
  indexLetter: { fontSize: 11, fontWeight: '600', color: colors.tint, textAlign: 'center', lineHeight: 14 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 80, gap: 8 },
  emptyTitle: { ...type.title2, color: colors.label, marginTop: 8 },
  emptyText: { ...type.subheadline, color: colors.secondaryLabel, textAlign: 'center' },
  emptyButton: { marginTop: 8 },
  scanButton: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: colors.tint,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  scanButtonPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  scanButtonText: { ...type.headline, color: colors.onTint },
});
