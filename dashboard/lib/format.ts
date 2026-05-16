// Tiny formatters shared across pages. Keep these dependency-free.

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// "2026-05-16T14:23:45Z" -> "May 16, 2:23 PM"
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// "2026-05-16T14:23:45Z" -> "3 minutes ago"
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDateTime(iso);
}

// Strip the WhatsApp suffix from a JID for friendlier display.
// "243245489627306@lid" → "+243245489627306"
// "120363409150968129@g.us" → "Group 120…68129"
export function formatJid(jid: string): string {
  if (jid.endsWith("@g.us")) {
    const id = jid.replace("@g.us", "");
    return id.length > 12
      ? `Group ${id.slice(0, 4)}…${id.slice(-5)}`
      : `Group ${id}`;
  }
  const id = jid.replace(/@(s\.whatsapp\.net|lid)$/, "");
  return `+${id}`;
}
