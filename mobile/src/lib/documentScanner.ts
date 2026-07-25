import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';

/** Launches Apple's document scanner (edge detection + perspective crop). Returns null if the user cancels. */
export async function scanCardEdge(): Promise<string | null> {
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    responseType: ResponseType.ImageFilePath,
    croppedImageQuality: 90,
  });
  if (status === ScanDocumentResponseStatus.Cancel || !scannedImages?.length) {
    return null;
  }
  return scannedImages[0];
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
