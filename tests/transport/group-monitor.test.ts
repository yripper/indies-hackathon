import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldAutoAnalyze,
  shouldSendGroupAlert,
  checkGroupRateLimit,
  resetGroupRateLimits,
  isGroupMonitorEnabled,
  type MonitorableMessage,
  type AnalysisType,
} from '../../src/transport/group-monitor';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_JID = '120363000000000001@g.us';
const DM_JID = '+56911111111@s.whatsapp.net';

function makeMsg(overrides: Partial<MonitorableMessage> = {}): MonitorableMessage {
  return {
    key: { remoteJid: GROUP_JID, fromMe: false, participant: '56911111111@s.whatsapp.net' },
    message: {},
    pushName: 'Tester',
    ...overrides,
  };
}

function audioMsg(): MonitorableMessage {
  return makeMsg({ message: { audioMessage: { url: 'https://mmg.whatsapp.net/audio.ogg' } } });
}

function imageMsg(): MonitorableMessage {
  return makeMsg({ message: { imageMessage: { caption: '' } } });
}

function videoMsg(caption = ''): MonitorableMessage {
  return makeMsg({ message: { videoMessage: { caption } } });
}

function textMsg(text: string, forwarded = false, score = 0): MonitorableMessage {
  return makeMsg({
    message: {
      extendedTextMessage: {
        text,
        contextInfo: forwarded || score > 0 ? { isForwarded: forwarded, forwardingScore: score } : undefined,
      },
    },
  });
}

function conversationMsg(text: string): MonitorableMessage {
  return makeMsg({ message: { conversation: text } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag management
// ─────────────────────────────────────────────────────────────────────────────

function withGroupMonitorEnabled(fn: () => void): void {
  const original = process.env.GROUP_MONITOR_ENABLED;
  process.env.GROUP_MONITOR_ENABLED = 'true';
  try {
    fn();
  } finally {
    process.env.GROUP_MONITOR_ENABLED = original;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetGroupRateLimits();
});

afterEach(() => {
  delete process.env.GROUP_MONITOR_ENABLED;
  resetGroupRateLimits();
});

// ── Feature flag ──────────────────────────────────────────────────────────────

describe('isGroupMonitorEnabled', () => {
  it('returns false when env var is not set', () => {
    delete process.env.GROUP_MONITOR_ENABLED;
    expect(isGroupMonitorEnabled()).toBe(false);
  });

  it('returns false when env var is "false"', () => {
    process.env.GROUP_MONITOR_ENABLED = 'false';
    expect(isGroupMonitorEnabled()).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
    expect(isGroupMonitorEnabled()).toBe(true);
  });
});

// ── DM vs group detection ─────────────────────────────────────────────────────

describe('shouldAutoAnalyze — DM vs group', () => {
  it('returns analyze=false for a DM JID even when monitoring is enabled', () => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
    const result = shouldAutoAnalyze(audioMsg(), DM_JID);
    expect(result.analyze).toBe(false);
    expect(result.reason).toMatch(/not a group/);
  });

  it('returns analyze=false for status@broadcast', () => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
    const result = shouldAutoAnalyze(audioMsg(), 'status@broadcast');
    expect(result.analyze).toBe(false);
    // broadcast JID does not end in @g.us, so it is caught by the "not a group" guard
    expect(result.reason).toMatch(/not a group|broadcast/);
  });

  it('returns analyze=false when feature flag is off', () => {
    delete process.env.GROUP_MONITOR_ENABLED;
    const result = shouldAutoAnalyze(audioMsg(), GROUP_JID);
    expect(result.analyze).toBe(false);
    expect(result.reason).toMatch(/disabled/);
  });

  it('returns analyze=false for own messages (fromMe=true)', () => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
    const msg = makeMsg({ key: { remoteJid: GROUP_JID, fromMe: true } });
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(false);
    expect(result.reason).toMatch(/own message/);
  });
});

// ── Auto-analyze triggers for different media types ───────────────────────────

