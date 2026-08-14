import { NativeModule, requireNativeModule } from 'expo';

export type CardScanResult =
  /** `uri` is a `file://` path to the cropped JPEG. */
  | { status: 'ok'; uri: string }
  /** The user tapped Cancel — expected, and the caller should stay silent. */
  | { status: 'cancelled' }
  /** Camera permission refused. Only the Settings app can restore it, so say so. */
  | { status: 'denied' }
  /** No usable camera (in use by another app, or a simulator). */
  | { status: 'unavailable' };

declare class CardScannerModule extends NativeModule<Record<never, never>> {
  /**
   * Presents the auto-capturing card scanner. Resolves only after the scanner has fully
   * dismissed. The four outcomes are kept apart deliberately: collapsing them into one nullable
   * value made a permission denial — which is permanent until the user visits Settings —
   * indistinguishable from a cancel, so the app looked like it was ignoring the button.
   */
  scanCard(): Promise<CardScanResult>;
}

export default requireNativeModule<CardScannerModule>('CardScanner');
