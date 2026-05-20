"use client";

import { useState } from "react";
import { Megaphone, X } from "lucide-react";

interface Props {
  message: string;
}

export function AnnouncementBanner({ message }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="relative z-40 flex items-center justify-between gap-3 bg-amber-600/90 backdrop-blur-sm border-b border-amber-500/40 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2 text-white text-xs font-medium min-w-0">
        <Megaphone className="w-3.5 h-3.5 text-amber-200 shrink-0" />
        <span className="truncate">{message}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-white/60 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
