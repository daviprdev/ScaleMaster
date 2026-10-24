import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { secureEquals } from "@/lib/cron-auth";
import { parseSharkBotSale, saleAmountBrl, saleNotificationBody, type SharkBotPayload } from "@/lib/sharkbot";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get("authorization");
  if (auth && secureEquals(auth, `Bearer ${secret}`)) return true;
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!querySecret && secureEquals(querySecret, secret);
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHARKBOT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }
  if (!isAuthorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SharkBotPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sale = parseSharkBotSale(payload);
  console.log(
    "[sharkbot-webhook][global] evento recebido:",
    JSON.stringify({ event: payload.event, transaction_id: sale.externalId, amount: sale.amount })
  );

  if (payload.event !== "payment_approved") {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const { externalId, customerIdentifier } = sale;
  const amount = await saleAmountBrl(sale);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
        external_id: externalId,
        amount,
        currency: "BRL",
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
    await sendPushNotification({
      targetType: "admins",
      type: "sale",
      title: "🔥 Venda Aprovada (SharkBot) 🔥",
      body: saleNotificationBody(sale, amount),
      url: "/admin",
    });
  } catch (err: any) {
    console.warn("[sharkbot-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}