import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { measurePickedFile } from './file-transfer';
import type { PickedDeviceFile } from './file-upload';

/** Where a file is picked from on the device. */
export type DevicePickSource = 'files' | 'photos';

export type DevicePickResult =
  | { kind: 'picked'; file: PickedDeviceFile }
  | { kind: 'cancelled' }
  /** Photo library access refused; the person can allow it in Settings or pick from Files. */
  | { kind: 'denied'; canAskAgain: boolean };

/**
 * MOB-026: one file from Files (any type — unsupported ones are refused with
 * the website's message rather than hidden) or one photo/video. The picker
 * copies it into the app's cache; nothing is read until the person uploads.
 */
export const pickDeviceFile = async (source: DevicePickSource): Promise<DevicePickResult> => {
  if (source === 'files') {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return { kind: 'cancelled' };
    return {
      kind: 'picked',
      file: { uri: asset.uri, name: asset.name, size: asset.size ?? measurePickedFile(asset.uri), mimeType: asset.mimeType ?? null },
    };
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: false,
    quality: 1,
    // iOS hands over HEIC photos as JPEG, which every client (and browser) can show.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return { kind: 'cancelled' };
  const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'photo';
  return {
    kind: 'picked',
    file: { uri: asset.uri, name, size: asset.fileSize ?? measurePickedFile(asset.uri), mimeType: asset.mimeType ?? null },
  };
};
