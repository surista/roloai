import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import CardScanner, { type CardScanResult } from '../../modules/card-scanner';

export type { CardScanResult };

/**
 * Launches the card scanner (live edge detection, single auto-capture, perspective crop).
 *
 * This replaced Apple's VNDocumentCameraViewController, which auto-captures continuously and
 * reports back only once the user taps Save — no page limit, no per-capture delegate — so it
 * could never freeze on the shot it just took and wait for confirmation. The native module
 * stops after one capture and resolves only once it has fully dismissed, so the caller can put
 * the photo straight in front of the user.
 */
export async function scanCardEdge(): Promise<CardScanResult> {
  return CardScanner.scanCard();
}

/** Resizes/compresses a local image and returns its base64 data, ready for the extractCard function. */
export async function prepareImageForUpload(uri: string): Promise<string> {
  const rendered = await renderAtMostWide(uri, 1600);
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });
  if (!result.base64) throw new Error('Failed to encode image');
  return result.base64;
}

/**
 * Writes a small copy of the image for list views and returns its local uri.
 *
 * 400px wide covers a 48pt row thumb on the densest iPhone and the web grid's 220px tile with
 * room to spare, at a fraction of a percent of the full image's bytes. Without it, both list
 * views download and decode the multi-megabyte original once per row.
 */
export async function makeThumbnail(uri: string): Promise<string> {
  const rendered = await renderAtMostWide(uri, 400);
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
  return result.uri;
}

/**
 * Renders `uri` at no more than `maxWidth`, leaving anything already narrower alone — scaling up
 * costs bytes on both the upload and the Claude call while adding no detail.
 *
 * Dimensions come from `Image.getSize` (a header read) rather than from rendering the image once
 * to measure it and again to resize it, which would decode a 12MP capture twice.
 */
async function renderAtMostWide(uri: string, maxWidth: number) {
  const context = ImageManipulator.manipulate(uri);
  const { width } = await imageSize(uri);
  if (width > maxWidth) {
    context.resize({ width: maxWidth, height: null });
  }
  return context.renderAsync();
}

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}
