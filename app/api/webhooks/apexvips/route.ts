import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Formato real documentado pelo usuário (25/08). Eventos vistos: user_joined,
// payment_created, payment_approved. Só "payment_approved" é venda confirmada —
// payment_created é o PIX gerado mas ainda não pago, user_joined é só entrada no
// bot. Outros eventos futuros (ex: payment_declined/refunded) caem no default
// "ignorado" abaixo até serem mapeados explicitamente.
interface ApexVipsPayload {
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
  };
}

function isAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const querySecret = req.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

export async function POST(req: NextRequest) {
  const secret = process.env.APEXVIPS_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[apexvips-webhook] AVISO: APEXVIPS_WEBHOOK_SECRET nao configurado.");
  } else if (!isAuthorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ApexVipsPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (payload.event !== "payment_approved") {
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const tx = payload.transaction ?? {};
  const customer = payload.customer ?? {};

  const amount = typeof tx.plan_value === "number" ? tx.plan_value / 100 : null;
  const currency = tx.currency ?? "BRL";
  const externalId = tx.sale_code ?? null;
  const customerIdentifier = customer.full_name ?? customer.username ?? customer.phone ?? null;
  const planName = tx.plan_name ?? null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
        external_id: externalId,
        amount,
        currency,
        source: "apexvips",
        customer_identifier: customerIdentifier,
        raw_payload: payload,
      },
      { onConflict: "external_id", ignoreDuplicates: true }
    )
    .select();

  if (error) {
    console.error("[apexvips-webhook] falha ao gravar venda:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Com ignoreDuplicates, reenvio do mesmo sale_code não insere nada — select()
  // volta vazio. Não reenvia o push pra não notificar a mesma venda 2x.
  if (externalId && (!data || data.length === 0)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await sendPushNotification({
      targetType: "admins",
      type: "sale",
      title: "💰 Nova venda recebida",
      body:
        amount != null
          ? `${planName ?? "Venda"}: R$ ${amount.toFixed(2)} (${currency}) via ApexVips.`
          : "Nova venda recebida — verifique o payload (valor não identificado).",
      url: "/admin",
    });
  } catch (err: any) {
    console.warn("[apexvips-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}
