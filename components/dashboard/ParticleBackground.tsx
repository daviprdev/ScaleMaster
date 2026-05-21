"use client";

import { useEffect, useState } from "react";

interface FloatParticle {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;    // --p-o  : peak opacity
  driftX: number;     // --p-dx : X offset at 50%
  returnX: number;    // --p-rx : X offset at 100%
  color: string;
}

interface TwinkleParticle {
  id: number;
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
}

// Color palette weighted toward violet/cyan for the cyber-aurora theme
const FLOAT_COLORS = [
  "rgba(167,139,250,1)",  // violet-400
  "rgba(167,139,250,1)",  // violet-400 (doubled weight)
  "rgba(34,211,238,1)",   // cyan-400
  "rgba(34,211,238,1)",   // cyan-400 (doubled weight)
  "rgba(129,140,248,1)",  // indigo-400
  "rgba(255,255,255,1)",  // white
  "rgba(216,180,254,1)",  // violet-300
  "rgba(103,232,249,1)",  // cyan-300
];

export function ParticleBackground() {
  const [floaters, setFloaters] = useState<FloatParticle[]>([]);
  const [twinklers, setTwinklers] = useState<TwinkleParticle[]>([]);

  useEffect(() => {
    const rng = Math.random;

    // 80 upward-floating dust particles
    const f: FloatParticle[] = Array.from({ length: 80 }, (_, i) => {
      const r = rng();
      const drift = (rng() - 0.5) * 30;       // –15 to +15 px
      return {
        id: i,
        left: rng() * 100,
        size: r > 0.85 ? 2.5 : r > 0.6 ? 1.5 : 1,
        duration: 18 + rng() * 32,             // 18–50 s
        delay: rng() * 40,                     // spread start times
        opacity: 0.08 + rng() * 0.28,          // 0.08–0.36 peak opacity
        driftX: drift,
        returnX: -(drift * 0.6),
        color: FLOAT_COLORS[Math.floor(rng() * FLOAT_COLORS.length)],
      };
    });

    // 25 static "star" particles that twinkle
    const t: TwinkleParticle[] = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      left: rng() * 100,
      top: rng() * 100,
      size: rng() > 0.7 ? 2 : 1,
      duration: 3 + rng() * 5,                // 3–8 s twinkle cycle
      delay: rng() * 6,
    }));

    setFloaters(f);
    setTwinklers(t);
  }, []);

  if (floaters.length === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 1 }}
      aria-hidden="true"
    >
      {/* ── Floating dust ─────────────────────────────────── */}
      {floaters.map((p) => (
        <div
          key={`f${p.id}`}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            bottom: "-4px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            // Custom properties read by the @keyframes rule in globals.css
            ["--p-o" as string]: String(p.opacity),
            ["--p-dx" as string]: `${p.driftX}px`,
            ["--p-rx" as string]: `${p.returnX}px`,
            animation: `particle-float ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}

      {/* ── Static twinkling stars ────────────────────────── */}
      {twinklers.map((p) => (
        <div
          key={`t${p.id}`}
          className="absolute rounded-full bg-white"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animation: `particle-twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
