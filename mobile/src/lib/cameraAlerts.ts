import { Alert, Linking } from 'react-native';
import type { CardScanResult } from './documentScanner';

/**
 * Explains a failed scan, and stays silent on a cancel.
 *
 * A denial is the one that matters: iOS will not prompt again once the user has said no, so the
 * app has to say what is unavailable and offer the only route that can fix it. Without this the
 * scan button simply appears dead, forever, with nothing on screen to explain why.
 */
export function alertForScanFailure(result: CardScanResult): void {
  switch (result.status) {
    case 'denied':
      Alert.alert(
        'Camera Access Needed',
        'RoloAI needs camera access to scan business cards. You can turn it on in Settings.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]
      );
      break;
    case 'unavailable':
      Alert.alert(
        'Camera Unavailable',
        'RoloAI could not start the camera. Close any other app that might be using it, then try again.'
      );
      break;
    default:
      break;
  }
}

/** Same treatment for the QR scanner, which goes through expo-camera's permission hook. */
export function alertForCameraPermissionDenied(): void {
  Alert.alert(
    'Camera Access Needed',
    'RoloAI needs camera access to scan QR codes. You can turn it on in Settings.',
    [
      { text: 'Not Now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ]
  );
}
