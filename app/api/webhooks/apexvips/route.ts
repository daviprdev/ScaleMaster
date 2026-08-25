import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Formato do payload da ApexVips ainda não documentado — extração defensiva por
// nomes de campo comuns. Ajustar esta lista assim que a doc real estiver disponível.
const AMOUNT_KEYS = ["amount", "value", "valor", "total", "price", "preco", "amount_paid", "net_amount"];
const CUSTOMER_KEYS = ["customer", "customer_email", "email", "buyer", "cliente"];

function extractField(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return payload[key];
  }
  return null;
}

function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[^\d.,-]/g, "").replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.APEXVIPS_WEBHOOK_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.warn("[apexvips-webhook] AVISO: APEXVIPS_WEBHOOK_SECRET nao configurado.");
  } else if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const amount = parseAmount(extractField(payload, AMOUNT_KEYS));
  const customer = extractField(payload, CUSTOMER_KEYS);

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("sales").insert({
    amount,
    customer_identifier: typeof customer === "string" ? customer : null,
    source: "apexvips",
    raw_payload: payload,
  });

  if (error) {
    console.error("[apexvips-webhook] falha ao gravar venda:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await sendPushNotification({
      targetType: "admins",
      type: "sale",
      title: "Nova venda recebida",
      body:
        amount != null
          ? `Venda de R$ ${amount.toFixed(2)} via ApexVips.`
          : "Nova venda recebida — verifique o payload (valor não identificado).",
      url: "/admin",
    });
  } catch (err: any) {
    console.warn("[apexvips-webhook] falha ao enviar push:", err?.message);
  }

  return NextResponse.json({ ok: true, amount });
}
