"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ReelCard, type Reel } from "./ReelCard";

interface ReelGridProps {
  reels: Reel[];
  onDownload: (reel: Reel) => Promise<void>;
}

export function ReelGrid({ reels, onDownload }: ReelGridProps) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        layout
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
      >
        {reels.map((reel) => (
          <ReelCard key={reel.id} reel={reel} onDownload={onDownload} />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

// ── Skeleton loader ──────────────────────────────────────
export function ReelGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04 }}
          className="rounded-2xl bg-white/[0.04] border border-white/[0.06] animate-pulse"
          style={{ aspectRatio: "9/16" }}
        >
          <div className="h-full w-full bg-gradient-to-br from-white/[0.03] to-transparent rounded-2xl" />
        </motion.div>
      ))}
    </div>
  );
}
