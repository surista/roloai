import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, SectionList, StyleSheet, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ContextMenu, type ContextMenuAction } from '../../modules/card-scanner';
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
  sortText,
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
import { setPreference, usePreferences } from '../lib/preferences';
import { haptics } from '../lib/haptics';
import { colors, type } from '../theme';

/** How many companies the filter menu lists; the rest are reachable by searching. */
const TOP_COMPANIES = 12;

type Props = NativeStackScreenProps<RootStackParamList, 'CardList'>;

interface Section {
  title: string;
  data: ListEntry[];
}

/**
 * The letter a card files under for an alphabetical sort. Accents fold to their base letter, as
 * the sort itself does (Åberg sits among the A's, Ölund among the O's); anything else — another
 * script, a digit, no name at all — files under "#".
 */
function sectionKey(card: Card, sort: CardSort): string {
  if (sort === 'recent') return '';
  const letter = sortText(card, sort).normalize('NFD').charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
}

export default function CardListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  // The owner's own card (isMine) is kept out of the library: it is reached from My Card.
  const { cards, loaded, error } = useCards();
  const [search, setSearch] = useState('');
  const prefs = usePreferences();
  const sort: CardSort = prefs?.listSort ?? 'recent';
  const setSort = (value: CardSort) => void setPreference('listSort', value);
  const [tag, setTag] = useState<string | undefined>();
  const [company, setCompany] = useState<string | undefined>();
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const listRef = useRef<SectionList<ListEntry, Section>>(null);
  // Jumps for the A–Z index. A section's header is measured where it actually is when it's
  // rendered; when it isn't (a long library), the jump goes to where the row-height model below
  // puts it, which renders it, and the next attempt measures it exactly.
  const headerRefs = useRef(new Map<string, View>());
  const scrollToSection = (i: number, attempt = 0) => {
    const list = listRef.current;
    const responder = list?.getScrollResponder() as { getNativeScrollRef?: () => unknown } | undefined;
    const scrollNode = responder?.getNativeScrollRef?.();
    const scrollTo = (y: number) => list?.getScrollResponder()?.scrollTo({ y, animated: false });
    const title = sections[i]?.title;
    const header = title ? headerRefs.current.get(title) : undefined;
    if (header && scrollNode) {
      header.measureLayout(scrollNode as never, (_x, y) => scrollTo(y), () => {});
      return;
    }
    const offset = layout?.sectionOffsets[i];
    if (offset === undefined || attempt >= 4) return;
    scrollTo(offset);
    setTimeout(() => scrollToSection(i, attempt + 1), 50);
  };

  // Row heights, measured as rows render. Every row is one of two heights — with a subtitle line
  // or without — and every section header one more, at any text size; from those the whole list's
  // layout follows. Without getItemLayout a list can't scroll past the rows it has rendered so
  // far, so the A–Z index couldn't reach the end of a long library.
  const [sizes, setSizes] = useState({ listHeader: 0, header: 0, row: 0, bareRow: 0 });
  const openCard = useCallback(
    (cardId: string) => navigation.navigate('CardDetail', { cardId }),
    [navigation]
  );
  const noteSize = useCallback((key: 'listHeader' | 'header' | 'row' | 'bareRow', height: number) => {
    setSizes((prev) => (Math.abs(prev[key] - height) < 0.5 ? prev : { ...prev, [key]: height }));
  }, []);

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

  // Pair up the *whole* sorted library and filter the rows afterwards: filtering first would
  // drop one half of a pair whenever only it matched and show the other as if it had no partner.
  // Sorted only when the library or the sort changes, not on every keystroke or filter.
  const sortedEntries = useMemo(() => groupPairs(sortCards(cards, sort)), [cards, sort]);
  const { sections, matchCount } = useMemo(() => {
    const matches = filterCards(cards, { search, tag, company });
    const matchIds = new Set(matches.map((c) => c.id));
    const entries = sortedEntries.filter(
      ({ card, partner }) => matchIds.has(card.id) || (partner && matchIds.has(partner.id))
    );
    if (sort === 'recent') return { sections: [{ title: '', data: entries }], matchCount: matches.length };
    const byKey = new Map<string, ListEntry[]>();
    for (const entry of entries) {
      const key = sectionKey(entry.card, sort);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(entry);
      else byKey.set(key, [entry]);
    }
    // "#" goes last, as in Contacts, wherever the sort first met one of its cards.
    const titles = [...byKey.keys()].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1));
    return {
      sections: titles.map((title) => ({ title, data: byKey.get(title)! })),
      matchCount: matches.length,
    };
  }, [cards, sortedEntries, search, tag, company, sort]);

  // Offsets for getItemLayout, indexed as SectionList counts: each section is its header, its
  // rows, then a (zero-height) footer. The separator sits inside every row but a section's last.
  const layout = useMemo(() => {
    if (sort === 'recent' || !sizes.header || !(sizes.row || sizes.bareRow)) return undefined;
    const rowHeight = (entry: ListEntry) => {
      const bare = !entry.card.jobTitle && !entry.card.company;
      return (bare ? sizes.bareRow : sizes.row) || sizes.row || sizes.bareRow;
    };
    const cells: { offset: number; length: number }[] = [];
    const sectionOffsets: number[] = [];
    let y = sizes.listHeader;
    for (const section of sections) {
      sectionOffsets.push(y);
      cells.push({ offset: y, length: sizes.header });
      y += sizes.header;
      section.data.forEach((entry, k) => {
        const length = rowHeight(entry) + (k < section.data.length - 1 ? StyleSheet.hairlineWidth : 0);
        cells.push({ offset: y, length });
        y += length;
      });
      cells.push({ offset: y, length: 0 });
    }
    return { cells, sectionOffsets };
  }, [sections, sort, sizes]);

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
    <View style={styles.headerStack} onLayout={(e) => noteSize('listHeader', e.nativeEvent.layout.height)}>
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
    <>
      {/* The list is the screen's first view, not wrapped in one: that's how the navigation bar
          finds it, to collapse the large title and search bar as it scrolls (as in Contacts). */}
      <SectionList
        ref={listRef}
        style={styles.screen}
        getItemLayout={
          layout && !(globalThis as { __noGIL?: boolean }).__noGIL ? (_data, index) => ({ index, ...(layout.cells[index] ?? { offset: 0, length: 0 }) }) : undefined
        }
        sections={sections}
        // Rows are heavy (swipe actions, a native context menu, SF Symbols). The default window
        // keeps ~21 screens of them mounted, so every filter or search change re-rendered hundreds
        // of rows and took seconds; a few screens either side still scrolls without blanking.
        windowSize={5}
        keyExtractor={(item) => item.card.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        // A search result opens on the first tap, as in Contacts, instead of only closing the keyboard.
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View
              ref={(r) => {
                if (r) headerRefs.current.set(section.title, r);
                else headerRefs.current.delete(section.title);
              }}
              onLayout={(e) => noteSize('header', e.nativeEvent.layout.height)}
            >
              <Text style={styles.sectionHeader} accessibilityRole="header">
                {section.title}
              </Text>
            </View>
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
            onOpen={openCard}
            showsChevron={!showIndex}
            onMeasure={noteSize}
          />
        )}
      />

      {showIndex && (
        <SectionIndex
          letters={sections.map((s) => s.title)}
          onSelect={(i) => scrollToSection(i)}
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
    </>
  );
}

