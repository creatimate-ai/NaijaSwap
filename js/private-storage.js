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

/**
 * Securely uploads private KYC documents directly to Cloudinary.
 * Bypasses non-existent Firebase Storage buckets to eliminate CORS preflight failures.
 */
export async function uploadPrivateKycDocument(data, uid, kind) {
  if (!data) {
    throw new Error('No verification document was provided.');
  }

  // Already a remote HTTPS asset (e.g. prefilled from profile)
  if (typeof data === 'string' && data.startsWith('http')) {
    return data;
  }

  const fileOrBlob = typeof data === 'string' && data.startsWith('data:')
    ? dataUrlToBlob(data)
    : data;

  if (fileOrBlob instanceof Blob && fileOrBlob.size > 10 * 1024 * 1024) {
    throw new Error('KYC documents must be valid files smaller than 10 MB.');
  }

  // Upload directly to Cloudinary under the dealer's dedicated verification directory
  const secureUrl = await uploadToCloudinary(fileOrBlob, `naijaswap/${uid}/${kind}`);
  if (!secureUrl) {
    throw new Error('Could not upload verification document to secure storage. Please try again.');
  }
  return secureUrl;
}
