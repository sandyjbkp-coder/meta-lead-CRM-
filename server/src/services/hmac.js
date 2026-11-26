import { createHmac, timingSafeEqual } from 'node:crypto';

// HMAC-SHA256 verification for Meta webhook signatures
// Format: "sha256=HMAC(app_secret, rawBody)"
export function verifyMetaSignature(appSecret, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  const provided = signatureHeader;

  if (expected.length !== provided.length) return false;

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  return timingSafeEqual(expectedBuf, providedBuf);
}

// Timing-safe compare for two strings
export function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}
