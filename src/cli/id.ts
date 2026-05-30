/**
 * Shared ID generation helper.
 *
 * Time-prefixed random IDs. Sortable lexicographically by creation time
 * (within the precision of Date.now()).
 */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateId(prefix: string, length: number = 22): string {
  const timePart = Date.now().toString(36).padStart(8, '0');
  let randomPart = '';
  const remaining = Math.max(length - timePart.length, 8);
  const buf = new Uint8Array(remaining);
  crypto.getRandomValues(buf);
  for (let i = 0; i < buf.length; i++) {
    randomPart += ID_ALPHABET[buf[i]! % ID_ALPHABET.length]!;
  }
  return `${prefix}_${timePart}${randomPart}`;
}
