import React, { useCallback, useRef, useState } from 'react';
import { Modal, View, Image, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import { alertForScanFailure } from './cameraAlerts';
import { rotateImage, scanCardEdge, type CardScanResult } from './documentScanner';

/**
 * The capture under review. `original` and `rotation` travel with `uri` in one value so a
 * rotation can never update the displayed image without updating what it was rotated from —
 * see handleRotate, which reads `original` rather than re-rotating the already-rotated `uri`.
 */
interface Capture {
  uri: string;
  original: string;
  rotation: number;
}

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
  const [capture, setCapture] = useState<Capture | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [rotating, setRotating] = useState(false);
  const resolverRef = useRef<((result: CardScanResult) => void) | null>(null);

  /** A freshly captured shot replaces whatever was under review, rotation and all. */
  const showCapture = (uri: string) => {
    setCapture({ uri, original: uri, rotation: 0 });
  };

  const settle = (result: CardScanResult) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setCapture(null);
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
          showCapture(result.uri);
        });
    });
  }, []);

  const handleRetake = async () => {
    try {
      const result = await scanCardEdge();
      if (result.status === 'ok') {
        showCapture(result.uri);
        return;
      }
      // A cancel leaves the review open on the existing photo rather than losing it — the user
      // still has Accept and Cancel to choose from. Denied/unavailable get the same explanation
      // every other scanCardEdge() call site gives, or the retake button would look dead.
      if (result.status !== 'cancelled') {
        alertForScanFailure(result);
      }
    } catch (e) {
      console.error('Card scanner failed:', e);
      alertForScanFailure({ status: 'unavailable' });
    }
  };

  /**
   * Turns the shot a quarter turn clockwise.
   *
   * The scanner reads the card's orientation off the crop's shape and what Vision can make out,
   * which is right nearly always and wrong on a card it cannot read — a logo-only back, or one
   * photographed at an angle that makes both turns equally legible. This is the way out of that
   * without recapturing and hoping.
   */
  const handleRotate = async () => {
    if (!capture || rotating) return;
    const next = (capture.rotation + 90) % 360;
    setRotating(true);
    try {
      // Back at 0 the original file is the answer, and re-rendering it would only lose quality.
      const uri = next === 0 ? capture.original : await rotateImage(capture.original, next);
      setCapture({ ...capture, uri, rotation: next });
    } catch (e) {
      // The shot on screen is still perfectly usable, so this is worth reporting quietly rather
      // than tearing down a review the user may be about to accept.
      console.error('Could not rotate the capture:', e);
    } finally {
      setRotating(false);
    }
  };

  const reviewModal = capture ? (
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
        <Image source={{ uri: capture.uri }} style={styles.preview} resizeMode="contain" />
        <Button style={styles.rotateButton} onPress={handleRotate} disabled={rotating}>
          {rotating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.rotateButtonText}>Rotate 90°</Text>
          )}
        </Button>
        <View style={styles.buttonRow}>
          <Button style={styles.cancelButton} onPress={() => settle({ status: 'cancelled' })}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Button>
          <Button style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </Button>
          <Button
            style={styles.acceptButton}
            onPress={() => settle({ status: 'ok', uri: capture.uri })}
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
  // Its own row rather than a fourth button alongside Cancel/Retake/Accept: those three are the
  // outcomes, this changes the thing being decided on, and four across is cramped on an SE.
  rotateButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#555',
    minWidth: 130,
    alignItems: 'center',
  },
  rotateButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
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
