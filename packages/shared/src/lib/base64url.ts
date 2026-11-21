/** UTF-8 text as unpadded base64url (RFC 4648 §5): safe in a query string without escaping. */
export const base64UrlEncode = (text: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Inverse of `base64UrlEncode`; throws on text that is not base64url or not UTF-8. */
export const base64UrlDecode = (value: string): string => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Not base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};
