"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Signs the user out and sends them to the landing page.
// Reached when account_status === 'banned' on any protected layout.
export default function BannedPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.signOut().finally(() => {
      router.replace("/");
    });
  }, [router]);

  return (
    <div className="min-h-dvh bg-gray-950 flex items-center justify-center pt-safe pb-safe">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
    </div>
  );
}
