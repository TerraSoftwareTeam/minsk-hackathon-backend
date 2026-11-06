/** Cloudinary folder of this project, separate from other projects on the same account. */
export const IMAGE_UPLOAD_FOLDER = 'minsk_hackathon_images';
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
/**
 * Accepted formats. No SVG: it may carry scripts (XSS when opened directly).
 * The type is detected from the file bytes, not taken from the client.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
