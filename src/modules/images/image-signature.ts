import { AllowedImageMimeType } from './images.constants';

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length &&
  bytes.every((byte, i) => buffer[offset + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The image type by the file's magic bytes, or null if it is none of the allowed formats. */
export function detectImageMimeType(
  buffer: Buffer | undefined,
): AllowedImageMimeType | null {
  if (!buffer) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (
    startsWith(buffer, ascii('GIF87a')) ||
    startsWith(buffer, ascii('GIF89a'))
  )
    return 'image/gif';
  if (startsWith(buffer, ascii('RIFF')) && startsWith(buffer, ascii('WEBP'), 8))
    return 'image/webp';
  return null;
}
