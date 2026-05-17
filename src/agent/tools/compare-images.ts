import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { compareImages } from '../../integrations/source-tracer.js';

export const compareImagesTool = tool(
  async ({ originalUrl, modifiedUrl }) => {
    try {
      const result = await compareImages(originalUrl, modifiedUrl);

      const lines: string[] = [
        `🖼️ *Comparación de Imágenes*`,
        '',
        result.comparisonSummary,
      ];

      if (result.alteredRegions.length > 0) {
        lines.push('', '*Regiones alteradas detectadas:*');
        for (const region of result.alteredRegions) {
          const severityEmoji = region.severity === 'high' ? '🔴' : region.severity === 'medium' ? '🟡' : '🟢';
          lines.push(`${severityEmoji} Zona (${region.x}, ${region.y}) - ${region.width}x${region.height}px`);
        }
      }

      return lines.join('\n');
    } catch (err) {
      const msg = (err as Error).message ?? 'Error desconocido';
      return `No se pudo comparar las imágenes: ${msg}`;
    }
  },
  {
    name: 'compare_images',
    description:
      'Compara dos imágenes para detectar si han sido modificadas. ' +
      'Úsala cuando el usuario quiera verificar si una imagen es diferente de otra (ej: original vs supuestos manipulación). ' +
      'Retorna un puntaje de similitud y las regiones alteradas.',
    schema: z.object({
      originalUrl: z
        .string()
        .describe('URL de la imagen original'),
      modifiedUrl: z
        .string()
        .describe('URL de la imagen que se quiere comparar'),
    }),
  },
);