import { tool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { db } from '../../db/connection.js';
import { audioAnalysesRepo } from '../../db/queries/audio-analyses.js';
import { imageAnalysesRepo } from '../../db/queries/image-analyses.js';
import { conversationsRepo } from '../../db/queries/conversations.js';
import { getCustomerJid } from '../../utils/request-context.js';

// Extract the bare phone number from a WhatsApp JID (e.g. "5491123456789@s.whatsapp.net" → "5491123456789")
function jidToPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

function formatDate(d: Date | null): string {
  if (!d) return 'nunca';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const getUserStatsTool = tool(
  async () => {
    const jid = getCustomerJid();
    if (!jid) {
      return 'No se pudo determinar tu identidad. Intenta enviar un mensaje primero.';
    }

    const phone = jidToPhone(jid);
    const conversation = await conversationsRepo.findByPhone(db, phone);

    if (!conversation) {
      return (
        '📊 *Tus estadísticas Vero*\n\n' +
        'Aún no tienes análisis registrados. ¡Envíame un audio, imagen o video sospechoso para empezar!'
      );
    }

    const conversationId = conversation.id;

    // Fetch audio and image stats in parallel
    const [audioStats, imageStats, recentAudio, recentImages] = await Promise.all([
      audioAnalysesRepo.statsByConversation(db, conversationId),
      imageAnalysesRepo.statsByConversation(db, conversationId),
      audioAnalysesRepo.recentByConversation(db, conversationId, 3),
      imageAnalysesRepo.recentByConversation(db, conversationId, 3),
    ]);

    const totalAnalyses = audioStats.analysesTotal + imageStats.analysesTotal;

    if (totalAnalyses === 0) {
      return (
        '📊 *Tus estadísticas Vero*\n\n' +
        'Aún no tienes análisis registrados. ¡Envíame un audio, imagen o video sospechoso para empezar!'
      );
    }

    const totalFake = audioStats.tierCounts.fake + imageStats.tierCounts.fake;
    const totalUncertain = audioStats.tierCounts.uncertain + imageStats.tierCounts.uncertain;
    const totalReal = audioStats.tierCounts.real + imageStats.tierCounts.real;

    const lines: string[] = [
      '📊 *Tus estadísticas en Vero*',
      '',
      `*Total de análisis:* ${totalAnalyses}`,
      '',
      '*Por tipo de contenido:*',
    ];

    if (audioStats.analysesTotal > 0) {
      lines.push(`  🎤 Audios: ${audioStats.analysesTotal}`);
    }
    if (imageStats.analysesTotal > 0) {
      lines.push(`  🖼️ Imágenes: ${imageStats.analysesTotal}`);
    }

    lines.push('', '*Por veredicto:*');
    if (totalFake > 0) lines.push(`  🔴 Falsos (deepfake): ${totalFake}`);
    if (totalUncertain > 0) lines.push(`  ⚠️ Inciertos: ${totalUncertain}`);
    if (totalReal > 0) lines.push(`  ✅ Reales: ${totalReal}`);

    // Recent activity — combine and sort by date
    type RecentEntry = { type: string; tier: string; createdAt: Date };
    const recent: RecentEntry[] = [
      ...recentAudio.map((a) => ({ type: '🎤 Audio', tier: a.tier, createdAt: a.createdAt })),
      ...recentImages.map((i) => ({ type: '🖼️ Imagen', tier: i.tier, createdAt: i.createdAt })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 3);

    if (recent.length > 0) {
      lines.push('', '*Últimos análisis:*');
      for (const entry of recent) {
        const tierEmoji = entry.tier === 'fake' ? '🔴' : entry.tier === 'uncertain' ? '⚠️' : '✅';
        const tierLabel =
          entry.tier === 'fake' ? 'FALSO' : entry.tier === 'uncertain' ? 'INCIERTO' : 'REAL';
        lines.push(`  ${entry.type} — ${tierEmoji} ${tierLabel} (${formatDate(entry.createdAt)})`);
      }
    }

    const firstSeen =
      audioStats.firstAnalysisAt && imageStats.firstAnalysisAt
        ? new Date(
            Math.min(
              audioStats.firstAnalysisAt.getTime(),
              imageStats.firstAnalysisAt.getTime(),
            ),
          )
        : audioStats.firstAnalysisAt ?? imageStats.firstAnalysisAt;

    lines.push('', `_Usando Vero desde: ${formatDate(firstSeen)}_`);

    return lines.join('\n');
  },
  {
    name: 'get_user_stats',
    description:
      'Muestra el historial personal de análisis del usuario: total de audios e imágenes analizados, ' +
      'desglose por veredicto (real/incierto/falso) y actividad reciente. ' +
      'Úsala cuando el usuario escriba /stats o pida ver sus estadísticas.',
    schema: z.object({}),
  },
);
