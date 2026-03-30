/**
 * Cryptographically secure ID generation.
 * Replaces Math.random() for all production ID generation.
 */
import crypto from 'crypto';

/**
 * Generate a cryptographically secure random ID with a prefix.
 * @param prefix - The prefix for the ID (e.g., 'settlement', 'hedge', 'alert')
 * @returns A string like "prefix-1711234567890-a3f9c2b1e4"
 */
export function generateSecureId(prefix: string): string {
  const timestamp = Date.now();
  const randomPart = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${timestamp}-${randomPart}`;
}

/**
 * Generate a short cryptographically secure random suffix.
 * Useful for appending to existing IDs.
 */
export function randomSuffix(length: number = 8): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
