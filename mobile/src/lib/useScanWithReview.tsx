import React, { useCallback, useRef, useState } from 'react';
import { Modal, View, Image, Text, Pressable, StyleSheet } from 'react-native';
import { scanCardEdge } from './documentScanner';

/**
 * Wraps scanCardEdge() with a confirmation step: the scanner auto-captures a single shot and
 * stops, and this puts that shot in front of the user and does nothing until they choose
 * Accept, Retake or Cancel.
 *
 * The scanner resolves only once it has fully dismissed, so showing this modal doesn't race the
 * dismissal — a UIKit presentation made against a controller mid-dismissal is dropped by iOS.
 */
export function useScanWithReview() {
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const resolverRef = useRef<((uri: string | null) => void) | null>(null);

  const finish = (uri: string | null) => {
    resolverRef.current?.(uri);
    resolverRef.current = null;
    setPendingUri(null);
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
          console.error('Card scanner failed:', e);
          return null;
        })
        .then((uri) => {
          if (!uri) {
            resolverRef.current = null;
            setLabel(undefined);
            resolve(null);
            return;
          }
          setPendingUri(uri);
        });
    });
  }, []);

  const handleRetake = async () => {
    try {
      const uri = await scanCardEdge();
      if (uri) {
        setPendingUri(uri);
      }
      // If cancelled, stay in review with the existing photo rather than losing it.
    } catch (e) {
      console.error('Card scanner failed:', e);
    }
  };

  const reviewModal = pendingUri ? (
    <Modal visible transparent animationType="fade">
      <View style={styles.backdrop}>
        {label && <Text style={styles.label}>{label}</Text>}
        <Image source={{ uri: pendingUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.buttonRow}>
          <Pressable style={styles.cancelButton} onPress={() => finish(null)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.acceptButton} onPress={() => finish(pendingUri)}>
            <Text style={styles.acceptButtonText}>Accept</Text>
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
  label: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  preview: { width: '100%', height: '65%', borderRadius: 10, backgroundColor: '#111' },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
    paddingHorizontal: 20,
    alignSelf: 'stretch',
  },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  cancelButtonText: { color: '#aaa', fontWeight: '600', fontSize: 16 },
  retakeButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  retakeButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  acceptButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptButtonText: { color: '#111', fontWeight: '700', fontSize: 16 },
});
