import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEmulador } from "@/lib/emulador/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — PCs conectados, instâncias do MuMu de cada um e comandos do último dia.
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    return NextResponse.json(await loadEmulador(getSupabaseAdmin(), user.id));
  } catch (e) {
    console.error("[emulador] leitura falhou:", (e as Error).message);
    return NextResponse.json({ error: "Não foi possível ler o emulador. Tente de novo." }, { status: 500 });
  }
}
