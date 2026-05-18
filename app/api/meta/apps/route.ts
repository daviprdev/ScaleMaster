import { NextResponse } from "next/server";
import { getMetaApps } from "@/lib/meta-apps";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const apps = getMetaApps().map(({ id, name }) => ({ id, name }));
  return NextResponse.json({ apps });
}
