// The sad afterterm mascot, still and static (AFT-93): a copy of assets/mascot/stills/mood-sad.svg as
// JSX, so the usage card can show it when a read ends with no breakdown. It never moves. If the
// character changes, run assets/mascot/export.mjs and copy the new mood-sad.svg here.
import React from 'react';

const EYE_BASE = { transformBox: 'fill-box', transformOrigin: 'center', transform: 'translateY(10%)' } as const;
const HAIR = { fill: 'none', stroke: '#2b2733', strokeWidth: 5, strokeLinecap: 'round' } as const;

export function MascotSad({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="afterterm mascot, sad">
      <defs>
        <linearGradient id="mascot-sad-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2733" />
          <stop offset="0.68" stopColor="#0d0b12" />
          <stop offset="1" stopColor="#4a2470" />
        </linearGradient>
      </defs>
      <path d="M123 61 q-5 -15 -18 -15" {...HAIR} />
      <path d="M128 61 q-2 -19 8 -25" {...HAIR} />
      <path d="M133 61 q9 -11 20 -7" {...HAIR} />
      <path d="M52 148 C44 100 56 62 92 52 C128 44 154 66 158 104 C160 124 158 138 154 150 C150 158 140 158 136 150 L130 172 L122 152 H92 L86 170 L78 152 C70 160 56 158 52 148 Z" fill="url(#mascot-sad-body)" />
      <circle cx="74" cy="78" r="5.5" fill="#20b2aa" />
      <circle cx="90" cy="72" r="5.5" fill="#d28c32" />
      <circle cx="106" cy="72" r="5.5" fill="#9467bd" />
      <g transform="rotate(6 86 107)">
        <path
          d="M71 102.75 H101 V108.7 A15 15.3 0 0 1 71 108.7 Z"
          fill="#ffffff"
          style={{ ...EYE_BASE, clipPath: 'polygon(0.0% 48.0%,8.3% 44.0%,16.7% 40.0%,25.0% 36.0%,33.3% 32.0%,41.7% 28.0%,50.0% 24.0%,58.3% 20.0%,66.7% 16.0%,75.0% 12.0%,83.3% 8.0%,91.7% 4.0%,100.0% 0.0%,100.0% 100.0%,0.0% 100.0%)' }}
        />
      </g>
      <g transform="rotate(-6 124 107)">
        <path
          d="M109 102.75 H139 V108.7 A15 15.3 0 0 1 109 108.7 Z"
          fill="#ffffff"
          style={{ ...EYE_BASE, clipPath: 'polygon(0.0% 0.0%,8.3% 4.0%,16.7% 8.0%,25.0% 12.0%,33.3% 16.0%,41.7% 20.0%,50.0% 24.0%,58.3% 28.0%,66.7% 32.0%,75.0% 36.0%,83.3% 40.0%,91.7% 44.0%,100.0% 48.0%,100.0% 100.0%,0.0% 100.0%)' }}
        />
      </g>
      <path d="M93 144 A12 11 0 0 1 117 144 Q105 136 93 144 Z" fill="#ffffff" />
    </svg>
  );
}
