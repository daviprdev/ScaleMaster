import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody {
  campaign_id?: string;
  action?: "pause" | "resume";
}

const STATUS_MESSAGES: Record<string, string> = {
  preparing: "A campanha ainda está sendo criada.",
  failed: "A campanha falhou na criação e não pode ser pausada.",
  paused: "A campanha já está pausada.",
  active: "A campanha não está pausada.",
};

// Pausa/retoma uma campanha da aba Postar. Pausar congela só a fila desta
// campanha: distribute_campaigns.status = 'paused' tira os posts dela da busca
// do cron publish-scheduled e impede o sync-distribute-accounts de matricular
// contas novas; os posts continuam 'pending', então contadores, histórico de
// vídeos e edição seguem funcionando. Retomar desloca os horários pendentes
// pelo tempo em pausa (RPC resume_distribute_campaign, atômica).
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ success: true, mock: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => null) as PauseBody | null;
  const campaignId = body?.campaign_id;
  if (!campaignId) return NextResponse.json({ error: "campaign_id é obrigatório." }, { status: 400 });
  if (body.action !== "pause" && body.action !== "resume") {
    return NextResponse.json({ error: "action deve ser 'pause' ou 'resume'." }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as ReturnType<typeof getSupabaseAdmin>;

  // Explica por que a transição não aconteceu (estado atual da campanha).
  const conflict = async () => {
    const { data: current } = await (admin as any)
      .from("distribute_campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    const status = (current as { status?: string } | null)?.status;
    if (!status) {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }
    return NextResponse.json(
      { error: STATUS_MESSAGES[status] ?? `Status atual: ${status}.`, status },
      { status: 409 },
    );
  };

  if (body.action === "pause") {
    // Só 'active' → 'paused': uma campanha em 'preparing' ainda está inserindo
    // posts e a ativação dela (posts/distribute) exige status = 'preparing'.
    const { data, error } = await (admin as any)
      .from("distribute_campaigns")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return conflict();

    return NextResponse.json({ success: true, status: "paused" });
  }

  const { data: rescheduled, error } = await (admin as any)
    .rpc("resume_distribute_campaign", { p_campaign_id: campaignId, p_user_id: user.id });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (rescheduled === -1) return conflict();

  return NextResponse.json({ success: true, status: "active", rescheduled });
}
