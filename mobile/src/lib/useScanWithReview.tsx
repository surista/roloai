import React, { useCallback, useRef, useState } from 'react';
import { Modal, View, Image, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import { scanCardEdge, type CardScanResult } from './documentScanner';

/**
 * Wraps scanCardEdge() with a confirmation step: the scanner auto-captures a single shot and
 * stops, and this puts that shot in front of the user and does nothing until they choose
 * Accept, Retake or Cancel.
 *
 * The scanner resolves only once it has fully dismissed, so showing this modal doesn't race the
 * dismissal — a UIKit presentation made against a controller mid-dismissal is dropped by iOS.
 *
 * The native module's outcome is passed straight through rather than flattened to a uri-or-null,
 * so the caller can tell a cancel (say nothing) from a permission denial (must be explained).
 */
export function useScanWithReview() {
  const insets = useSafeAreaInsets();
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const resolverRef = useRef<((result: CardScanResult) => void) | null>(null);

  const settle = (result: CardScanResult) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setPendingUri(null);
    setLabel(undefined);
  };

  const scan = useCallback((scanLabel?: string): Promise<CardScanResult> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setLabel(scanLabel);
      // A throw from the native scanner would otherwise leave this promise unsettled forever,
      // hanging whichever caller is awaiting it — report it as an unusable camera instead.
      scanCardEdge()
        .catch((e): CardScanResult => {
          console.error('Card scanner failed:', e);
          return { status: 'unavailable' };
        })
        .then((result) => {
          if (result.status !== 'ok') {
            resolverRef.current = null;
            setLabel(undefined);
            resolve(result);
            return;
          }
          setPendingUri(result.uri);
        });
    });
  }, []);

  const handleRetake = async () => {
    try {
      const result = await scanCardEdge();
      if (result.status === 'ok') {
        setPendingUri(result.uri);
      }
      // Anything else (including a cancel) leaves the review open on the existing photo rather
      // than losing it — the user still has Accept and Cancel to choose from.
    } catch (e) {
      console.error('Card scanner failed:', e);
    }
  };

  const reviewModal = pendingUri ? (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => settle({ status: 'cancelled' })}
    >
      <View
        style={[
          styles.backdrop,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Solid black backdrop — the app's "auto" (dark) status bar would be invisible. */}
        <StatusBar style="light" />
        {label && <Text style={styles.label}>{label}</Text>}
        <Image source={{ uri: pendingUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.buttonRow}>
          <Button style={styles.cancelButton} onPress={() => settle({ status: 'cancelled' })}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Button>
          <Button style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Button>
          <Button
            style={styles.acceptButton}
            onPress={() => settle({ status: 'ok', uri: pendingUri })}
          >
            <Text style={styles.acceptButtonText}>Accept</Text>
          </Button>
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
