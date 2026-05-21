"use client";

import { useEffect, useRef } from "react";

const COLS = 56;
const ROWS = 28;
const AMP = 90;
const SPEED = 0.006;
const FPS = 30;
const MS = 1000 / FPS;

const C_CYAN  = [0, 229, 255] as const;
const C_GREEN = [0, 255, 65]  as const;

function rgbAt(n: number, pulse: number): string {
  const blend = Math.min(1, Math.max(0, n * 0.62 + pulse * 0.38));
  const r = Math.round(C_CYAN[0] + (C_GREEN[0] - C_CYAN[0]) * blend);
  const g = Math.round(C_CYAN[1] + (C_GREEN[1] - C_CYAN[1]) * blend);
  const b = Math.round(C_CYAN[2] + (C_GREEN[2] - C_CYAN[2]) * blend);
  return `${r},${g},${b}`;
}

function waveZ(c: number, r: number, t: number): number {
  const nx = c / COLS, ny = r / ROWS;
  return (
    Math.sin(nx * Math.PI * 4.5 + t)           * AMP * 0.45 +
    Math.sin(ny * Math.PI * 3.2 + t * 0.68)    * AMP * 0.28 +
    Math.sin((nx * 1.8 + ny * 0.7) * Math.PI * 2.4 + t * 0.55) * AMP * 0.15 +
    Math.sin((nx * 0.6 - ny * 1.4) * Math.PI * 1.9 + t * 0.38) * AMP * 0.12
  );
}

export function WireframeTerrain() {
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
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (now - prev < MS) return;
      prev = now;
      t += SPEED;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 0.5;

      const pulse = (Math.sin(t * 0.65) + 1) / 2;
      const horizonY = H * 0.27;

      type Pt = { sx: number; sy: number; n: number; a: number };
      const pts: Pt[][] = [];

      for (let r = 0; r <= ROWS; r++) {
        pts[r] = [];
        const rn = r / ROWS;
        // Perspective convergence: far rows narrow, near rows wide
        const spread  = 0.14 + rn * 0.86;
        const offsetX = (1 - spread) * W * 0.5;
        // Y: power curve compresses rows near horizon
        const syBase  = horizonY + Math.pow(rn, 1.45) * (H - horizonY) * 0.93;
        // Alpha: fade toward horizon
        const rowAlpha = Math.pow(rn, 0.55) * 0.44;
        // Z displacement scales with depth (near = more dramatic)
        const zScale  = 0.35 + rn * 0.55;

        for (let c = 0; c <= COLS; c++) {
          const z = waveZ(c, r, t);
          const n = (z + AMP) / (2 * AMP);
          pts[r][c] = {
            sx: offsetX + (c / COLS) * spread * W,
            sy: syBase - z * zScale,
            n,
            a: rowAlpha,
          };
        }
      }

      // Horizontal edges
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const a = pts[r][c], b = pts[r][c + 1];
          const n = (a.n + b.n) * 0.5;
          ctx.globalAlpha = (a.a + b.a) * 0.5;
          ctx.strokeStyle = `rgb(${rgbAt(n, pulse)})`;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }

      // Vertical edges
      for (let c = 0; c <= COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const a = pts[r][c], b = pts[r + 1][c];
          const n = (a.n + b.n) * 0.5;
          ctx.globalAlpha = (a.a + b.a) * 0.5 * 0.65;
          ctx.strokeStyle = `rgb(${rgbAt(n, pulse)})`;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }

      // Horizon glow band
      ctx.globalAlpha = 1;
      const gr = Math.round(229 + (255 - 229) * pulse);
      const gb = Math.round(255 + (65  - 255) * pulse);
      const band = ctx.createLinearGradient(0, horizonY - 55, 0, horizonY + 35);
      band.addColorStop(0,   `rgba(0,${gr},${gb},0)`);
      band.addColorStop(0.4, `rgba(0,${gr},${gb},0.05)`);
      band.addColorStop(0.5, `rgba(0,${gr},${gb},0.10)`);
      band.addColorStop(0.65,`rgba(0,255,65,0.04)`);
      band.addColorStop(1,   `rgba(0,255,65,0)`);
      ctx.fillStyle = band;
      ctx.fillRect(0, horizonY - 55, W, 90);
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
