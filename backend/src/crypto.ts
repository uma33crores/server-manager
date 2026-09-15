import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.SSH_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

if (!process.env.SSH_ENCRYPTION_KEY) {
  console.warn('WARNING: SSH_ENCRYPTION_KEY not set. Using a random key — passwords will not survive restart.');
  console.warn('Set SSH_ENCRYPTION_KEY in the backend environment to persist encrypted passwords across restarts.');
}

export function encrypt(text: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedBlob: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const parts = encryptedBlob.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted blob format');

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
