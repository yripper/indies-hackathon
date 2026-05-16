import nodeCrypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionCrypto } from './session-crypto';

export interface SessionStore {
  read(key: string): Promise<Buffer | null>;
  write(key: string, value: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class EncryptedFileSessionStore implements SessionStore {
  constructor(
    private readonly rootDir: string,
    private readonly crypto: SessionCrypto,
  ) {}

  async read(key: string): Promise<Buffer | null> {
    const filePath = this.pathFor(key);
    try {
      const ciphertext = await fs.readFile(filePath);
      return this.crypto.decrypt(ciphertext);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(key: string, value: Buffer): Promise<void> {
    const filePath = this.pathFor(key);
    await fs.mkdir(this.rootDir, { recursive: true });
    const ciphertext = this.crypto.encrypt(value);
    // Unique tmp suffix so concurrent writes to the same key don't race.
    // Baileys fires saveCreds() many times during prekey upload; without a
    // unique suffix the first rename wins and the second errors ENOENT.
    const tmpPath = `${filePath}.${nodeCrypto.randomBytes(8).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, ciphertext);
    await fs.rename(tmpPath, filePath);
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return entries.filter((name) => name.startsWith(prefix) && !name.endsWith('.tmp'));
  }

  private pathFor(key: string): string {
    if (!/^[\w\-. ]+$/.test(key) || key === '.' || key === '..') {
      throw new Error(`Invalid session key: ${JSON.stringify(key)}`);
    }
    return path.join(this.rootDir, key);
  }
}
