import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

/** Longest side of an uploaded photo: plenty to read a receipt, a transfer proof or a delivery note. */
const MAX_PHOTO_EDGE = 1600;
const PHOTO_QUALITY = 0.7;

/**
 * Shrinks picked photos before they are uploaded. A full-size phone photo is several MB, and the API (on Vercel)
 * rejects any request above 4.5 MB before it reaches the server, so one or two camera photos already fail the upload.
 * Photos come back as JPEG of at most MAX_PHOTO_EDGE px (usually a few hundred KB). Web keeps the browser's File;
 * a photo that cannot be processed is sent as it is.
 */
export async function shrinkPhotos(assets: ImagePickerAsset[]): Promise<ImagePickerAsset[]> {
  if (Platform.OS === 'web') return assets;
  return Promise.all(assets.map(async (asset) => {
    try {
      let context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > MAX_PHOTO_EDGE) {
        context = context.resize(asset.width >= asset.height ? { width: MAX_PHOTO_EDGE } : { height: MAX_PHOTO_EDGE });
      }
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
      const name = (asset.fileName ?? asset.uri.split('/').pop() ?? 'foto').replace(/\.[^.]+$/, '');
      return { ...asset, uri: saved.uri, width: saved.width, height: saved.height, fileName: `${name}.jpg`, mimeType: 'image/jpeg', fileSize: undefined };
    } catch {
      return asset;
    }
  }));
}
