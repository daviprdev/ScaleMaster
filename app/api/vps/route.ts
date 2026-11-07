import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadVps } from "@/lib/vps/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET — VPSs conectadas (kind='vps'), os containers de cada uma, as contas da
// fila e os devices. Os PCs do MuMu não entram aqui.
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    return NextResponse.json(await loadVps(getSupabaseAdmin(), user.id));
  } catch (e) {
    console.error("[vps] leitura falhou:", (e as Error).message);
    return NextResponse.json({ error: "Não foi possível ler as contas da VPS. Tente de novo." }, { status: 500 });
  }
}
