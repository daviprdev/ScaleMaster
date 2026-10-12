import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Formato SharkBot — mesma estrutura da ApexVips para manter compatibilidade.
// Eventos: payment_approved é venda confirmada; demais são ignorados.
interface SharkBotPayload {
  event?: string;
  transaction?: {
    sale_code?: string;
    plan_name?: string;
    plan_value?: number; // em centavos
    currency?: string;
  };
  customer?: {
    full_name?: string;
    username?: string;
    phone?: string;
    profile_name?: string;
  };
}

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const querySecret = req.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHARKBOT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
    
  if (!isAuthorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SharkBotPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  console.log(
    "[sharkbot-webhook][global] evento recebido:",
    JSON.stringify({ event: payload.event, sale_code: payload.transaction?.sale_code, plan_value: payload.transaction?.plan_value })
  );

  if (payload.event !== "payment_approved") {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const tx = payload.transaction ?? {};
  const customer = payload.customer ?? {};

  const amount = typeof tx.plan_value === "number" ? tx.plan_value / 100 : null;
  const currency = tx.currency ?? "BRL";
  const externalId = tx.sale_code ?? null;
  const customerIdentifier = customer.full_name ?? customer.username ?? customer.profile_name ?? customer.phone ?? null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
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
    await sendPushNotification({
      targetType: "admins",
      type: "sale",
      title: "🔥 Venda Aprovada (SharkBot) 🔥",
      body:
        amount != null
          ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : "Novo pagamento recebido.",
      url: "/admin",
    });
  } catch (err: any) {
    console.warn("[sharkbot-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}