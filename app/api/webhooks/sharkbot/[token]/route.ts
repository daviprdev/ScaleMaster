import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { parseSharkBotSale, type SharkBotPayload } from "@/lib/sharkbot";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = getSupabaseAdmin();

  const { data: owner, error: ownerErr } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("sales_webhook_token", token)
    .maybeSingle();

  if (ownerErr || !owner) {
    return NextResponse.json({ error: "Link de webhook inválido" }, { status: 404 });
  }
  const userId = owner.user_id as string;

  let payload: SharkBotPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sale = parseSharkBotSale(payload);
  console.log(
    "[sharkbot-webhook][token] evento recebido:",
    JSON.stringify({ event: payload.event, transaction_id: sale.externalId, amount: sale.amount })
  );

  if (payload.event !== "payment_approved") {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const { amount, currency, externalId, customerIdentifier } = sale;

  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
        user_id: userId,
        external_id: externalId,
        amount,
        currency,
        source: "sharkbot",
        customer_identifier: customerIdentifier,
        raw_payload: payload,
      },
      { onConflict: "external_id", ignoreDuplicates: true }
    )
    .select();

  if (error) {
    console.error("[sharkbot-webhook] falha ao gravar venda:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (externalId && (!data || data.length === 0)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const { data: prefs } = await admin
      .from("notification_settings")
      .select("sale_alerts_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefs?.sale_alerts_enabled !== false) {
      await sendPushNotification({
        targetType: "user",
        targetUserId: userId,
        type: "sale",
        title: "🔥 Venda Aprovada (SharkBot) 🔥",
        body:
          amount != null
            ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
            : "Novo pagamento recebido.",
        url: "/dashboard",
      });
    }
  } catch (err: any) {
    console.warn("[sharkbot-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}
