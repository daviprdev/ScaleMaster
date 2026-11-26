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
    <div className="relative z-40 flex items-center justify-between gap-3 bg-warning/15 backdrop-blur-xl border-b border-warning/40 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2 text-ink text-xs font-medium min-w-0">
        <Megaphone className="w-3.5 h-3.5 text-warning shrink-0" />
        <span className="truncate">{message}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-ink-2 hover:text-ink transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