describe('shouldAutoAnalyze — media type triggers', () => {
  beforeEach(() => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
  });

  it('queues audio messages for deepfake analysis', () => {
    const result = shouldAutoAnalyze(audioMsg(), GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('audio');
    expect(result.instruction).toMatch(/analyze_audio_deepfake/);
  });

  it('queues image messages for deepfake analysis', () => {
    const result = shouldAutoAnalyze(imageMsg(), GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('image');
    expect(result.instruction).toMatch(/analyze_image_deepfake/);
  });

  it('queues video messages for deepfake analysis', () => {
    const result = shouldAutoAnalyze(videoMsg(), GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('video');
    expect(result.instruction).toMatch(/detect_deepfake_video/);
  });

  it('includes video caption in the instruction when present', () => {
    const result = shouldAutoAnalyze(videoMsg('¿Es real este video?'), GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.instruction).toMatch(/¿Es real este video?/);
  });

  it('queues video-platform URL (YouTube) for URL scan', () => {
    const msg = conversationMsg('Mira este video: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('url');
    expect(result.instruction).toMatch(/scan_url_deepfake/);
    expect(result.instruction).toMatch(/youtube\.com/);
  });

  it('queues video-platform URL (TikTok) for URL scan', () => {
    const msg = conversationMsg('https://vm.tiktok.com/ZMhABCDEF/');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('url');
  });

  it('queues video-platform URL (Twitter/X) for URL scan', () => {
    const msg = conversationMsg('video: https://x.com/someuser/status/123456');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('url');
  });

  it('queues video-platform URL (Instagram) for URL scan', () => {
    const msg = conversationMsg('https://www.instagram.com/reel/abc123/');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('url');
  });

  it('queues forwarded text >20 chars for fact-check', () => {
    const msg = textMsg('Este medicamento cura el cáncer en 3 días', true, 3);
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(true);
    expect(result.type).toBe('factcheck');
    expect(result.instruction).toMatch(/verificar_noticia/);
  });

  it('does NOT queue forwarded text <=20 chars for fact-check', () => {
    const msg = textMsg('Hola, ¿cómo estás?', true, 1);
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(false);
  });

  it('does NOT queue non-forwarded plain text', () => {
    const msg = conversationMsg('Buenos días a todos en el grupo!');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(false);
  });

  it('does NOT queue a non-video-platform URL', () => {
    const msg = conversationMsg('visita https://www.example.com para más info');
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(false);
  });

  it('returns analyze=false when message has no actionable content', () => {
    const msg = makeMsg({ message: {} });
    const result = shouldAutoAnalyze(msg, GROUP_JID);
    expect(result.analyze).toBe(false);
    expect(result.reason).toMatch(/no actionable/);
  });
});

// ── Rate limiting per group ────────────────────────────────────────────────────

describe('checkGroupRateLimit', () => {
  it('allows the first 10 analyses within one hour', () => {
    const jid = 'ratetest@g.us';
    for (let i = 0; i < 10; i++) {
      expect(checkGroupRateLimit(jid)).toBe(true);
    }
  });

  it('blocks the 11th analysis within the same hour', () => {
    const jid = 'ratetest2@g.us';
    for (let i = 0; i < 10; i++) {
      checkGroupRateLimit(jid);
    }
    expect(checkGroupRateLimit(jid)).toBe(false);
  });

  it('does not share limits between different groups', () => {
    const jidA = 'groupA@g.us';
    const jidB = 'groupB@g.us';
    for (let i = 0; i < 10; i++) {
      checkGroupRateLimit(jidA);
    }
    // Group B should still have its own fresh bucket
    expect(checkGroupRateLimit(jidB)).toBe(true);
  });

  it('resets after the hour window passes', () => {
    vi.useFakeTimers();
    const jid = 'ratetest3@g.us';
    for (let i = 0; i < 10; i++) {
      checkGroupRateLimit(jid);
    }
    expect(checkGroupRateLimit(jid)).toBe(false);

    // Advance past the 1-hour window
    vi.advanceTimersByTime(61 * 60 * 1_000);
    expect(checkGroupRateLimit(jid)).toBe(true);

    vi.useRealTimers();
  });
});

describe('shouldAutoAnalyze — rate limit integration', () => {
  it('returns analyze=false when group rate limit is exhausted', () => {
    process.env.GROUP_MONITOR_ENABLED = 'true';
    // Exhaust the bucket for this group manually
    const jid = 'limited@g.us';
    for (let i = 0; i < 10; i++) {
      checkGroupRateLimit(jid);
    }

    const result = shouldAutoAnalyze(audioMsg(), jid);
    expect(result.analyze).toBe(false);
    expect(result.reason).toMatch(/rate limit/);
  });
});

// ── Quiet mode ────────────────────────────────────────────────────────────────

describe('shouldSendGroupAlert', () => {
  const cases: Array<[string, AnalysisType, boolean]> = [
    // [replyText, analysisType, expected]
    ['FAKE (92% de confianza). Parece voz sintética.', 'audio', true],
    ['REAL (95% de confianza). Audio auténtico.', 'audio', false],
    ['UNCERTAIN (55% de confianza). No se pudo determinar.', 'image', true],
    ['REAL (88% de confianza). Imagen auténtica.', 'image', false],
    ['FAKE (78%). Manipulación digital detectada.', 'video', true],
    ['REAL (91%). Video auténtico.', 'video', false],
    // fact-check always gets surfaced
    ['La afirmación no pudo verificarse.', 'factcheck', true],
    ['La afirmación es verdadera.', 'factcheck', true],
    // Spanish variant "FALSO"
    ['FALSO (85% de confianza).', 'url', true],
    // Clean URL scan
    ['REAL (90%). El video parece auténtico.', 'url', false],
  ];

  it.each(cases)('"%s" with type=%s → alert=%s', (replyText, analysisType, expected) => {
    expect(shouldSendGroupAlert(replyText, analysisType)).toBe(expected);
  });
});
