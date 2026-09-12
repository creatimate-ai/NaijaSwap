import {
  auth,
  storageRef,
  uploadBytes,
  getDownloadURL
} from './firebase-config.js';

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl).split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const binary = atob(encoded || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

export async function uploadPrivateKycDocument(data, uid, kind) {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Your authentication session has expired. Please sign in again.');
  }
  const blob = typeof data === 'string' && data.startsWith('data:')
    ? dataUrlToBlob(data)
    : data;
  if (!(blob instanceof Blob) || blob.size > 10 * 1024 * 1024) {
    throw new Error('KYC documents must be valid files smaller than 10 MB.');
  }
  const extension = blob.type === 'application/pdf' ? 'pdf' : 'jpg';
  const fileRef = storageRef(`kyc/${uid}/${kind}_${crypto.randomUUID()}.${extension}`);
  await uploadBytes(fileRef, blob, { contentType: blob.type || 'application/octet-stream' });
  return getDownloadURL(fileRef);
}
