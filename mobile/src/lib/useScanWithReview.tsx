import React, { useCallback, useRef, useState } from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { scanCardEdge } from './documentScanner';

/**
 * Wraps scanCardEdge() with an explicit "Use This / Retake" checkpoint.
 *
 * VisionKit auto-captures continuously and can't be stopped after one shot (see
 * scanCardEdge), so a session typically returns several shots of the same card. Rather than
 * silently keeping the first, all of them are shown here as a swipeable strip: the repeated
 * auto-capture becomes a choice of takes, and nothing reaches the card without confirmation.
 */
export function useScanWithReview() {
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [label, setLabel] = useState<string | undefined>(undefined);
  // Remounts the pager on each new batch so it starts at the first shot instead of
  // holding the scroll offset from the previous one.
  const [batchId, setBatchId] = useState(0);
  const resolverRef = useRef<((uri: string | null) => void) | null>(null);
  const { width, height } = useWindowDimensions();
  const pageHeight = height * 0.6;

  const showBatch = (uris: string[]) => {
    setPendingUris(uris);
    setSelectedIndex(0);
    setBatchId((id) => id + 1);
  };

  const finish = (uri: string | null) => {
    resolverRef.current?.(uri);
    resolverRef.current = null;
    setPendingUris([]);
    setSelectedIndex(0);
    setLabel(undefined);
  };

  const scan = useCallback((scanLabel?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setLabel(scanLabel);
      // A throw from the native scanner would otherwise leave this promise unsettled forever,
      // hanging whichever caller is awaiting it — treat a failure the same as a cancel.
      scanCardEdge()
        .catch((e) => {
          console.error('Document scanner failed:', e);
          return [];
        })
        .then((uris) => {
          if (!uris.length) {
            resolverRef.current = null;
            setLabel(undefined);
            resolve(null);
            return;
          }
          showBatch(uris);
        });
    });
  }, []);

  const handleRetake = async () => {
    try {
      const uris = await scanCardEdge();
      if (uris.length) {
        showBatch(uris);
      }
      // If cancelled, stay in review with the existing shots rather than losing them.
    } catch (e) {
      console.error('Document scanner failed:', e);
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setSelectedIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const multiple = pendingUris.length > 1;

  const reviewModal = pendingUris.length ? (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        {label && <Text style={styles.label}>{label}</Text>}
        {multiple && (
          <Text style={styles.counter}>
            {selectedIndex + 1} of {pendingUris.length}
          </Text>
        )}

        <ScrollView
          key={batchId}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          style={{ flexGrow: 0, height: pageHeight }}
        >
          {pendingUris.map((uri) => (
            <View key={uri} style={{ width, height: pageHeight, paddingHorizontal: 20 }}>
              <Image source={{ uri }} style={styles.preview} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>

        {multiple && (
          <>
            <Text style={styles.hint}>Swipe to compare shots</Text>
            <View style={styles.dots}>
              {pendingUris.map((uri, i) => (
                <View key={uri} style={[styles.dot, i === selectedIndex && styles.dotActive]} />
              ))}
            </View>
          </>
        )}

        <View style={styles.buttonRow}>
          <Pressable style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.useButton} onPress={() => finish(pendingUris[selectedIndex])}>
            <Text style={styles.useButtonText}>{multiple ? 'Use This' : 'Use Photo'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  ) : null;

  return { scan, reviewModal };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  label: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  counter: { color: '#aaa', fontSize: 14, marginBottom: 8 },
  preview: { flex: 1, width: '100%', borderRadius: 10, backgroundColor: '#111' },
  hint: { color: '#aaa', fontSize: 13, marginTop: 16 },
  dots: { flexDirection: 'row', gap: 8, marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#fff' },
  buttonRow: { flexDirection: 'row', gap: 16, marginTop: 28 },
  retakeButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fff',
  },
  retakeButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  useButton: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  useButtonText: { color: '#111', fontWeight: '700', fontSize: 16 },
});
