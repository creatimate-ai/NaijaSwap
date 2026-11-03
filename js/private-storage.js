import { auth, storage, storageRef, uploadBytes, getDownloadURL } from './firebase-config.js';
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
 * Securely uploads private KYC documents.
 * Prioritizes authenticated Firebase Storage under /kyc/{uid}/* (governed by storage.rules).
 * Falls back to Cloudinary only if Firebase Storage is unavailable.
 */
export async function uploadPrivateKycDocument(data, uid, kind) {
  const blob = typeof data === 'string' && data.startsWith('data:')
    ? dataUrlToBlob(data)
    : data;
  if (!(blob instanceof Blob) || blob.size > 10 * 1024 * 1024) {
    throw new Error('KYC documents must be valid files smaller than 10 MB.');
  }

  // 1. Primary: Upload to authenticated Firebase Storage (Restricted to owner & admin)
  if (storage && auth.currentUser) {
    try {
      const ext = blob.type === 'application/pdf' ? 'pdf' : 'jpg';
      const safePath = `kyc/${uid}/${kind}_${Date.now()}.${ext}`;
      const fileRef = storageRef(storage, safePath);
      const snapshot = await uploadBytes(fileRef, blob, {
        contentType: blob.type || 'image/jpeg',
        customMetadata: { uploadedBy: uid, docKind: kind }
      });
      const downloadUrl = await getDownloadURL(snapshot.ref);
      return downloadUrl;
    } catch (fbErr) {
      console.warn('[PrivateStorage] Firebase Storage upload notice:', fbErr.message);
    }
  }

  // 2. Fallback: Cloudinary
  const secureUrl = await uploadToCloudinary(blob, `naijaswap/${uid}/${kind}`);
  if (!secureUrl) {
    throw new Error('Could not upload verification document. Please try again.');
  }
  return secureUrl;
}
