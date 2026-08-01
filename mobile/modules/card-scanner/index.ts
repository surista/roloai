import { NativeModule, requireNativeModule } from 'expo';

declare class CardScannerModule extends NativeModule<Record<never, never>> {
  /**
   * Presents the auto-capturing card scanner. Resolves with a `file://` path to the cropped
   * JPEG, or null if the user cancelled or denied camera access. Resolves only after the
   * scanner has fully dismissed.
   */
  scanCard(): Promise<string | null>;
}

export default requireNativeModule<CardScannerModule>('CardScanner');
