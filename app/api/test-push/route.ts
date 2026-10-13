/**
 * /api/test-push
 *
 * Endpoint temporário para testar notificações push.
 * Envia uma notificação de teste para o usuário autenticado.
 * DELETE este arquivo após confirmar que as notificações funcionam.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const result = await sendPushNotification({
      targetType: "user",
      targetUserId: user.id,
      type: "system",
      title: "🔔 Teste de Notificação",
      body: "Esta é uma notificação de teste do ScaleMaster. Se você recebeu, as notificações push estão funcionando! ✅",
      url: "/dashboard",
      extraData: { test: true, timestamp: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: "Notificação de teste enviada!",
      result,
    });
  } catch (err) {
    console.error("[test-push] Erro ao enviar notificação:", err);
    return NextResponse.json(
      { error: "Falha ao enviar notificação", details: String(err) },
      { status: 500 }
    );
  }
}