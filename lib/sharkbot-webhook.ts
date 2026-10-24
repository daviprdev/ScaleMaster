import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import {
  SHARKBOT_ACCOUNTS,
  parseSharkBotSale,
  saleAmountBrl,
  saleNotificationBody,
  type SharkBotAccount,
  type SharkBotPayload,
} from "@/lib/sharkbot";

/**
 * Aviso de venda da SharkBot pelo link do usuário — o token no path diz de
 * quem é a venda, e `account` de qual conta da SharkBot ela veio (cada conta
 * tem sua rota: /api/webhooks/sharkbot/<token> e /<token>/gringa).
 */
export async function receiveSharkBotSale(req: NextRequest, token: string, account: SharkBotAccount) {
  const { source, label } = SHARKBOT_ACCOUNTS[account];
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
    `[sharkbot-webhook][${account}] evento recebido:`,
    JSON.stringify({ event: payload.event, transaction_id: sale.externalId, amount: sale.amount, currency: sale.currency })
  );

  if (payload.event !== "payment_approved") {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const amount = await saleAmountBrl(sale);
  if (sale.amount != null && amount == null) {
    console.error(`[sharkbot-webhook][${account}] sem cotação ${sale.currency}-BRL — venda gravada sem valor.`);
  }

  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
        user_id: userId,
        external_id: sale.externalId,
        amount,
        currency: "BRL",
        source,
        customer_identifier: sale.customerIdentifier,
        raw_payload: payload,
      },
      { onConflict: "external_id", ignoreDuplicates: true }
    )
    .select();

  if (error) {
    console.error("[sharkbot-webhook] falha ao gravar venda:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (sale.externalId && (!data || data.length === 0)) {
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
        title: `🔥 Venda Aprovada (${label}) 🔥`,
        body: saleNotificationBody(sale, amount),
        url: "/dashboard",
      });
    }
  } catch (err: any) {
    console.warn("[sharkbot-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}
