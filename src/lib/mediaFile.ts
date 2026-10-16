import {
  MAX_MEDIA_BYTES,
  MEDIA_CONTENT_TYPES,
  ContentValidationError,
  type MediaDraft,
} from './contentModel.ts';

export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

const signatures: Record<MediaContentType, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

function matches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (
    bytes.byteLength < 24 ||
    !matches(bytes, signatures['image/png']) ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) return undefined;
  return {
    width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16),
    height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
  };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!matches(bytes, signatures['image/jpeg'])) return undefined;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return undefined;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return undefined;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return undefined;
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (
    bytes.byteLength < 30 ||
    !matches(bytes, signatures['image/webp']) ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) return undefined;

  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: ((bytes[27] << 8) | bytes[26]) & 0x3fff,
      height: ((bytes[29] << 8) | bytes[28]) & 0x3fff,
    };
  }
  return undefined;
}

export function inspectImage(
  bytes: Uint8Array,
  contentType: string,
): { contentType: MediaContentType; width: number; height: number } {
  if (!MEDIA_CONTENT_TYPES.includes(contentType as MediaContentType)) {
    throw new ContentValidationError('contentType', 'must be JPEG, PNG, or WebP');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new ContentValidationError('bytes', `must be between 1 and ${MAX_MEDIA_BYTES} bytes`);
  }

  const detected = MEDIA_CONTENT_TYPES.find((type) => matches(bytes, signatures[type]));
  if (detected !== contentType) {
    throw new ContentValidationError('contentType', 'does not match the image file signature');
  }

  const dimensions =
    contentType === 'image/png'
      ? pngDimensions(bytes)
      : contentType === 'image/jpeg'
        ? jpegDimensions(bytes)
        : webpDimensions(bytes);
  if (
    !dimensions ||
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1
  ) {
    throw new ContentValidationError('file', 'is incomplete or has invalid dimensions');
  }
  return { contentType, ...dimensions };
}

export function safeMediaFilename(originalName: string, type: MediaDraft['contentType']): string {
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  const stem = originalName
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 80) || 'image';
  return `${stem}.${extension}`;
}
