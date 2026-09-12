/**
 * NigerSwap - Cloudinary Configuration & Uploader
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
export async function uploadToCloudinary(fileOrDataUrl, folder = 'NaijaSwap') {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Upload failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error('[Cloudinary] Upload failed:', error);
    if (error.name === 'AbortError') {
      throw new Error('Cloudinary upload timed out. Please check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
