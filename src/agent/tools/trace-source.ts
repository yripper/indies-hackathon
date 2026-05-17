import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { traceImageSource } from '../../integrations/source-tracer.js';

export const traceSourceTool = tool(
  async ({ imageUrl }) => {
    try {
      const result = await traceImageSource(imageUrl);

      const lines: string[] = [
        `🔍 *Análisis de Fuente*`,
        '',
        result.traceSummary,
      ];

      if (result.reverseImageMatches.length > 0) {
        lines.push('', '*Coincidencias de búsqueda inversa:*');
        for (const match of result.reverseImageMatches.slice(0, 5)) {
          lines.push(`• ${match.source} (${Math.round(match.similarity * 100)}% similar)`);
          lines.push(`  ${match.url}`);
        }
      } else {
        lines.push('', '_No se encontraron coincidencias en búsqueda inversa_');
      }

      if (result.exifData.camera || result.exifData.dateTaken) {
        lines.push('', '*Metadata EXIF:*');
        if (result.exifData.camera) lines.push(`• Cámara: ${result.exifData.camera}`);
        if (result.exifData.dateTaken) lines.push(`• Fecha: ${result.exifData.dateTaken}`);
      }

      return lines.join('\n');
    } catch (err) {
      const msg = (err as Error).message ?? 'Error desconocido';
      return `No se pudo rastrear la fuente de la imagen: ${msg}`;
    }
  },
  {
    name: 'trace_image_source',
    description:
      'Rastrea el origen de una imagen usando búsqueda inversa y análisis de metadata EXIF. ' +
      'Úsala cuando el usuario quiera saber de dónde viene una imagen o si ha sido manipulada. ' +
      'Proporciona la URL de la imagen a analizar.',
    schema: z.object({
      imageUrl: z
        .string()
        .describe('URL de la imagen que se quiere rastrear'),
    }),
  },
);