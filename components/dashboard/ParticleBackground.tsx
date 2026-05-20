"use client";

import { useEffect, useState } from "react";

interface Particle {
  id: number;
  left: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  color: string;
}

const COLORS = ["bg-violet-400", "bg-cyan-400", "bg-indigo-400", "bg-white"];
const WEIGHTS = [0.25, 0.25, 0.2, 0.3]; // probability per color

function pickColor(rand: number): string {
  let acc = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    acc += WEIGHTS[i];
    if (rand < acc) return COLORS[i];
  }
  return COLORS[COLORS.length - 1];
}

export function ParticleBackground() {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const count = 55;
    const p: Particle[] = Array.from({ length: count }, (_, i) => {
      const rand = () => Math.random();
      return {
        id: i,
        left: rand() * 100,
        size: rand() > 0.8 ? 2 : 1,
        duration: 20 + rand() * 30,
        delay: rand() * 35,
        opacity: 0.06 + rand() * 0.22,
        color: pickColor(rand()),
      };
    });
    setParticles(p);
  }, []);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
      {particles.map((p) => (
        <div
          key={p.id}
          className={`absolute rounded-full ${p.color}`}
          style={{
            left: `${p.left}%`,
            bottom: "-4px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animation: `particle-float ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
