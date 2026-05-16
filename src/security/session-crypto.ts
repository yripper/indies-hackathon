import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class SessionCrypto {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_LENGTH) {
      throw new Error(`SessionCrypto key must be ${KEY_LENGTH} bytes, got ${key.length}`);
    }
  }

  encrypt(plaintext: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, authTag]);
  }

  decrypt(payload: Buffer): Buffer {
    if (payload.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Ciphertext too short');
    }
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(payload.length - TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function sessionCryptoFromEnv(hexKey: string): SessionCrypto {
  return new SessionCrypto(Buffer.from(hexKey, 'hex'));
}
