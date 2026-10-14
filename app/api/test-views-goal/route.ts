/**
 * /api/test-views-goal
 *
 * Endpoint temporário para testar a notificação de meta de views batida.
 * Envia com dados fictícios (2.343.859 views, meta 200.000).
 * DELETE este arquivo após confirmar.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/web-push";
import { getDailyViewsGoalMessage } from "@/lib/daily-views-goal-messages";

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

  // Dados fictícios para teste — simula meta batida
  const fakeCurrentViews = 2_343_859;
  const fakeGoal = 200_000;

  const { title, body } = getDailyViewsGoalMessage(fakeCurrentViews, fakeGoal);

  try {
    const result = await sendPushNotification({
      targetType: "user",
      targetUserId: user.id,
      type: "system",
      title,
      body,
      url: "/dashboard",
      extraData: {
        test: true,
        viewsGoalDate: "test",
        currentViews: fakeCurrentViews,
        goal: fakeGoal,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Notificação de meta batida enviada!",
      title,
      body,
      result,
    });
  } catch (err) {
    console.error("[test-views-goal] Erro:", err);
    return NextResponse.json(
      { error: "Falha ao enviar", details: String(err) },
      { status: 500 }
    );
  }
}