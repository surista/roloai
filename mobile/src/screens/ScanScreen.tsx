import React, { useCallback, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { parseQrPayload } from '../lib/parseCard';
import { extractCard, CardExtractionError } from '../lib/functions';
import { prepareImageForUpload } from '../lib/documentScanner';
import { useScanWithReview } from '../lib/useScanWithReview';
import { alertForScanFailure, alertForCameraPermissionDenied } from '../lib/cameraAlerts';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type Mode = 'photo' | 'qr';

export default function ScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('photo');
  const [busy, setBusy] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const { scan, reviewModal } = useScanWithReview();

  // Backing out of ReviewEdit returns to a still-mounted Scan screen holding the previous
  // attempt's state — a set QR lock would leave the camera silently ignoring every code, and a
  // leftover front photo would strand us on the back-of-card step. Reset both on focus.
  useFocusEffect(
    useCallback(() => {
      setQrLocked(false);
      setFrontUri(null);
    }, [])
  );

  const finishWithPhotos = async (frontPhotoUri: string, backPhotoUri?: string) => {
    setBusy(true);
    try {
      const [front, back] = await Promise.all([
        prepareImageForUpload(frontPhotoUri),
        backPhotoUri ? prepareImageForUpload(backPhotoUri) : Promise.resolve(undefined),
      ]);
      const draft = await extractCard(front.base64, back?.base64);
      navigation.navigate('ReviewEdit', {
        draft,
        // The rendered copies rather than the originals: this render has already happened for the
        // extractCard call, and reusing it is what keeps Save from uploading the scanner's
        // full-resolution capture. The review screen decodes them faster too.
        localImageUri: front.uri,
        localBackImageUri: back?.uri,
      });
    } catch (e) {
      console.error('Card extraction failed:', e);
      Alert.alert(
        'Scan failed',
        e instanceof CardExtractionError
          ? e.message
          : 'Could not read the card. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  // The front/back choice is a step in this screen rather than an Alert: the review modal is
  // still animating out when scan() resolves, and iOS drops an alert presented against a
  // modal mid-dismissal, so the prompt never reliably appeared.
  const handleScanFront = async () => {
    if (busy) return;
    const result = await scan('Front of card');
    if (result.status === 'ok') {
      setFrontUri(result.uri);
      return;
    }
    alertForScanFailure(result);
  };

  const handleScanBack = async () => {
    if (!frontUri || busy) return;
    const result = await scan('Back of card');
    // Cancelling the back scan returns to the choice step rather than silently committing to
    // a front-only card — "Skip" is there for that, and is the deliberate way to say it.
    if (result.status !== 'ok') {
      alertForScanFailure(result);
      return;
    }
    await finishWithPhotos(frontUri, result.uri);
  };

  const handleSkipBack = async () => {
    if (!frontUri || busy) return;
    await finishWithPhotos(frontUri);
  };

  // Once permission has been refused, requestPermission() resolves without prompting, so the
  // button would just sit there doing nothing. canAskAgain is what tells the two apart.
  const handleRequestCameraPermission = async () => {
    if (permission && !permission.canAskAgain) {
      alertForCameraPermissionDenied();
      return;
    }
    const next = await requestPermission();
    if (!next.granted && !next.canAskAgain) {
      alertForCameraPermissionDenied();
    }
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (qrLocked) return;
    setQrLocked(true);
    const draft = parseQrPayload(result.data);
    navigation.navigate('ReviewEdit', { draft });
  };

  return (
    <View style={styles.container}>
      {/* This screen is black end to end; the app's "auto" status bar resolves to dark content
          under the forced light appearance, which renders black on black. */}
      <StatusBar style="light" />
      {mode === 'qr' &&
        (!permission ? null : !permission.granted ? (
          <View style={styles.permissionContainer}>
            <Text style={styles.permissionText}>RoloAI needs camera access to scan QR codes.</Text>
            <Button style={styles.button} onPress={handleRequestCameraPermission}>
              <Text style={styles.buttonText}>
                {permission.canAskAgain ? 'Grant Camera Access' : 'Open Settings'}
              </Text>
            </Button>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ))}

      {mode === 'photo' &&
        (frontUri ? (
          <View style={styles.photoContainer}>
            <Text style={styles.photoTitle}>Front captured</Text>
            <Image source={{ uri: frontUri }} style={styles.frontPreview} resizeMode="contain" />
            <Text style={styles.photoSubtitle}>
              Many cards have text on both sides (e.g. English/Japanese). Scan the back too?
            </Text>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Button style={styles.scanButton} onPress={handleScanBack}>
                  <Text style={styles.scanButtonText}>Scan Back</Text>
                </Button>
                <Button style={styles.secondaryButton} onPress={handleSkipBack}>
                  <Text style={styles.secondaryButtonText}>Skip — front only</Text>
                </Button>
              </>
            )}
          </View>
        ) : (
          <View style={styles.photoContainer}>
            <Text style={styles.photoTitle}>Scan a business card</Text>
            <Text style={styles.photoSubtitle}>
              The camera will detect the card's edges and crop to just the card, like a document
              scanner.
            </Text>
            <Button style={styles.scanButton} onPress={handleScanFront} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.scanButtonText}>Scan Card</Text>
              )}
            </Button>
          </View>
        ))}

      {/* Scan is a full-bleed headerless screen, so the navigator gives it no back button and
          the iOS edge-swipe is the only way out. Disabled while extracting: finishWithPhotos
          navigates to ReviewEdit on success and would yank a departed user back. */}
      <Button
        style={[styles.cancelButton, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        disabled={busy}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Button>

      {/* Hidden mid-capture: switching to QR would silently discard the front photo. */}
      <View
        style={[styles.modeSwitch, { top: insets.top + 8 }, frontUri && styles.hidden]}
      >
        <Button
          style={[styles.modeButton, mode === 'photo' && styles.modeButtonActive]}
          accessibilityState={{ selected: mode === 'photo' }}
          onPress={() => {
            setMode('photo');
            setQrLocked(false);
          }}
        >
          <Text style={mode === 'photo' ? styles.modeTextActive : styles.modeText}>Photo</Text>
        </Button>
        <Button
          style={[styles.modeButton, mode === 'qr' && styles.modeButtonActive]}
          accessibilityState={{ selected: mode === 'qr' }}
          onPress={() => {
            setMode('qr');
            setQrLocked(false);
          }}
        >
          <Text style={mode === 'qr' ? styles.modeTextActive : styles.modeText}>QR Code</Text>
        </Button>
      </View>

      {mode === 'qr' && (
        <Text style={[styles.hint, { bottom: insets.bottom + 24 }]}>
          Point the camera at a QR code on the card
        </Text>
      )}

      {reviewModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permissionText: { color: '#fff', textAlign: 'center', margin: 24, fontSize: 16 },
  button: { backgroundColor: '#fff', borderRadius: 8, padding: 14, margin: 24, alignItems: 'center' },
  buttonText: { fontWeight: '600' },
  photoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  photoTitle: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  photoSubtitle: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 21,
  },
  scanButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    minWidth: 200,
    alignItems: 'center',
  },
  scanButtonText: { color: '#111', fontWeight: '700', fontSize: 17 },
  frontPreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#111',
    marginBottom: 20,
  },
  secondaryButton: { paddingVertical: 14, paddingHorizontal: 24, marginTop: 4 },
  secondaryButtonText: { color: '#aaa', fontWeight: '600', fontSize: 15 },
  hidden: { display: 'none' },
  cancelButton: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelText: { color: '#fff', fontWeight: '600' },
  modeSwitch: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 4,
  },
  modeButton: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16 },
  modeButtonActive: { backgroundColor: '#fff' },
  modeText: { color: '#fff', fontWeight: '600' },
  modeTextActive: { color: '#111', fontWeight: '600' },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 8,
  },
});
