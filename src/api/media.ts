import type { FastifyInstance } from 'fastify';
import type { MediaStore } from '../transport/media-store';

export async function mediaRoutes(
  app: FastifyInstance,
  deps: { mediaStore: MediaStore },
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/v1/media/:id',
    async (req, reply) => {
      const entry = deps.mediaStore.get(req.params.id);
      if (!entry) {
        reply.code(404);
        return { error: 'media not found or expired' };
      }
      reply.header('content-type', entry.mimeType);
      reply.header('content-length', entry.buffer.byteLength);
      reply.header('cache-control', 'private, max-age=300');
      return reply.send(entry.buffer);
    },
  );
}