/**
 * One card: swipe left for call/mail/delete, long-press for the full context menu, tap to open.
 * The menu is the system UIContextMenu (with the row lifted as its preview), not an action sheet.
 */
// Memoized: a library of hundreds re-renders the visible rows on every snapshot and scroll batch
// otherwise, which is what "slow to update" from the list means.
const CardRow = React.memo(function CardRow({
  entry,
  onOpen,
  showsChevron,
  onMeasure,
}: {
  entry: ListEntry;
  onOpen: (cardId: string) => void;
  showsChevron: boolean;
  onMeasure: (key: 'row' | 'bareRow', height: number) => void;
}) {
  const { card, partner } = entry;
  const swipeRef = useRef<React.ComponentRef<typeof ReanimatedSwipeable>>(null);
  const [sharing, setSharing] = useState(false);
  const thumb = cardThumbUrl(card);
  const canCall = card.phones.some((p) => telUrl(p.number));
  const canMail = card.emails.some((e) => mailtoUrl(e.address));
  const close = () => swipeRef.current?.close();

  const candidates: (ContextMenuAction | false)[] = [
    canCall && { id: 'call', title: 'Call', image: 'phone' },
    canCall && { id: 'message', title: 'Message', image: 'message' },
    canMail && { id: 'email', title: 'Email', image: 'envelope' },
    { id: 'contacts', title: 'Add to Contacts', image: 'person.crop.circle.badge.plus' },
    { id: 'share', title: sharing ? 'Preparing…' : 'Share', image: 'square.and.arrow.up' },
    { id: 'delete', title: 'Delete', image: 'trash', destructive: true },
  ];
  const actions = candidates.filter((a): a is ContextMenuAction => Boolean(a));

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
      <ContextMenu
        actions={actions}
        onSelect={({ nativeEvent }) => run(nativeEvent.id)}
        onLayout={(e: LayoutChangeEvent) => onMeasure(subtitle ? 'row' : 'bareRow', e.nativeEvent.layout.height)}
      >
        <Button
          style={styles.row}
          pressedStyle={styles.rowPressed}
          hitSlop={undefined}
          onPress={() => onOpen(card.id)}
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
              <SymbolView name="person.text.rectangle" size={20} tintColor={colors.tertiaryLabel} accessibilityElementsHidden importantForAccessibility="no" />
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
      </ContextMenu>
    </ReanimatedSwipeable>
  );
});

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
  // Where the letters sit inside the touch column. The letters ignore touches, so locationY is
  // always relative to the column (it was relative to the touched letter, so every tap meant "A").
  const frame = useRef({ top: 0, height: 0 });
  const last = useRef(-1);
  const [current, setCurrent] = useState(0);
  const select = (i: number) => {
    if (i === last.current) return;
    last.current = i;
    setCurrent(i);
    haptics.selection();
    onSelect(i);
  };
  const pick = (e: GestureResponderEvent) => {
    const { top, height } = frame.current;
    if (!height) return;
    const ratio = (e.nativeEvent.locationY - top) / height;
    select(Math.max(0, Math.min(letters.length - 1, Math.floor(ratio * letters.length))));
  };
  return (
    <View
      style={styles.index}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        last.current = -1;
        pick(e);
      }}
      onResponderMove={pick}
      onResponderTerminationRequest={() => false}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Section index"
      accessibilityValue={{ text: letters[current] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = e.nativeEvent.actionName === 'increment' ? current + 1 : current - 1;
        if (next >= 0 && next < letters.length) select(next);
      }}
    >
      <View
        pointerEvents="none"
        onLayout={(e) => (frame.current = { top: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height })}
      >
        {letters.map((l) => (
          <Text key={l} style={styles.indexLetter}>
            {l}
          </Text>
        ))}
      </View>
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
