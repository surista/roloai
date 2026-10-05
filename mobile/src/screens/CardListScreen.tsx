import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Image, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CARD_SORT_OPTIONS,
  allTags,
  cardThumbUrl,
  companyCounts,
  filterCards,
  groupPairs,
  sortCards,
  withoutMine,
  type Card,
  type CardSort,
} from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { subscribeToCards } from '../lib/cards';
import { listQueuedScans, oldestEntry, queuedScanUris, type QueuedScan } from '../lib/scanQueue';
import { APP_VERSION } from '../lib/version';

/** How many companies get a chip; the rest are reachable by searching. Keeps the row compact. */
const TOP_COMPANIES = 8;

type Props = NativeStackScreenProps<RootStackParamList, 'CardList'>;

const CHIP_HIT_SLOP = { top: 7, bottom: 7, left: 0, right: 0 } as const;

export default function CardListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  // The owner's own card (isMine) is kept out of the library: it is reached from My Card.
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CardSort>('recent');
  const [tag, setTag] = useState<string | undefined>();
  const [company, setCompany] = useState<string | undefined>();
  const [queue, setQueue] = useState<QueuedScan[]>([]);

  useEffect(() => subscribeToCards((all) => setCards(withoutMine(all))), []);

  // Refreshed on focus: scans are queued and drained on other screens, and coming back here is
  // the only time the count can have changed.
  useFocusEffect(
    useCallback(() => {
      listQueuedScans().then(setQueue, () => setQueue([]));
    }, [])
  );

  const readQueued = () => {
    const entry = oldestEntry(queue);
    if (!entry) return;
    navigation.navigate('ReviewEdit', { scan: queuedScanUris(entry), queuedId: entry.id });
  };

  const tags = useMemo(() => allTags(cards), [cards]);
  const companies = useMemo(() => {
    const top = companyCounts(cards).slice(0, TOP_COMPANIES);
    // A selected company outside the top few still needs its chip, or it could not be cleared.
    if (company && !top.some((c) => c.company === company)) {
      top.unshift({ company, count: companyCounts(cards).find((c) => c.company === company)?.count ?? 0 });
    }
    return top;
  }, [cards, company]);

  const filtering = Boolean(search.trim() || tag || company);
  const { filtered, matchCount } = useMemo(() => {
    const matches = filterCards(cards, { search, tag, company });
    const matchIds = new Set(matches.map((c) => c.id));
    // Pair up the *whole* sorted library and filter the rows afterwards: filtering first would
    // drop one half of a pair whenever only it matched (searching the English name, say) and
    // show the other half as if it had no partner.
    const entries = groupPairs(sortCards(cards, sort)).filter(
      ({ card, partner }) => matchIds.has(card.id) || (partner && matchIds.has(partner.id))
    );
    return { filtered: entries, matchCount: matches.length };
  }, [cards, search, tag, company, sort]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search name, company, email, notes…"
          value={search}
          onChangeText={setSearch}
        />
        <View style={styles.headerActions}>
          {/* Sign out moved into Settings: it sat one stray tap from the search field, and the
              account it signs out of was never named anywhere in the app. */}
          <Button
            style={styles.myCardButton}
            onPress={() => navigation.navigate('MyCard')}
            accessibilityLabel="My Card"
          >
            <Text style={styles.myCardText}>My Card</Text>
          </Button>
          <Button
            onPress={() => navigation.navigate('Settings')}
            accessibilityLabel="Settings"
          >
            <Text style={styles.settingsLink}>Settings</Text>
          </Button>
          <Text style={styles.version}>v{APP_VERSION}</Text>
        </View>
      </View>

      {queue.length > 0 && (
        <View style={styles.queueBanner}>
          <Text style={styles.queueText}>
            {queue.length} {queue.length === 1 ? 'scan' : 'scans'} waiting to be read
          </Text>
          <Button onPress={readQueued} accessibilityLabel="Read the oldest waiting scan now">
            <Text style={styles.queueAction}>Read now</Text>
          </Button>
        </View>
      )}

      {/* Horizontal rather than wrapped: four chips fit one line on every iPhone, and a row that
          reflows to two lines would shift the list down as the labels change. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sortRow}
        keyboardShouldPersistTaps="handled"
      >
        {CARD_SORT_OPTIONS.map((option) => (
          <Button
            key={option.value}
            style={[styles.sortChip, sort === option.value && styles.sortChipActive]}
            // Vertical only: the chip is ~30pt tall, so this brings it to the 44pt minimum
            // without widening it into the neighbour it sits 8pt away from.
            hitSlop={CHIP_HIT_SLOP}
            accessibilityState={{ selected: sort === option.value }}
            accessibilityLabel={`Sort by ${option.label}`}
            onPress={() => setSort(option.value)}
          >
            <Text style={sort === option.value ? styles.sortTextActive : styles.sortText}>
              {option.label}
            </Text>
          </Button>
        ))}
      </ScrollView>

      {tags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          {tags.map((t) => (
            <FilterChip
              key={t}
              label={`#${t}`}
              active={tag === t}
              accessibilityLabel={`Filter by tag ${t}`}
              onPress={() => setTag(tag === t ? undefined : t)}
            />
          ))}
        </ScrollView>
      )}

      {companies.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          {companies.map((c) => (
            <FilterChip
              key={c.company}
              label={`${c.company} (${c.count})`}
              active={company === c.company}
              accessibilityLabel={`Filter by company ${c.company}`}
              onPress={() => setCompany(company === c.company ? undefined : c.company)}
            />
          ))}
        </ScrollView>
      )}

      {filtering && (
        <View style={styles.countRow}>
          <Text style={styles.countText}>
            {matchCount} of {cards.length} cards
          </Text>
          <Button
            onPress={() => {
              setSearch('');
              setTag(undefined);
              setCompany(undefined);
            }}
            accessibilityLabel="Clear all filters"
          >
            <Text style={styles.queueAction}>Clear</Text>
          </Button>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.card.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filtering ? 'No cards match.' : 'No cards yet — tap Scan to add one.'}
          </Text>
        }
        renderItem={({ item: entry }) => {
          const item = entry.card;
          const thumb = cardThumbUrl(item);
          return (
            <Button
              style={styles.row}
              pressedStyle={styles.rowPressed}
              hitSlop={undefined}
              onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
              accessibilityLabel={
                [item, entry.partner]
                  .filter((c): c is Card => Boolean(c))
                  .map((c) => `${c.firstName} ${c.lastName}`.trim())
                  .join(', ') || 'Card'
              }
            >
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.rowText}>
                <Text style={styles.name}>
                  {item.firstName} {item.lastName}
                  {entry.partner && (
                    <Text style={styles.partnerName}>
                      {' · '}
                      {entry.partner.firstName} {entry.partner.lastName}
                    </Text>
                  )}
                </Text>
                <Text style={styles.subtitle}>
                  {[item.jobTitle, item.company].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Button>
          );
        }}
      />

      <Button
        // A flat 24pt put this inside the home-indicator swipe zone on every notched iPhone,
        // where the system gesture wins over the button.
        style={[styles.scanButton, { bottom: insets.bottom + 16 }]}
        onPress={() => navigation.navigate('Scan')}
      >
        <Text style={styles.scanButtonText}>+ Scan Card</Text>
      </Button>
    </View>
  );
}

function FilterChip(props: {
  label: string;
  active: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Button
      style={[styles.sortChip, props.active && styles.sortChipActive]}
      hitSlop={CHIP_HIT_SLOP}
      accessibilityState={{ selected: props.active }}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
    >
      <Text style={props.active ? styles.sortTextActive : styles.sortText}>{props.label}</Text>
    </Button>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
  },
  headerActions: { alignItems: 'flex-end', gap: 2 },
  myCardButton: {
    backgroundColor: '#111',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  myCardText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  settingsLink: { color: '#0a7cff', fontWeight: '600' },
  version: { color: '#888', fontSize: 11 },
  sortRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  sortChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  sortChipActive: { backgroundColor: '#111', borderColor: '#111' },
  sortText: { fontSize: 13, color: '#333' },
  sortTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },
  filterRow: { paddingHorizontal: 16, paddingTop: 10, gap: 8, alignItems: 'center' },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  countText: { color: '#666', fontSize: 13 },
  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff6e5',
  },
  queueText: { color: '#5a4300', fontSize: 14, flexShrink: 1 },
  queueAction: { color: '#0a7cff', fontWeight: '600', fontSize: 14 },
  partnerName: { fontWeight: '400', color: '#666' },
  list: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  // A list row dims poorly; a grey wash reads better and matches the platform table style.
  rowPressed: { backgroundColor: '#e8e8e8' },
  thumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#eee' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2 },
  scanButton: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  scanButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
