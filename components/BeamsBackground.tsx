"use client";

import { useEffect, useRef } from "react";

type Beam = {
  x: number;      // normalized 0–1.4 position
  speed: number;
  angle: number;  // radians — slight diagonal
  color: readonly [number, number, number];
  alpha: number;
  width: number;
};

const COLORS: readonly [number, number, number][] = [
  [0, 255, 65],
  [0, 229, 255],
  [0, 255, 65],
  [0, 229, 255],
];

function mkBeam(i: number): Beam {
  return {
    x: (i / 4) * 0.9 + Math.random() * 0.2,
    speed: 0.00035 + Math.random() * 0.00025,
    angle: -0.22 + (Math.random() - 0.5) * 0.18,
    color: COLORS[i % COLORS.length],
    alpha: 0.10 + Math.random() * 0.09,
    width: 1.2 + Math.random() * 1.2,
  };
}

export function BeamsBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth, H = window.innerHeight;
    canvas.width = W; canvas.height = H;

    const beams: Beam[] = Array.from({ length: 4 }, (_, i) => mkBeam(i));
    let raf: number;

    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W; canvas.height = H;
    };
    window.addEventListener("resize", onResize);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);

      for (const b of beams) {
        b.x += b.speed;
        if (b.x > 1.3) {
          b.x = -0.15;
          b.angle = -0.22 + (Math.random() - 0.5) * 0.18;
        }

        const bx = b.x * W;
        const beamH = H * 0.85;
        const dx = Math.tan(b.angle) * beamH;
        // Beam top-to-bottom line
        const x1 = bx - dx * 0.5, y1 = H * 0.08;
        const x2 = bx + dx * 0.5, y2 = y1 + beamH;

        const [r, g, bv] = b.color;

        // Wide soft glow volume
        const GLOW = 45;
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const nx = -uy, ny = ux; // normal

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1 + nx * GLOW, y1 + ny * GLOW);
        ctx.lineTo(x2 + nx * GLOW, y2 + ny * GLOW);
        ctx.lineTo(x2 - nx * GLOW, y2 - ny * GLOW);
        ctx.lineTo(x1 - nx * GLOW, y1 - ny * GLOW);
        ctx.closePath();
        const grd = ctx.createLinearGradient(
          x1 + nx * GLOW, y1 + ny * GLOW,
          x1 - nx * GLOW, y1 - ny * GLOW,
        );
        grd.addColorStop(0, `rgba(${r},${g},${bv},0)`);
        grd.addColorStop(0.35, `rgba(${r},${g},${bv},${b.alpha * 0.25})`);
        grd.addColorStop(0.5, `rgba(${r},${g},${bv},${b.alpha * 0.45})`);
        grd.addColorStop(0.65, `rgba(${r},${g},${bv},${b.alpha * 0.25})`);
        grd.addColorStop(1, `rgba(${r},${g},${bv},0)`);
        ctx.fillStyle = grd;
        ctx.fill();
        ctx.restore();

        // Trailing glow (left of beam)
        const trailLen = 100;
        ctx.save();
        const trailGrd = ctx.createLinearGradient(x1 - trailLen, 0, x1 + 4, 0);
        trailGrd.addColorStop(0, `rgba(${r},${g},${bv},0)`);
        trailGrd.addColorStop(1, `rgba(${r},${g},${bv},${b.alpha * 0.06})`);
        ctx.fillStyle = trailGrd;
        ctx.fillRect(x1 - trailLen, 0, trailLen + 4, H);
        ctx.restore();

        // Core bright line
        ctx.save();
        ctx.globalAlpha = b.alpha;
        ctx.shadowColor = `rgba(${r},${g},${bv},0.9)`;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = `rgba(${r},${g},${bv},1)`;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
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
