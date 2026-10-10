"use client";

import { useEffect, useRef } from "react";

const COUNT = 85;
const PALETTES = [
  [0, 73, 141]   as const,  // brand-blue
  [133, 185, 233] as const,  // focus blue
  [0, 52, 109]   as const,  // brand-blue-dark
];

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  baseAlpha: number;
  phase: number;
  phaseSpeed: number;
  ci: number;
};

function mk(W: number, H: number): Particle {
  return {
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.28,
    vy: -(Math.random() * 0.38 + 0.08),
    size: Math.random() * 1.8 + 0.4,
    baseAlpha: Math.random() * 0.28 + 0.04,
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: Math.random() * 0.018 + 0.004,
    ci: Math.floor(Math.random() * PALETTES.length),
  };
}

export function ParticlesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth, H = window.innerHeight;
    canvas.width = W; canvas.height = H;

    const ps: Particle[] = Array.from({ length: COUNT }, () => mk(W, H));
    let raf: number;

    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W; canvas.height = H;
    };
    window.addEventListener("resize", onResize);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);

      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.phase += p.phaseSpeed;
        if (p.y < -8 || p.x < -8 || p.x > W + 8) {
          p.x = Math.random() * W;
          p.y = H + 8;
          p.phase = Math.random() * Math.PI * 2;
        }
        const alpha = p.baseAlpha * (0.45 + Math.sin(p.phase) * 0.55);
        const [r, g, b] = PALETTES[p.ci];

        // Soft glow halo
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        grd.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.9})`);
        grd.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.3})`);
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Bright core
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha * 2.5)})`;
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
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
