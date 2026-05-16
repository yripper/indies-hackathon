import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalDataSet,
  type SignalKeyStore,
} from '@whiskeysockets/baileys';
import type { SessionStore } from '../../security/session-store';

const CREDS_KEY = 'creds.json';

// Mirrors the naming scheme used by useMultiFileAuthState, but without the .json
// suffix — the store key is opaque (encrypted blob), not a human-readable JSON file.
// Sanitize all non-allowlist characters into '_' so the filename matches
// EncryptedFileSessionStore.pathFor's allowlist. Signal IDs may contain JIDs
// (@, :) or base64 (+, =, /) — none of those are filesystem-friendly.
function keyName(type: string, id: string): string {
  return `${type}-${id}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function useEncryptedAuthState(
  store: SessionStore,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const credsBuffer = await store.read(CREDS_KEY);
  const creds = credsBuffer
    ? JSON.parse(credsBuffer.toString('utf8'), BufferJSON.reviver)
    : initAuthCreds();

  const keys: SignalKeyStore = {
    get: async (type, ids) => {
      const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
      await Promise.all(
        ids.map(async (id) => {
          const buf = await store.read(keyName(type, id));
          if (!buf) return;
          let value = JSON.parse(buf.toString('utf8'), BufferJSON.reviver);
          // Proto deserialization required for app-state-sync-key entries
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          out[id] = value;
        }),
      );
      return out;
    },
    set: async (data: SignalDataSet) => {
      const tasks: Promise<void>[] = [];
      for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
        const entries = data[category];
        if (!entries) continue;
        for (const [id, value] of Object.entries(entries)) {
          const key = keyName(category, id);
          if (value) {
            const json = JSON.stringify(value, BufferJSON.replacer);
            tasks.push(store.write(key, Buffer.from(json, 'utf8')));
          } else {
            tasks.push(store.delete(key));
          }
        }
      }
      await Promise.all(tasks);
    },
  };

  return {
    state: { creds, keys },
    saveCreds: async () => {
      const json = JSON.stringify(creds, BufferJSON.replacer);
      await store.write(CREDS_KEY, Buffer.from(json, 'utf8'));
    },
  };
}
