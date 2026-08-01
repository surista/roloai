import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import CardScanner from '../../modules/card-scanner';

/**
 * Launches the card scanner (live edge detection, single auto-capture, perspective crop) and
 * returns the cropped image, or null if the user cancelled or denied camera access.
 *
 * This replaced Apple's VNDocumentCameraViewController, which auto-captures continuously and
 * reports back only once the user taps Save — no page limit, no per-capture delegate — so it
 * could never freeze on the shot it just took and wait for confirmation. The native module
 * stops after one capture and resolves only once it has fully dismissed, so the caller can put
 * the photo straight in front of the user.
 */
export async function scanCardEdge(): Promise<string | null> {
  return CardScanner.scanCard();
}

/** Resizes/compresses a local image and returns its base64 data, ready for the extractCard function. */
export async function prepareImageForUpload(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1600, height: null });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });
  if (!result.base64) throw new Error('Failed to encode image');
  return result.base64;
}
