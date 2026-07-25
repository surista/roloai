import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { parseOcrText, parseQrPayload } from '../lib/parseCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type Mode = 'photo' | 'qr';
type CaptureStage = 'front' | 'back';

export default function ScanScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('photo');
  const [busy, setBusy] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);
  const [captureStage, setCaptureStage] = useState<CaptureStage>('front');
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>RoloAI needs camera access to scan cards.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  const resetCapture = () => {
    setBusy(false);
    setCaptureStage('front');
    setFrontUri(null);
  };

  const finishWithPhotos = async (frontPhotoUri: string, backPhotoUri?: string) => {
    setBusy(true);
    try {
      const result = await TextRecognition.recognize(frontPhotoUri);
      const draft = parseOcrText(result.text);
      navigation.navigate('ReviewEdit', {
        draft,
        localImageUri: frontPhotoUri,
        localBackImageUri: backPhotoUri,
      });
    } catch (e) {
      Alert.alert('Scan failed', 'Could not read the card. Try again with better lighting.');
    } finally {
      resetCapture();
    }
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || busy) return;

    if (captureStage === 'front') {
      setBusy(true);
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        if (!photo) return;
        setFrontUri(photo.uri);
        setBusy(false);
        setCaptureStage('back');
        Alert.alert(
          'Front captured',
          'Many cards have text on both sides (e.g. English/Japanese) — take a photo of the back too?',
          [
            { text: 'Skip', style: 'cancel', onPress: () => finishWithPhotos(photo.uri) },
            { text: 'Add Back Photo', onPress: () => {} },
          ]
        );
      } catch (e) {
        Alert.alert('Scan failed', 'Could not read the card. Try again with better lighting.');
        resetCapture();
      }
      return;
    }

    // captureStage === 'back'
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo || !frontUri) return;
      await finishWithPhotos(frontUri, photo.uri);
    } catch (e) {
      Alert.alert('Scan failed', 'Could not read the back photo. Try again.');
      resetCapture();
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
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        barcodeScannerSettings={mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={mode === 'qr' ? handleBarcodeScanned : undefined}
      />

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

      {mode === 'photo' && captureStage === 'back' && (
        <View style={styles.backStageBanner}>
          <Text style={styles.backStageText}>Now: back of card</Text>
          <Pressable onPress={() => frontUri && finishWithPhotos(frontUri)}>
            <Text style={styles.backStageSkip}>Skip</Text>
          </Pressable>
        </View>
      )}

      {mode === 'photo' && (
        <Pressable style={styles.shutter} onPress={handleTakePhoto} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
        </Pressable>
      )}

      {mode === 'qr' && <Text style={styles.hint}>Point the camera at a QR code on the card</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionText: { color: '#fff', textAlign: 'center', margin: 24, fontSize: 16 },
  button: { backgroundColor: '#fff', borderRadius: 8, padding: 14, margin: 24, alignItems: 'center' },
  buttonText: { fontWeight: '600' },
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
  shutter: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  hint: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 8,
  },
  backStageBanner: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  backStageText: { color: '#fff', fontWeight: '600' },
  backStageSkip: { color: '#8ecbff', fontWeight: '700' },
});
