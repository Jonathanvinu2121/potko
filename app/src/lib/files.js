// Picking files and pictures from the device, and saving files the server makes
// (import templates, error reports). Works on a phone and in a browser.
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { api, authHeader, fileUrl } from './api';
import { serverUrl } from './server';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return out;
}

const SHEETS = ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/csv'];
const MAX_SHEET = 5 * 1024 * 1024;

// Lets the person choose a .csv or .xlsx file. Resolves { name, data } (data is base64), or null
// if they backed out. Throws a readable message for a file that is too big or the wrong kind.
export async function pickSpreadsheet() {
  const result = await DocumentPicker.getDocumentAsync({ type: Platform.OS === 'web' ? ['.csv', '.xlsx', ...SHEETS] : SHEETS, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  if (!/\.(csv|xlsx)$/i.test(asset.name)) throw new Error(/\.xls$/i.test(asset.name) ? 'Old .xls files are not supported. Save the file as .xlsx or .csv first.' : 'Choose a .csv or .xlsx file');
  if (asset.size && asset.size > MAX_SHEET) throw new Error('The file is larger than 5 MB');
  let bytes;
  if (Platform.OS === 'web' && asset.file) bytes = new Uint8Array(await asset.file.arrayBuffer());
  else bytes = await new File(asset.uri).bytes();
  if (bytes.length > MAX_SHEET) throw new Error('The file is larger than 5 MB');
  return { name: asset.name, data: toBase64(bytes) };
}

// Lets the person choose a picture, makes it small (so it loads fast and fits the database),
// saves it on the server and resolves its id. Resolves null if they backed out.
export async function pickAndUploadPicture({ size = 512, square = true } = {}) {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: square, aspect: [1, 1], quality: 0.9 });
  if (result.canceled || !result.assets?.[0]) return null;
  const small = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: size } }], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!small.base64) throw new Error('That picture could not be read. Try another one.');
  const { id } = await api('/images', { method: 'POST', body: { data: small.base64 }, timeout: 30000 });
  return id;
}

// Saves a file the server makes. In a browser it downloads; on a phone it is fetched and handed
// to the share sheet, where it can be saved to Files, sent by WhatsApp or opened in Excel.
export async function saveServerFile(path, name, mimeType) {
  if (Platform.OS === 'web') {
    window.open(fileUrl(path), '_blank');
    return;
  }
  const target = new File(Paths.cache, name);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(`${serverUrl()}${path}`, target, { headers: authHeader() });
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
