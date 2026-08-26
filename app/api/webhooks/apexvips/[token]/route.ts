import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Mesmo formato documentado em app/api/webhooks/apexvips/route.ts. Eventos vistos:
// user_joined, payment_created, payment_approved. Só "payment_approved" é venda
// confirmada. Diferente da rota global (secret único, sem dono), esta rota é
// exclusiva de UM usuário — o token no path identifica de quem é a venda.
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
    profile_name?: string;
  };
}

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
  const customerIdentifier =
    customer.username ?? customer.full_name ?? customer.profile_name ?? customer.phone ?? null;
  const planName = tx.plan_name ?? null;

  const { data, error } = await admin
    .from("sales")
    .upsert(
      {
        user_id: userId,
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
        title: "Venda Aprovada!",
        body:
          amount != null
            ? `${planName ?? "Venda"}: R$ ${amount.toFixed(2)} (${currency}) via ApexVips.`
            : "Nova venda recebida — verifique o payload (valor não identificado).",
        url: "/dashboard",
      });
    }
  } catch (err: any) {
    console.warn("[apexvips-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}
