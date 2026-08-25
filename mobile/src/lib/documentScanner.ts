import { Image } from 'react-native';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
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

/**
 * The size and quality every card image is stored and sent at.
 *
 * The scanner writes its crop at the capture buffer's full resolution and q0.9, which is several
 * megabytes a side — uploading that verbatim was most of what "Save" was waiting on. 1600px is
 * comfortably above what either app displays, and q0.8 rather than the 0.7 that was fine for a
 * throwaway vision-call input, since this file is now the stored copy of the card.
 */
const UPLOAD_MAX_WIDTH = 1600;
const UPLOAD_QUALITY = 0.8;

/**
 * Renders a local image at upload size and returns both the file and its base64 data.
 *
 * One render serves both purposes: the base64 goes to extractCard and the same file is what gets
 * stored, so the save no longer re-encodes anything or ships the full-resolution original.
 */
export async function prepareImageForUpload(uri: string): Promise<{ uri: string; base64: string }> {
  const rendered = await renderAtMostWide(uri, UPLOAD_MAX_WIDTH);
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: UPLOAD_QUALITY,
    base64: true,
  });
  if (!result.base64) throw new Error('Failed to encode image');
  return { uri: result.uri, base64: result.base64 };
}

/** Every other caller here just wants the saved file's uri, at some quality. */
async function saveJpegUri(rendered: ImageRef, compress: number): Promise<string> {
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
  return result.uri;
}

/**
 * As {@link prepareImageForUpload}, without the base64. Used by the retake-on-a-saved-card path,
 * which replaces the stored image but never calls extractCard.
 */
export async function renderForUpload(uri: string): Promise<string> {
  return saveJpegUri(await renderAtMostWide(uri, UPLOAD_MAX_WIDTH), UPLOAD_QUALITY);
}

/**
 * Rotates a local image clockwise by `degrees`, returning the new file.
 *
 * Callers pass the total rotation from the original capture rather than turning the previous
 * result again: every rotation is a fresh JPEG encode, and four taps around the compass would
 * otherwise be four generations of loss on a photo the whole app exists to read.
 */
export async function rotateImage(uri: string, degrees: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.rotate(degrees);
  return saveJpegUri(await context.renderAsync(), UPLOAD_QUALITY);
}

/**
 * Writes a small copy of the image for list views and returns its local uri.
 *
 * 400px wide covers a 48pt row thumb on the densest iPhone and the web grid's 220px tile with
 * room to spare, at a fraction of a percent of the full image's bytes. Without it, both list
 * views download and decode the multi-megabyte original once per row.
 */
export async function makeThumbnail(uri: string): Promise<string> {
  return saveJpegUri(await renderAtMostWide(uri, 400), 0.6);
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
