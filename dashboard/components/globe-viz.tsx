'use client';

import { useState, useCallback } from 'react';

type Point = {
  latitude: number;
  longitude: number;
  name: string;
  tier?: 'real' | 'uncertain' | 'fake';
  count?: number;
};

export function GlobeViz({
  points = [],
  width = 500,
  height = 500,
}: {
  points?: Point[];
  width?: number;
  height?: number;
}) {
  const [rotX, setRotX] = useState(15);
  const [rotY, setRotY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.38;

  const project = useCallback((lat: number, lon: number) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x3d = r * Math.sin(phi) * Math.cos(theta);
    const y3d = r * Math.cos(phi);
    const z3d = r * Math.sin(phi) * Math.sin(theta);

    const cosX = Math.cos((rotX * Math.PI) / 180);
    const sinX = Math.sin((rotX * Math.PI) / 180);
    const cosY = Math.cos((rotY * Math.PI) / 180);
    const sinY = Math.sin((rotY * Math.PI) / 180);

    const x2d = x3d * cosY - z3d * sinY;
    const z2d = z3d * cosY + x3d * sinY;
    const y2d = y3d * cosX - z2d * sinX;
    const zFinal = z2d * cosX + y3d * sinX;

    const scale = 1 / (1.5 + zFinal / r);
    return {
      x: cx + x2d * scale,
      y: cy - y2d * scale,
      z: zFinal,
      scale,
    };
  }, [rotX, rotY, cx, cy, r]);

  const getColor = (tier?: string) => {
    if (tier === 'fake') return '#ef4444';
    if (tier === 'uncertain') return '#fbbf24';
    return '#4ade80';
  };

  const projectedPoints = points
    .map((p) => ({
      ...p,
      ...project(p.latitude, p.longitude),
    }))
    .filter((p) => p.scale > 0.15 && p.x > 20 && p.x < width - 20 && p.y > 20 && p.y < height - 20)
    .sort((a, b) => a.z - b.z);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    setRotY((r) => r + dx * 0.5);
    setRotX((r) => Math.max(-90, Math.min(90, r + dy * 0.5)));
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className="relative" style={{ width, height }}>
      <svg
        width={width}
        height={height}
        className="cursor-grab active:cursor-grabbing rounded-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <radialGradient id="globeGrad" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#065f46" />
            <stop offset="100%" stopColor="#0a2e23" />
          </radialGradient>
          <filter id="pointGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={r} fill="url(#globeGrad)" />

        {[-60, -30, 0, 30, 60].map((lat) => {
          const proj = project(lat, 0);
          const ellipseRx = Math.sqrt(Math.max(0, r * r - Math.pow(proj.y - cy, 2)));
          if (ellipseRx < 2) return null;
          return (
            <ellipse
              key={`lat-${lat}`}
              cx={cx}
              cy={proj.y}
              rx={ellipseRx}
              ry={ellipseRx * 0.12}
              fill="none"
              stroke="rgba(52,211,153,0.2)"
              strokeWidth="1"
            />
          );
        })}

        {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => {
          const p1 = project(85, lon);
          const p3 = project(-85, lon);
          return (
            <line
              key={`lon-${lon}`}
              x1={p1.x}
              y1={p1.y}
              x2={p3.x}
              y2={p3.y}
              stroke="rgba(52,211,153,0.15)"
              strokeWidth="1"
            />
          );
        })}

        {projectedPoints.map((p, i) => {
          const size = Math.max(8, (p.count || 1) * 4);
          const fontSize = 12;

          const labelY = p.y + size + fontSize + 4;
          const labelWidth = p.name.length * 6 + 8;
          const labelHeight = fontSize + 4;

          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={size}
                fill={getColor(p.tier)}
                stroke="white"
                strokeWidth="2"
                filter="url(#pointGlow)"
              />
              <rect
                x={p.x - labelWidth / 2}
                y={labelY - fontSize + 2}
                width={labelWidth}
                height={labelHeight}
                rx="4"
                fill="rgba(0,0,0,0.6)"
              />
              <text
                x={p.x}
                y={labelY}
                textAnchor="middle"
                fill="white"
                fontSize={fontSize}
                fontWeight="600"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
        <div className="px-4 py-1.5 rounded-full bg-black/50 backdrop-blur-sm flex items-center gap-2">
          <span className="text-sm">🌍</span>
          <span className="text-xs text-white/80">Arrastra para rotar</span>
        </div>
      </div>

      <div className="absolute top-3 left-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-white/70">Fake</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-white/70">Uncertain</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-white/70">Real</span>
        </div>
      </div>
    </div>
  );
}