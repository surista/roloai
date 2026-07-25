import React, { useCallback, useRef, useState } from 'react';
import { Modal, View, Image, Text, Pressable, StyleSheet } from 'react-native';
import { scanCardEdge } from './documentScanner';

/**
 * Wraps scanCardEdge() with an explicit "Save this / Retake" checkpoint. VisionKit's
 * document scanner auto-captures continuously (it's built for multi-page scanning) with
 * no per-shot confirmation of its own, so this adds the missing review step ourselves —
 * scanCardEdge() only resolves once the user taps the native "Save" button, however many
 * times it auto-captured in between.
 */
export function useScanWithReview() {
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const resolverRef = useRef<((uri: string | null) => void) | null>(null);

  const scan = useCallback((scanLabel?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setLabel(scanLabel);
      scanCardEdge().then((uri) => {
        if (!uri) {
          resolverRef.current = null;
          resolve(null);
          return;
        }
        setPendingUri(uri);
      });
    });
  }, []);

  const handleRetake = async () => {
    const uri = await scanCardEdge();
    if (uri) {
      setPendingUri(uri);
    }
    // If cancelled, stay in review with the existing photo rather than losing it.
  };

  const handleUsePhoto = () => {
    resolverRef.current?.(pendingUri);
    resolverRef.current = null;
    setPendingUri(null);
    setLabel(undefined);
  };

  const reviewModal = pendingUri ? (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        {label && <Text style={styles.label}>{label}</Text>}
        <Image source={{ uri: pendingUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.buttonRow}>
          <Pressable style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.useButton} onPress={handleUsePhoto}>
            <Text style={styles.useButtonText}>Use Photo</Text>
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
    padding: 20,
  },
  label: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  preview: { width: '100%', height: '65%', borderRadius: 10, backgroundColor: '#111' },
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
