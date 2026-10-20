import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// O formato abaixo foi copiado da ApexVips e ainda não foi conferido com um aviso
// real da SharkBot. Para acertar sem guardar dados do cliente, o log leva só a
// estrutura: nome e tipo de cada campo. Valores só de campos que dizem o evento
// ou o preço — é o que decide se o aviso vira venda e quanto ela vale.
const SAFE_VALUE_KEYS = /^(event|event_type|type|status|action|currency)$|value|amount|price|valor|preco|total/i;

function describeShape(value: unknown, key = "", depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [describeShape(value[0], key, depth + 1)] : [];
  if (typeof value === "object") {
    if (depth >= 6) return "object";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, describeShape(v, k, depth + 1)])
    );
  }
  const safe = SAFE_VALUE_KEYS.test(key) && (typeof value === "number" || (typeof value === "string" && value.length <= 60));
  return safe ? `${typeof value}:${value}` : typeof value;
}

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

  const contentType = req.headers.get("content-type");
  const raw = await req.text();
  let payload: SharkBotPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn("[sharkbot-webhook][token] corpo não é JSON:", JSON.stringify({ contentType, length: raw.length }));
    await logAudit({
      action: "sales_webhook_ignored",
      targetId: userId,
      details: { source: "sharkbot", reason: "invalid_json", contentType, length: raw.length },
    });
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const shape = describeShape(payload);
  console.log("[sharkbot-webhook][token] evento recebido:", JSON.stringify({ contentType, shape }));

  if (payload.event !== "payment_approved") {
    await logAudit({
      action: "sales_webhook_ignored",
      targetId: userId,
      details: { source: "sharkbot", reason: "event_not_handled", contentType, shape },
    });
    return NextResponse.json({ ok: true, ignored: payload.event ?? "unknown" });
  }

  const tx = payload.transaction ?? {};
  const customer = payload.customer ?? {};

  const amount = typeof tx.plan_value === "number" ? tx.plan_value / 100 : null;
  const currency = tx.currency ?? "BRL";
  const externalId = tx.sale_code ?? null;
  const customerIdentifier =
    customer.username ?? customer.full_name ?? customer.profile_name ?? customer.phone ?? null;

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