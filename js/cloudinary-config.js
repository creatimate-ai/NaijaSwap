/**
 * NaijaSwap - Cloudinary Configuration & Uploader
 * Direct unsigned browser upload to Cloudinary.
 */

export const CLOUDINARY_CONFIG = {
  cloudName: 'jra2fgxo',
  uploadPreset: 'NaijaSwap',
  apiKey: '752597565682594'
};

/**
 * Uploads an image or document (file object, blob, or base64 dataUrl) directly to Cloudinary
 * Returns the secure HTTPS URL (https://res.cloudinary.com/...)
 */
export async function uploadToCloudinary(fileOrDataUrl, folder = 'NaijaSwap', onProgress) {
  if (!CLOUDINARY_CONFIG.cloudName || !CLOUDINARY_CONFIG.uploadPreset) {
    console.warn('[Cloudinary] Cloud Name or Upload Preset is not configured yet.');
    return null;
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/auto/upload`;
  const formData = new FormData();
  formData.append('file', fileOrDataUrl);
  formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  if (CLOUDINARY_CONFIG.apiKey) {
    formData.append('api_key', CLOUDINARY_CONFIG.apiKey);
  }
  if (folder) {
    formData.append('folder', folder);
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(event.loaded, event.total);
      }
    });
    request.addEventListener('load', () => {
      let data;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error('Cloudinary returned an invalid upload response.'));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error?.message || `Upload failed with status ${request.status}`));
        return;
      }
      resolve(data.secure_url || null);
    });
    request.addEventListener('error', () => {
      reject(new Error('Cloudinary upload failed. Check your connection and try again.'));
    });
    request.addEventListener('timeout', () => {
      reject(new Error('Cloudinary upload timed out. Please check your connection and try again.'));
    });
    request.addEventListener('abort', () => {
      reject(new Error('Cloudinary upload timed out. Please check your connection and try again.'));
    });

    request.open('POST', url);
    request.timeout = 30000;
    request.send(formData);
  });
}
