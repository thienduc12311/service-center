import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import type { PickedDeviceFile } from './file-upload';
import { measurePickedFile } from './file-transfer';
import { newIdempotencyKey } from './idempotency';
import { SCAN_PAGE_QUALITY, scanFileName, scanPageResize, scanPdfPrintOptions, type ScanPage } from './scan-pdf';

/**
 * MOB-030 device I/O for a scan: take (or pick) one page photo, downsize it,
 * and write the reviewed pages into one PDF that becomes the picked file of
 * the MOB-026 upload. Nothing here talks to the server; pages and PDFs live
 * in a private cache folder that is cleared when a new scan starts.
 */

/** Where a page comes from: the camera, or a photo already on the phone. */
export type ScanPageSource = 'camera' | 'photos';

export type ScanCaptureResult =
  | { kind: 'page'; page: ScanPage }
  | { kind: 'cancelled' }
  /** Camera or photo access refused; Settings is the way back. */
  | { kind: 'denied'; source: ScanPageSource }
  /** No camera on this device (for instance the iOS Simulator). */
  | { kind: 'unavailable' };

const scanRoot = (): Directory => new Directory(Paths.cache, 'scans');

/** Removes every page and PDF from earlier scans. */
export const clearScans = (): void => {
  try {
    const root = scanRoot();
    if (root.exists) root.delete();
  } catch {
    // Cache storage: the OS clears it too. Nothing else depends on it.
  }
};

const downsize = async (uri: string, width: number, height: number): Promise<ScanPage> => {
  const context = ImageManipulator.manipulate(uri);
  const resize = scanPageResize(width, height);
  if (resize) context.resize(resize);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: SCAN_PAGE_QUALITY });
  return { id: newIdempotencyKey(), uri: saved.uri, width: saved.width, height: saved.height };
};

export const captureScanPage = async (source: ScanPageSource): Promise<ScanCaptureResult> => {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'denied', source };
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    } catch {
      // expo-image-picker rejects when the device has no camera.
      return { kind: 'unavailable' };
    }
    const asset = result.canceled ? null : result.assets[0];
    return asset ? { kind: 'page', page: await downsize(asset.uri, asset.width, asset.height) } : { kind: 'cancelled' };
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: 'denied', source };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = result.canceled ? null : result.assets[0];
  return asset ? { kind: 'page', page: await downsize(asset.uri, asset.width, asset.height) } : { kind: 'cancelled' };
};

/** Writes the reviewed pages, in order, into one PDF ready to upload. */
export const writeScanPdf = async (pages: readonly ScanPage[], now: Date = new Date()): Promise<PickedDeviceFile> => {
  const images = await Promise.all(pages.map(async (page) => `data:image/jpeg;base64,${await new File(page.uri).base64()}`));
  const name = scanFileName(now);
  const { uri } = await Print.printToFileAsync(scanPdfPrintOptions(images, name.replace(/\.pdf$/, '')));
  const folder = new Directory(scanRoot(), newIdempotencyKey());
  folder.create({ intermediates: true, idempotent: true });
  const written = new File(uri);
  written.moveSync(folder);
  // `rename` takes the name as written (a joined `File` path would percent-encode it).
  written.rename(name);
  return { uri: written.uri, name, size: measurePickedFile(written.uri), mimeType: 'application/pdf' };
};
