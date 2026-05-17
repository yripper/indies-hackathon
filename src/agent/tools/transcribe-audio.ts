import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';

async function fetchAudioBuffer(audioSource: string): Promise<Buffer> {
  if (audioSource.startsWith('http://') || audioSource.startsWith('https://')) {
    const res = await fetch(audioSource);
    if (!res.ok) throw new Error(`Error al descargar audio (${res.status}): ${audioSource}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(audioSource);
}

/**
 * Transcribes an audio file using the OpenAI Whisper API.
 * Requires OPENAI_API_KEY to be set in the environment.
 */
export const transcribeAudioTool = tool(
  async ({ audioSource }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurado. No se puede transcribir el audio.');
    }

    const buffer = await fetchAudioBuffer(audioSource);

    const ext = audioSource.split('.').pop()?.toLowerCase() ?? 'ogg';
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      opus: 'audio/ogg',
      webm: 'audio/webm',
    };
    const mimeType = mimeMap[ext] ?? 'audio/ogg';
    const filename = `audio.${ext}`;

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
      'Acepta una URL pública (https://) o una ruta local al archivo (/tmp/audio.ogg). ' +
      'Requiere OPENAI_API_KEY en el entorno.',
    schema: z.object({
      audioSource: z
        .string()
        .describe(
          'URL pública del audio (https://...) o ruta local al archivo (/tmp/wa_audio_xxx.ogg)',
        ),
    }),
  },
);
