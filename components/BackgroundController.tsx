"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, X } from "lucide-react";
import { useBgMode, type BgMode } from "./BackgroundContext";

const OPTIONS: { value: BgMode; icon: string; label: string; desc: string }[] = [
  { value: "terrain",   icon: "⛰",  label: "Terreno 3D",  desc: "Malha topográfica perspectivada" },
  { value: "particles", icon: "✦",  label: "Partículas",  desc: "Partículas flutuantes neon" },
  { value: "beams",     icon: "⚡", label: "Feixes",      desc: "Feixes de luz laser" },
  { value: "off",       icon: "○",  label: "Desligado",   desc: "Sem animação de fundo" },
];

export function BackgroundController() {
  const { mode, setMode } = useBgMode();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 50 }}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: 46,
              right: 0,
              width: 228,
              background: "rgba(0,0,0,0.88)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              border: "0.5px solid rgba(255,255,255,0.12)",
              borderRadius: 14,
              padding: "10px 8px 8px",
              boxShadow: "0 8px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(0,255,65,0.08)",
            }}
          >
            <p style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.3)",
              padding: "0 10px 8px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}>
              Fundo Animado
            </p>

            {OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => { setMode(opt.value); setOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 9,
                    border: active ? "0.5px solid rgba(0,255,65,0.25)" : "0.5px solid transparent",
                    background: active ? "rgba(0,255,65,0.07)" : "transparent",
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 15, width: 22, textAlign: "center", lineHeight: 1 }}>
                    {opt.icon}
                  </span>
                  <span style={{ flex: 1, textAlign: "left" }}>
                    <span style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: active ? "var(--matrix)" : "rgba(255,255,255,0.72)",
                      textShadow: active ? "0 0 8px rgba(0,255,65,0.5)" : "none",
                    }}>
                      {opt.label}
                    </span>
                    <span style={{ display: "block", fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 1 }}>
                      {opt.desc}
                    </span>
                  </span>
                  {active && (
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: "var(--matrix)",
                      boxShadow: "0 0 8px rgba(0,255,65,0.9), 0 0 16px rgba(0,255,65,0.4)",
                      flexShrink: 0,
                    }} />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((v) => !v)}
        title="Controle de fundo"
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          border: open
            ? "0.5px solid rgba(0,255,65,0.4)"
            : "0.5px solid rgba(255,255,255,0.1)",
          background: open ? "rgba(0,255,65,0.08)" : "rgba(0,0,0,0.65)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: open ? "var(--matrix)" : "rgba(255,255,255,0.35)",
          transition: "all 0.2s",
          boxShadow: open ? "0 0 14px rgba(0,255,65,0.25)" : "none",
        }}
      >
        {open ? <X size={13} /> : <Layers size={13} />}
      </motion.button>
    </div>
  );
}
