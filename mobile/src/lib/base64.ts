const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = /*#__PURE__*/ (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Decodes base64 to bytes without relying on `atob`, which React Native does
 * not guarantee. Supabase Storage uploads need an ArrayBuffer-backed body.
 */
export const base64ToBytes = (base64: string): Uint8Array => {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((clean.length * 3) / 4) - padding;
  const bytes = new Uint8Array(byteLength);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk =
      (LOOKUP[clean.charCodeAt(i)]! << 18) |
      (LOOKUP[clean.charCodeAt(i + 1)]! << 12) |
      (LOOKUP[clean.charCodeAt(i + 2)]! << 6) |
      LOOKUP[clean.charCodeAt(i + 3)]!;

    if (byteIndex < byteLength) bytes[byteIndex++] = (chunk >> 16) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = (chunk >> 8) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = chunk & 0xff;
  }

  return bytes;
};
