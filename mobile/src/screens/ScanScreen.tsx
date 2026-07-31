import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { parseQrPayload } from '../lib/parseCard';
import { extractCard } from '../lib/functions';
import { prepareImageForUpload } from '../lib/documentScanner';
import { useScanWithReview } from '../lib/useScanWithReview';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type Mode = 'photo' | 'qr';

export default function ScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('photo');
  const [busy, setBusy] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);
  const { scan, reviewModal } = useScanWithReview();

  // Backing out of ReviewEdit returns to a still-mounted Scan screen with the lock set, which
  // would leave the QR camera silently ignoring every code — clear it whenever we regain focus.
  useFocusEffect(useCallback(() => setQrLocked(false), []));

  const finishWithPhotos = async (frontPhotoUri: string, backPhotoUri?: string) => {
    setBusy(true);
    try {
      const frontBase64 = await prepareImageForUpload(frontPhotoUri);
      const backBase64 = backPhotoUri ? await prepareImageForUpload(backPhotoUri) : undefined;
      const draft = await extractCard(frontBase64, backBase64);
      navigation.navigate('ReviewEdit', {
        draft,
        localImageUri: frontPhotoUri,
        localBackImageUri: backPhotoUri,
      });
    } catch (e) {
      console.error('Card extraction failed:', e);
      Alert.alert('Scan failed', 'Could not read the card. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleScanBack = async (frontUri: string) => {
    const backUri = await scan('Back of card');
    await finishWithPhotos(frontUri, backUri ?? undefined);
  };

  const handleScanFront = async () => {
    if (busy) return;
    const frontUri = await scan('Front of card');
    if (!frontUri) return;

    Alert.alert(
      'Front captured',
      'Many cards have text on both sides (e.g. English/Japanese) — scan the back too?',
      [
        { text: 'Skip', style: 'cancel', onPress: () => finishWithPhotos(frontUri) },
        { text: 'Scan Back', onPress: () => handleScanBack(frontUri) },
      ]
    );
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (qrLocked) return;
    setQrLocked(true);
    const draft = parseQrPayload(result.data);
    navigation.navigate('ReviewEdit', { draft });
  };

  return (
    <View style={styles.container}>
      {mode === 'qr' &&
        (!permission ? null : !permission.granted ? (
          <View style={styles.permissionContainer}>
            <Text style={styles.permissionText}>RoloAI needs camera access to scan QR codes.</Text>
            <Pressable style={styles.button} onPress={requestPermission}>
              <Text style={styles.buttonText}>Grant Camera Access</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        ))}

      {mode === 'photo' && (
        <View style={styles.photoContainer}>
          <Text style={styles.photoTitle}>Scan a business card</Text>
          <Text style={styles.photoSubtitle}>
            The camera will detect the card's edges and crop to just the card, like a document
            scanner.
          </Text>
          <Pressable style={styles.scanButton} onPress={handleScanFront} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.scanButtonText}>Scan Card</Text>
            )}
          </Pressable>
        </View>
      )}

      <View style={styles.modeSwitch}>
        <Pressable
          style={[styles.modeButton, mode === 'photo' && styles.modeButtonActive]}
          onPress={() => {
            setMode('photo');
            setQrLocked(false);
          }}
        >
          <Text style={mode === 'photo' ? styles.modeTextActive : styles.modeText}>Photo</Text>
        </Pressable>
        <Pressable
          style={[styles.modeButton, mode === 'qr' && styles.modeButtonActive]}
          onPress={() => {
            setMode('qr');
            setQrLocked(false);
          }}
        >
          <Text style={mode === 'qr' ? styles.modeTextActive : styles.modeText}>QR Code</Text>
        </Pressable>
      </View>

      {mode === 'qr' && <Text style={styles.hint}>Point the camera at a QR code on the card</Text>}

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
  modeSwitch: {
    position: 'absolute',
    top: 60,
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
    bottom: 60,
    alignSelf: 'center',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 8,
  },
});
