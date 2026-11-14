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

type Events = {
  /** A Spotlight result for this card was tapped while the app was running. */
  onOpenCard: (event: { id: string }) => void;
};

declare class CardScannerModule extends NativeModule<Events> {
  /**
   * Presents the auto-capturing card scanner. Resolves only after the scanner has fully
   * dismissed. The four outcomes are kept apart deliberately: collapsing them into one nullable
   * value made a permission denial — which is permanent until the user visits Settings —
   * indistinguishable from a cancel, so the app looked like it was ignoring the button.
   */
  scanCard(): Promise<CardScanResult>;
  /** Crops and straightens the card in a library photo; the photo as-is if no card is found. */
  cropCardFromPhoto(uri: string): Promise<string | null>;
  /** One share sheet for several local files. Resolves whether the user completed a share. */
  shareFiles(uris: string[]): Promise<boolean>;
  /** Replaces the Spotlight index with these cards. `keywords` is newline-separated. */
  indexCards(items: { id: string; title: string; subtitle?: string; keywords?: string }[]): Promise<void>;
  removeFromSpotlight(ids: string[]): Promise<void>;
  clearSpotlight(): Promise<void>;
  /** The card a Spotlight tap cold-launched the app for, once. */
  takePendingCardId(): string | null;
}

export default requireNativeModule<CardScannerModule>('CardScanner');
