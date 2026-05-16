import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import type { SessionManager } from './session-manager';

export type ConnectInput = {
  sessionsDir: string;
  sessionManager: SessionManager;
  dispatchMessage: (customerPhone: string, customerName: string, text: string) => Promise<void>;
  onQr: (qr: string) => void;
  onConnected: (phoneNumber: string, lid: string | null) => void;
  onDisconnected: () => void;
  log: FastifyBaseLogger;
};

export async function connectClient(input: ConnectInput): Promise<void> {
  await input.sessionManager.createSession({
    sessionsDir: input.sessionsDir,
    onQr: input.onQr,
    onConnected: input.onConnected,
    onDisconnected: input.onDisconnected,
    onMessage: (upsert) => {
      for (const m of upsert.messages) {
        if (!m.message) continue;
        if (m.key.fromMe) continue;
        const remoteJid = m.key.remoteJid;
        if (!remoteJid) continue;
        // Accept DMs (@s.whatsapp.net) and Baileys 7 @lid identifiers (privacy-mode users).
        const isDm = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
        if (!isDm) continue;

        const customerName = m.pushName ?? '';
        const text = extractText(m.message);
        const isVideo = isVideoMessage(m.message);

        if (!text && !isVideo) continue;

        if (isVideo) {
          handleVideoMessage(m, remoteJid, customerName, text, input).catch((err) => {
            input.log.error({ err }, 'video dispatch failed');
            // Fallback to text-only if download fails and there is a caption
            if (text) {
              input.dispatchMessage(remoteJid, customerName, text).catch((e) =>
                input.log.error({ err: e }, 'dispatchMessage fallback failed'),
              );
            }
          });
        } else {
          input.dispatchMessage(remoteJid, customerName, text!).catch((err) => {
            input.log.error({ err }, 'dispatchMessage failed');
          });
        }
      }
    },
  });
}

function isVideoMessage(message: unknown): boolean {
  return !!(message as { videoMessage?: unknown }).videoMessage;
}

async function handleVideoMessage(
  fullMessage: WAMessage,
  remoteJid: string,
  customerName: string,
  caption: string | null,
  input: ConnectInput,
): Promise<void> {
  const buffer = (await downloadMediaMessage(fullMessage, 'buffer', {})) as Buffer;
  const tmpPath = join(tmpdir(), `wa_video_${Date.now()}.mp4`);
  await writeFile(tmpPath, buffer);

  const text = caption
    ? `[VIDEO:${tmpPath}] ${caption}`
    : `[VIDEO:${tmpPath}] El usuario envió un video. Analiza si es un deepfake.`;

  await input.dispatchMessage(remoteJid, customerName, text);

  // Give the agent 60 s to read the file before cleaning up.
  setTimeout(() => unlink(tmpPath).catch(() => {}), 60_000);
}

function extractText(message: unknown): string | null {
  const m = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
  };
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  );
}
