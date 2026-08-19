import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Card } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { subscribeToCards } from '../lib/cards';
import { useAuth } from '../lib/AuthContext';
import { APP_VERSION } from '../lib/version';

type Props = NativeStackScreenProps<RootStackParamList, 'CardList'>;

export default function CardListScreen({ navigation }: Props) {
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => subscribeToCards(setCards), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.firstName, c.lastName, c.company, c.jobTitle, ...c.tags]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    );
  }, [cards, search]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search name, company, tag…"
          value={search}
          onChangeText={setSearch}
        />
        <View style={styles.headerActions}>
          <Button onPress={logout} accessibilityLabel="Sign out">
            <Text style={styles.logout}>Sign out</Text>
          </Button>
          <Text style={styles.version}>v{APP_VERSION}</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={<Text style={styles.empty}>No cards yet — tap Scan to add one.</Text>}
        renderItem={({ item }) => (
          <Button
            style={styles.row}
            pressedStyle={styles.rowPressed}
            hitSlop={undefined}
            onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
            accessibilityLabel={`${item.firstName} ${item.lastName}`.trim() || 'Card'}
          >
            {/* thumbUrl is absent on cards saved before thumbnails existed, so fall back to the
                full image rather than showing a blank tile for them. */}
            {item.thumbUrl || item.imageUrl ? (
              <Image source={{ uri: item.thumbUrl || item.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {item.firstName} {item.lastName}
              </Text>
              <Text style={styles.subtitle}>
                {[item.jobTitle, item.company].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Button>
        )}
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
  logout: { color: '#c00' },
  version: { color: '#888', fontSize: 11 },
  list: { paddingHorizontal: 16 },
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
