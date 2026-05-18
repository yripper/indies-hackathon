import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { getCurrentConversationId } from '../context.js';
import { peekPendingAudio } from '../../transport/audio-cache.js';

function isExplicitSource(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/');
}

async function fetchAudioBuffer(audioSource: string): Promise<Buffer> {
  if (audioSource.startsWith('http://') || audioSource.startsWith('https://')) {
    const res = await fetch(audioSource);
    if (!res.ok) throw new Error(`Error al descargar audio (${res.status}): ${audioSource}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(audioSource);
}

export const transcribeAudioTool = tool(
  async ({ audioSource }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurado. No se puede transcribir el audio.');
    }

    let buffer: Buffer;
    let mimeType = 'audio/ogg';
    let filename = 'audio.ogg';

    const convId = getCurrentConversationId();
    const pending = convId ? peekPendingAudio(convId) : null;

    if (pending && !isExplicitSource(audioSource)) {
      buffer = pending.buffer;
      mimeType = pending.mimetype || 'audio/ogg';
      const extMatch = mimeType.match(/\/([\w]+)/);
      filename = `audio.${extMatch?.[1] ?? 'ogg'}`;
    } else {
      buffer = await fetchAudioBuffer(audioSource);
      const ext = audioSource.split('.').pop()?.toLowerCase() ?? 'ogg';
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
        opus: 'audio/ogg',
        webm: 'audio/webm',
      };
      mimeType = mimeMap[ext] ?? 'audio/ogg';
      filename = `audio.${ext}`;
    }

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Whisper API error (${res.status}): ${body}`);
    }

    const transcription = (await res.text()).trim();
    if (!transcription) {
      return 'No se detectó habla en el audio (o el audio está en silencio).';
    }

    return `Transcripción: "${transcription}"`;
  },
  {
    name: 'transcribe_audio',
    description:
      'Transcribe un archivo de audio a texto usando OpenAI Whisper. ' +
      'Úsala cuando necesites saber qué dice un audio antes de verificar su contenido. ' +
      'Si hay un audio pendiente en la conversación, usa audioSource="pending". ' +
      'También acepta una URL pública (https://) directa.',
    schema: z.object({
      audioSource: z
        .string()
        .describe(
          'Usa "pending" para el audio pendiente de la conversación, o una URL pública (https://...)',
        ),
    }),
  },
);
