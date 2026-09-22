import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_roles")
    .select("sales_webhook_token")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Não foi possível gerar seu link" }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  const token = data.sales_webhook_token;

  return NextResponse.json({
    apexvips: `${origin}/api/webhooks/apexvips/${token}`,
    sharkbot: `${origin}/api/webhooks/sharkbot/${token}`,
    // Compatibilidade retroativa: campos antigos que esperam { url }
    url: `${origin}/api/webhooks/apexvips/${token}`,
  });
}
