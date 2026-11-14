import React, { useCallback, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { SymbolView } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { qrUrlDraft } from '@roloai/shared';
import Button from '../components/Button';
import type { RootStackParamList } from '../navigation/types';
import { parseQrPayload } from '../lib/parseCard';
import { forgetPhotos, prefetchPhoto } from '../lib/scanReader';
import { useScanWithReview } from '../lib/useScanWithReview';
import { alertForScanFailure, alertForCameraPermissionDenied } from '../lib/cameraAlerts';
import { haptics } from '../lib/haptics';
import CardScanner from '../../modules/card-scanner';
import { type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type Mode = 'photo' | 'qr';
const MODES: Mode[] = ['photo', 'qr'];

/**
 * The capture task, presented full screen. The camera surface is dark in both appearances (as
 * Camera's is), so this screen's colours are fixed rather than semantic.
 */
export default function ScanScreen({ navigation, route }: Props) {
  const mine = route.params?.mine;
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('photo');
  const [qrLocked, setQrLocked] = useState(false);
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const { scan, review, reviewModal } = useScanWithReview();

  // Backing out of ReviewEdit returns to a still-mounted Scan screen holding the previous
  // attempt's state — reset the QR lock and any leftover front photo on focus.
  useFocusEffect(
    useCallback(() => {
      setQrLocked(false);
      setFrontUri(null);
    }, [])
  );

  /** Hands the accepted photos to the review screen, which reads them. Nothing is awaited here. */
  const finishWithPhotos = (frontPhotoUri: string, backPhotoUri?: string) => {
    navigation.navigate('ReviewEdit', { scan: { frontUri: frontPhotoUri, backUri: backPhotoUri }, mine });
  };

  const acceptFront = (uri: string) => {
    // Start reading now: the Claude call runs while the user decides about the back.
    prefetchPhoto(uri);
    setFrontUri(uri);
  };

  const handleScanFront = async () => {
    const result = await scan('Front of card');
    if (result.status === 'ok') return acceptFront(result.uri);
    alertForScanFailure(result);
  };

  const handleScanBack = async () => {
    if (!frontUri) return;
    const result = await scan('Back of card');
    // Cancelling the back returns to the choice step; "Front Only" is the deliberate way to skip.
    if (result.status !== 'ok') return alertForScanFailure(result);
    finishWithPhotos(frontUri, result.uri);
  };

  /**
   * A card someone sent you, or a photo you already took. The system photo picker runs out of
   * process, so it needs no photo-library permission; the card is then found and straightened
   * the same way a live capture is, and goes through the same review step.
   */
  const handleChoosePhoto = async (side: 'front' | 'back') => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    setImporting(true);
    let uri: string;
    try {
      uri = (await CardScanner.cropCardFromPhoto(picked.assets[0].uri)) ?? picked.assets[0].uri;
    } catch {
      uri = picked.assets[0].uri;
    } finally {
      setImporting(false);
    }
    const result = await review(uri, side === 'front' ? 'Front of card' : 'Back of card');
    if (result.status !== 'ok') return;
    if (side === 'front') acceptFront(result.uri);
    else if (frontUri) finishWithPhotos(frontUri, result.uri);
  };

  // Once permission has been refused, requestPermission() resolves without prompting.
  const handleRequestCameraPermission = async () => {
    if (permission && !permission.canAskAgain) return alertForCameraPermissionDenied();
    const next = await requestPermission();
    if (!next.granted && !next.canAskAgain) alertForCameraPermissionDenied();
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (qrLocked) return;
    setQrLocked(true);
    haptics.impact();
    const draft = parseQrPayload(result.data);
    // A link-only QR goes into Website rather than being dumped into Notes.
    const link = qrUrlDraft(result.data);
    navigation.navigate('ReviewEdit', { draft: link ? { ...draft, notes: undefined, ...link } : draft });
  };

  const close = () => {
    // Leaving mid-capture abandons the front, so its read has no one to hand it to.
    forgetPhotos(frontUri ?? undefined);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {mode === 'qr' &&
        (!permission ? null : !permission.granted ? (
          <View style={styles.permissionContainer}>
            <SymbolView name="qrcode.viewfinder" size={56} tintColor="#8e8e93" />
            <Text style={styles.permissionText}>RoloAI needs camera access to scan QR codes.</Text>
            <Button style={styles.primaryButton} onPress={handleRequestCameraPermission}>
              <Text style={styles.primaryButtonText}>
                {permission.canAskAgain ? 'Allow Camera Access' : 'Open Settings'}
              </Text>
            </Button>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.reticle} pointerEvents="none" />
            <Text style={[styles.hint, { bottom: insets.bottom + 32 }]} accessibilityLiveRegion="polite">
              Point the camera at the QR code on the card
            </Text>
          </>
        ))}

      {mode === 'photo' &&
        (frontUri ? (
          <View style={styles.photoContainer}>
            <Text style={styles.title} accessibilityRole="header">
              Front Captured
            </Text>
            <Image
              source={{ uri: frontUri }}
              style={styles.frontPreview}
              resizeMode="contain"
              accessible
              accessibilityLabel="Front of the card"
            />
            <Text style={styles.subtitle}>
              Many cards have details on both sides — English and Japanese, say. Add the back too?
            </Text>
            <Button style={styles.primaryButton} onPress={handleScanBack}>
              <SymbolView name="camera.fill" size={18} tintColor="#000" />
              <Text style={styles.primaryButtonText}>Scan Back</Text>
            </Button>
            <Button style={styles.secondaryButton} onPress={() => handleChoosePhoto('back')}>
              <Text style={styles.secondaryButtonText}>Choose Back from Photos</Text>
            </Button>
            <Button style={styles.secondaryButton} onPress={() => finishWithPhotos(frontUri)}>
              <Text style={styles.secondaryButtonText}>Front Only</Text>
            </Button>
          </View>
        ) : (
          <View style={styles.photoContainer}>
            <SymbolView name="camera.viewfinder" size={64} tintColor="#fff" />
            <Text style={styles.title} accessibilityRole="header">
              {mine ? 'Scan Your Card' : 'Scan a Business Card'}
            </Text>
            <Text style={styles.subtitle}>
              Hold the card flat. RoloAI finds the edges and takes the photo when it’s sharp — or tap
              the shutter yourself.
            </Text>
            <Button style={styles.primaryButton} onPress={handleScanFront}>
              <SymbolView name="camera.fill" size={18} tintColor="#000" />
              <Text style={styles.primaryButtonText}>Scan Card</Text>
            </Button>
            <Button style={styles.secondaryButton} onPress={() => handleChoosePhoto('front')}>
              <Text style={styles.secondaryButtonText}>Choose from Photos</Text>
            </Button>
          </View>
        ))}

      <Button
        style={[styles.closeButton, { top: insets.top + 8 }]}
        onPress={close}
        accessibilityLabel="Close"
      >
        <SymbolView name="xmark" size={16} weight="semibold" tintColor="#fff" />
      </Button>

      {/* Hidden mid-capture: switching to QR would silently discard the front photo. */}
      {!frontUri && !mine && (
        <View style={[styles.modeSwitch, { top: insets.top + 10 }]}>
          <SegmentedControl
            values={['Photo', 'QR Code']}
            selectedIndex={MODES.indexOf(mode)}
            appearance="dark"
            onChange={(e) => {
              haptics.selection();
              setMode(MODES[e.nativeEvent.selectedSegmentIndex]);
              setQrLocked(false);
            }}
            accessibilityLabel="Scan mode"
          />
        </View>
      )}

      {importing && (
        <View style={styles.importing} accessibilityLiveRegion="polite" accessibilityLabel="Finding the card in the photo">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {reviewModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  permissionText: { ...type.body, color: '#fff', textAlign: 'center' },
  photoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { ...type.title2, color: '#fff', textAlign: 'center' },
  subtitle: { ...type.subheadline, color: '#aeaeb2', textAlign: 'center', marginBottom: 16 },
  primaryButton: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    minHeight: 50,
    paddingHorizontal: 32,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { ...type.headline, color: '#000' },
  secondaryButton: { minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' },
  secondaryButtonText: { ...type.body, color: '#0a84ff' },
  frontPreview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#1c1c1e' },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(118,118,128,0.4)',
  },
  modeSwitch: { position: 'absolute', alignSelf: 'center', width: 200 },
  reticle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  hint: {
    ...type.subheadline,
    position: 'absolute',
    alignSelf: 'center',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    overflow: 'hidden',
  },
  importing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
