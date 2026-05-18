/**
 * Generates a professional "Verified Authentic" certificate as a PNG buffer.
 *
 * Pure SVG → PNG via sharp (no native canvas deps).
 */
import sharp from 'sharp';

export type CertificateInput = {
  mediaType: 'audio' | 'image' | 'video';
  fileHash: string;   // full SHA-256 hex; first 16 chars shown
  confidence: number; // 0–1 float
  timestamp: string;  // ISO string
};

// ─── decorative hash grid (pseudo-QR) ────────────────────────────────────────
function buildHashGrid(seed: string, size: number, x: number, y: number): string {
  const cells: string[] = [];
  const cell = Math.floor(size / 8);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const idx = (row * 8 + col) % seed.length;
      const val = parseInt(seed[idx], 16);
      // 3-corner finder squares always filled; centre always filled
      const isFinderTL = row < 2 && col < 2;
      const isFinderTR = row < 2 && col >= 6;
      const isFinderBL = row >= 6 && col < 2;
      const filled = isFinderTL || isFinderTR || isFinderBL || val % 2 === 0;
      if (filled) {
        cells.push(
          `<rect x="${x + col * cell}" y="${y + row * cell}" width="${cell - 1}" height="${cell - 1}" fill="#00d4aa" opacity="0.85"/>`,
        );
      }
    }
  }
  return cells.join('\n');
}

// ─── media type icon (emoji replaced by SVG path labels) ─────────────────────
function mediaIcon(mediaType: 'audio' | 'image' | 'video'): string {
  const icons: Record<string, string> = {
    audio: `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
              font-family="Arial, sans-serif" font-size="22" fill="#00d4aa">♪ AUDIO</text>`,
    image: `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
              font-family="Arial, sans-serif" font-size="22" fill="#00d4aa">⬛ IMAGE</text>`,
    video: `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
              font-family="Arial, sans-serif" font-size="22" fill="#00d4aa">▶ VIDEO</text>`,
  };
  return icons[mediaType];
}

// ─── shield shape (Vero logo) ────────────────────────────────────────────────
function shield(cx: number, cy: number, scale: number = 1): string {
  const w = 70 * scale;
  const h = 80 * scale;
  const x = cx - w / 2;
  const y = cy - h / 2;
  // Shield path: top-rounded rectangle tapering to bottom point
  const path = `M${x + w * 0.1},${y}
    Q${x},${y} ${x},${y + h * 0.2}
    L${x},${y + h * 0.65}
    Q${x},${y + h * 0.85} ${cx},${y + h}
    Q${x + w},${y + h * 0.85} ${x + w},${y + h * 0.65}
    L${x + w},${y + h * 0.2}
    Q${x + w},${y} ${x + w * 0.9},${y}
    Z`;
  return `<path d="${path}" fill="#00d4aa" opacity="0.15" stroke="#00d4aa" stroke-width="2"/>
          <path d="${path}" fill="none" stroke="#00d4aa" stroke-width="2"/>`;
}

