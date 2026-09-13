import { uploadToCloudinary } from './cloudinary-config.js';

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
  const blob = typeof data === 'string' && data.startsWith('data:')
    ? dataUrlToBlob(data)
    : data;
  if (!(blob instanceof Blob) || blob.size > 10 * 1024 * 1024) {
    throw new Error('KYC documents must be valid files smaller than 10 MB.');
  }
  const secureUrl = await uploadToCloudinary(blob, `naijaswap/${uid}/${kind}`);
  if (!secureUrl) {
    throw new Error('Cloudinary is not configured for document uploads.');
  }
  return secureUrl;
}
