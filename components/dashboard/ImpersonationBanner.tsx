"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  adminEmail: string;
  userEmail: string;
}

export function ImpersonationBanner({ adminEmail, userEmail }: Props) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function exit() {
    setLeaving(true);
    await fetch("/api/admin/impersonate/exit", { method: "POST" });
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
  }

  return (
    <div className="relative z-50 flex items-center justify-between gap-3 bg-[#00346D]/95 backdrop-blur-sm border-b border-[#00498D]/40 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2 text-white text-xs font-medium min-w-0">
        <Shield className="w-3.5 h-3.5 text-[#AFBDD0] shrink-0" />
        <span className="truncate">
          Modo Admin —{" "}
          <span className="font-bold text-white">Vendo como {userEmail}</span>
          <span className="text-[#AFBDD0]/70 ml-2">· Admin: {adminEmail}</span>
        </span>
      </div>
      <button
        onClick={exit}
        disabled={leaving}
        className="flex items-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 px-3 py-1 text-xs text-white font-medium transition-all shrink-0"
      >
        {leaving
          ? <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
          : <LogOut className="w-3 h-3" />
        }
        Sair do modo Admin
      </button>
    </div>
  );
}
