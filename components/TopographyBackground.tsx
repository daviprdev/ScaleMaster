"use client";

import { useEffect, useRef } from "react";

// Color endpoints
const C_LOW = [0, 229, 255] as const;  // #85B9E9  Electric Cyan (valleys)
const C_HIGH = [0, 255, 65] as const;  // #00498D  Matrix Green  (peaks)

function rgbAt(t: number): string {
  const r = Math.round(C_LOW[0] + (C_HIGH[0] - C_LOW[0]) * t);
  const g = Math.round(C_LOW[1] + (C_HIGH[1] - C_LOW[1]) * t);
  const b = Math.round(C_LOW[2] + (C_HIGH[2] - C_LOW[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// Grid resolution — keep modest for 60-device performance
const COLS = 44;
const ROWS = 27;
const AMP = 62;          // Z wave amplitude in px
const SPEED = 0.007;     // animation speed
const FPS = 24;          // target frame rate
const MS_PER_FRAME = 1000 / FPS;

function waveZ(c: number, r: number, t: number): number {
  const nx = c / COLS;
  const ny = r / ROWS;
  return (
    Math.sin(nx * Math.PI * 3.5 + t)       * AMP * 0.55 +
    Math.sin(ny * Math.PI * 2.8 + t * 0.72) * AMP * 0.33 +
    Math.sin((nx + ny) * Math.PI * 2.2 + t * 0.48) * AMP * 0.18
  );
}

export function TopographyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let prev = 0;
    let t = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (now - prev < MS_PER_FRAME) return;
      prev = now;
      t += SPEED;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 0.5;

      const cw = W / COLS;
      // Slightly compress row height so the mesh fills the screen with perspective
      const ch = (H * 1.35) / ROWS;

      // Pre-compute screen positions for every grid vertex
      const pts: Array<Array<{ sx: number; sy: number; n: number }>> = [];
      for (let r = 0; r <= ROWS; r++) {
        pts[r] = [];
        for (let c = 0; c <= COLS; c++) {
          const z = waveZ(c, r, t);
          // "Tilt" projection: high Z points rise upward on screen
          pts[r][c] = {
            sx: c * cw,
            sy: r * ch - z * 0.52,
            n: (z + AMP) / (2 * AMP), // 0 = valley, 1 = peak
          };
        }
      }

      // Draw horizontal spans
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const a = pts[r][c];
          const b = pts[r][c + 1];
          const n = (a.n + b.n) * 0.5;
          ctx.globalAlpha = 0.09 + n * 0.22;
          ctx.strokeStyle = rgbAt(n);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }

      // Draw vertical spans
      for (let c = 0; c <= COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const a = pts[r][c];
          const b = pts[r + 1][c];
          const n = (a.n + b.n) * 0.5;
          ctx.globalAlpha = 0.06 + n * 0.15;
          ctx.strokeStyle = rgbAt(n);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