// ─── confidence bar ───────────────────────────────────────────────────────────
function confidenceBar(pct: number, x: number, y: number, w: number, h: number): string {
  const filled = Math.round((pct / 100) * w);
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#0d0d1e" stroke="#00d4aa" stroke-width="1" opacity="0.6"/>
    <rect x="${x}" y="${y}" width="${filled}" height="${h}" rx="4" fill="#00d4aa" opacity="0.9"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="13" font-weight="bold" fill="#0a0a1a">${pct}%</text>
  `;
}

export async function generateCertificate(input: CertificateInput): Promise<Buffer> {
  const W = 600;
  const H = 380;
  const pct = Math.round(input.confidence * 100);
  const hashShort = input.fileHash.slice(0, 16).toUpperCase();
  const mediaLabel = input.mediaType.toUpperCase();

  // Format timestamp nicely
  const ts = new Date(input.timestamp);
  const tsFormatted = ts.toUTCString().replace(' GMT', ' UTC');

  const gridX = W - 90;
  const gridY = 110;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- Outer glow filter -->
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    <!-- Subtle noise texture overlay -->
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#ffffff" stroke-width="0.15" opacity="0.12"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#1a1a2e"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>

  <!-- Outer border with glow -->
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="12"
        fill="none" stroke="#00d4aa" stroke-width="2" filter="url(#glow)" opacity="0.6"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="10"
        fill="none" stroke="#00d4aa" stroke-width="0.5" opacity="0.3"/>

  <!-- Accent corner marks -->
  <polyline points="8,40 8,8 40,8" fill="none" stroke="#00d4aa" stroke-width="2"/>
  <polyline points="${W - 40},8 ${W - 8},8 ${W - 8},40" fill="none" stroke="#00d4aa" stroke-width="2"/>
  <polyline points="8,${H - 40} 8,${H - 8} 40,${H - 8}" fill="none" stroke="#00d4aa" stroke-width="2"/>
  <polyline points="${W - 40},${H - 8} ${W - 8},${H - 8} ${W - 8},${H - 40}" fill="none" stroke="#00d4aa" stroke-width="2"/>

  <!-- Shield logo area -->
  ${shield(54, 56, 0.65)}
  <text x="54" y="51" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
        font-size="13" font-weight="900" fill="#00d4aa" letter-spacing="3">VERO</text>

  <!-- Main header -->
  <text x="50%" y="46" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
        font-size="28" font-weight="900" fill="#00d4aa" letter-spacing="3"
        filter="url(#glow)">✓ VERIFIED AUTHENTIC</text>

  <!-- Divider line -->
  <line x1="30" y1="68" x2="${W - 30}" y2="68" stroke="#00d4aa" stroke-width="1" opacity="0.5"/>

  <!-- Media type badge -->
  <rect x="30" y="80" width="160" height="36" rx="6" fill="#00d4aa" opacity="0.12"
        stroke="#00d4aa" stroke-width="1"/>
  <svg x="30" y="80" width="160" height="36">
    ${mediaIcon(input.mediaType)}
  </svg>

  <!-- Hash label -->
  <text x="210" y="96" font-family="Arial, sans-serif" font-size="11" fill="#8888aa">
    SHA-256 (first 16):
  </text>
  <text x="210" y="110" font-family="Courier New, monospace" font-size="13" font-weight="bold"
        fill="#ffffff" letter-spacing="1">${hashShort}</text>

  <!-- Horizontal divider between badge and details -->
  <line x1="30" y1="128" x2="${gridX - 20}" y2="128" stroke="#ffffff" stroke-width="0.5" opacity="0.15"/>

  <!-- Confidence label -->
  <text x="30" y="150" font-family="Arial, sans-serif" font-size="12" fill="#8888aa">
    CONFIDENCE SCORE
  </text>
  ${confidenceBar(pct, 30, 158, 340, 24)}

  <!-- Timestamp -->
  <text x="30" y="210" font-family="Arial, sans-serif" font-size="11" fill="#8888aa">
    VERIFIED AT
  </text>
  <text x="30" y="226" font-family="Courier New, monospace" font-size="12" fill="#ccccdd">
    ${tsFormatted}
  </text>

  <!-- Media type full label -->
  <text x="30" y="258" font-family="Arial, sans-serif" font-size="11" fill="#8888aa">
    MEDIA TYPE
  </text>
  <text x="30" y="274" font-family="Arial Black, Arial, sans-serif" font-size="14"
        font-weight="900" fill="#ffffff" letter-spacing="2">${mediaLabel}</text>

  <!-- Result text -->
  <text x="30" y="306" font-family="Arial Black, Arial, sans-serif" font-size="13"
        fill="#00d4aa" letter-spacing="1">VERDICT: AUTHENTIC — No deepfake artifacts detected</text>

  <!-- Decorative hash grid (pseudo-QR) -->
  <rect x="${gridX - 4}" y="${gridY - 4}" width="92" height="92" rx="4"
        fill="#0d0d1e" stroke="#00d4aa" stroke-width="1" opacity="0.8"/>
  ${buildHashGrid(input.fileHash, 84, gridX, gridY)}

  <!-- Footer separator -->
  <line x1="30" y1="${H - 36}" x2="${W - 30}" y2="${H - 36}" stroke="#00d4aa" stroke-width="0.5" opacity="0.4"/>

  <!-- Footer text -->
  <text x="50%" y="${H - 16}" text-anchor="middle" font-family="Arial, sans-serif"
        font-size="11" fill="#8888aa" letter-spacing="1">
    Verificado por Vero • wa.me/56929775841
  </text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
