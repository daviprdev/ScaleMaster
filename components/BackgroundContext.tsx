"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { WireframeTerrain } from "./WireframeTerrain";
import { ParticlesBackground } from "./ParticlesBackground";
import { BeamsBackground } from "./BeamsBackground";

export type BgMode = "terrain" | "particles" | "beams" | "off";

const VALID: BgMode[] = ["terrain", "particles", "beams", "off"];
const KEY = "as_bg_mode";

type Ctx = { mode: BgMode; setMode: (m: BgMode) => void };
const BgCtx = createContext<Ctx>({ mode: "terrain", setMode: () => {} });

export function useBgMode() {
  return useContext(BgCtx);
}

export function BackgroundProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<BgMode>("terrain");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(KEY) as BgMode | null;
    if (saved && VALID.includes(saved)) setModeState(saved);
    setReady(true);
  }, []);

  const setMode = (m: BgMode) => {
    setModeState(m);
    localStorage.setItem(KEY, m);
  };

  return (
    <BgCtx.Provider value={{ mode, setMode }}>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {ready && mode === "terrain"   && <WireframeTerrain />}
        {ready && mode === "particles" && <ParticlesBackground />}
        {ready && mode === "beams"     && <BeamsBackground />}
      </div>
      {children}
    </BgCtx.Provider>
  );
}
