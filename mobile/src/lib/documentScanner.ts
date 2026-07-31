import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';

/**
 * Launches Apple's document scanner (edge detection + perspective crop).
 *
 * VisionKit is built for multi-page documents: it auto-captures continuously for as long as it
 * can see a card, and offers no way to cap the page count on iOS (`maxNumDocuments` is
 * Android-only) or to hook each capture — the delegate only fires once the user taps Save. So a
 * single session normally comes back with several shots of the same card. All of them are
 * returned rather than just the first, so the caller can let the user pick the best one.
 *
 * Returns an empty array if the user cancels.
 */
export async function scanCardEdge(): Promise<string[]> {
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    responseType: ResponseType.ImageFilePath,
    croppedImageQuality: 90,
  });
  if (status === ScanDocumentResponseStatus.Cancel || !scannedImages?.length) {
    return [];
  }
  return scannedImages;
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
