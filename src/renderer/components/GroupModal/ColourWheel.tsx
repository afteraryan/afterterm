// The colour wheel in the project dialog's pop-up: the wheel, a brightness bar and a
// colour code field, all live. It keeps its own hue, saturation and brightness, because
// a colour code alone would lose them (black has no hue), and reports every change as
// a code. It opens at the project's current colour and changes nothing until it is used.
import React, { useRef, useState } from 'react';
import { CustomColor } from '../TabBar/types';
import { Hsv, hexToHsv, hsvToHex, readHexInput, wheelPoint, wheelThumb } from '../../projectColour';

interface ColourWheelProps {
  initial: string;
  onChange: (color: CustomColor) => void;
}

// One press of an arrow key on the wheel: degrees of hue, or a step of saturation.
const ARROW_STEPS: Record<string, { h: number; s: number }> = {
  ArrowLeft: { h: -3, s: 0 },
  ArrowRight: { h: 3, s: 0 },
  ArrowUp: { h: 0, s: 0.03 },
  ArrowDown: { h: 0, s: -0.03 },
};

export function ColourWheel({ initial, onChange }: ColourWheelProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial));
  // The code as typed, kept as it is until the field loses focus, so the field never
  // rewrites what someone is in the middle of typing.
  const [typed, setTyped] = useState<string | null>(null);
  const dragging = useRef(false);
  const hex = hsvToHex(hsv);
  const thumb = wheelThumb(hsv.h, hsv.s);

  const update = (next: Hsv) => {
    setHsv(next);
    setTyped(null);
    onChange(hsvToHex(next));
  };

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    update({ ...hsv, ...wheelPoint((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height) });
  };

  return (
    <div className="modal-wheel-row" data-colour-wheel>
      <div
        className="modal-wheel"
        tabIndex={0}
        role="slider"
        aria-label="Colour wheel"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={hex.toUpperCase()}
        onPointerDown={e => {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          fromPointer(e);
        }}
        onPointerMove={e => { if (dragging.current) fromPointer(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={e => {
          const step = ARROW_STEPS[e.key];
          if (!step) return;
          e.preventDefault();
          update({ ...hsv, h: (hsv.h + step.h + 360) % 360, s: Math.max(0, Math.min(1, hsv.s + step.s)) });
        }}
      >
        <span className="modal-wheel-dark" style={{ opacity: 1 - hsv.v }} />
        <span className="modal-wheel-thumb" style={{ left: `${thumb.left}%`, top: `${thumb.top}%`, background: hex }} />
      </div>
      <div className="modal-wheel-side">
        <input
          className="modal-wheel-bar"
          type="range"
          min={0}
          max={100}
          aria-label="Brightness"
          value={Math.round(hsv.v * 100)}
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex({ ...hsv, v: 1 })})` }}
          onChange={e => update({ ...hsv, v: Number(e.target.value) / 100 })}
        />
        <input
          className="modal-input modal-wheel-code"
          aria-label="Colour code"
          spellCheck={false}
          autoComplete="off"
          value={typed ?? hex.toUpperCase()}
          onChange={e => {
            setTyped(e.target.value);
            const code = readHexInput(e.target.value);
            if (!code) return;
            setHsv(hexToHsv(code));
            onChange(code);
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      </div>
    </div>
  );
}
