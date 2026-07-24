import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, Image, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Card } from '@roloai/shared';
import type { RootStackParamList } from '../navigation/types';
import { subscribeToCards } from '../lib/cards';
import { useAuth } from '../lib/AuthContext';

type Props = NativeStackScreenProps<RootStackParamList, 'CardList'>;

export default function CardListScreen({ navigation }: Props) {
  const { logout } = useAuth();
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
        <Pressable onPress={logout}>
          <Text style={styles.logout}>Sign out</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No cards yet — tap Scan to add one.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
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
          </Pressable>
        )}
      />

      <Pressable style={styles.scanButton} onPress={() => navigation.navigate('Scan')}>
        <Text style={styles.scanButtonText}>+ Scan Card</Text>
      </Pressable>
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
  logout: { color: '#c00' },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  thumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#eee' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2 },
  scanButton: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  scanButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
