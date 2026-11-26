import { redirect } from "next/navigation";
import { ChevronRight, Link2, UserCheck } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Link geral: /add/{token}/apps
 * Lista os apps do dono do link e cada um segue para /add/oauth/{token}?app=...
 * O Instagram só deixa a conta autorizar o app em que ela é testadora, então
 * quem escolhe o app é quem abre o link.
 */
export default async function AddChooseAppPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = getSupabaseAdmin();

  const { data: record } = await admin
    .from("magic_add_tokens")
    .select("user_id")
    .eq("token", token)
    .single();

  if (!record) redirect("/add/error?reason=invalid_token");

  const { data: apps } = await admin
    .from("user_meta_apps")
    .select("id, app_name, ig_app_id")
    .eq("user_id", record.user_id)
    .order("created_at", { ascending: false });

  // Mesma ordem do modal do Magic Link: app global primeiro, depois Meus Apps.
  // O ID do app do Instagram vai embaixo do nome: o agente da VPS acha o app escolhido por ele (lib/vps/estruturacao.ts).
  const global = process.env.NEXT_PUBLIC_META_CLIENT_ID;
  const options = [
    ...(global ? [{ key: "global", name: "App global", igAppId: global }] : []),
    ...(apps ?? []).map((app) => ({ key: app.id as string, name: app.app_name as string, igAppId: String(app.ig_app_id ?? "") })),
  ];

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 pt-safe pb-safe">
      <div className="glass-card rounded-2xl p-6 max-w-sm w-full space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-info-soft border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Link2 size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-ink font-semibold text-[15px] leading-tight">Em qual app conectar?</h1>
            <p className="text-ink-3 text-xs mt-0.5">Escolha o app em que esta conta é testadora.</p>
          </div>
        </div>

        {/* Moda antiga (sem app verificado): a conta aceita o convite de testador antes de conectar.
            Vai pela rota /add/{token}/convite, que redireciona para a página da Meta no mesmo navegador. */}
        <a
          href={`/add/${token}/convite`}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-info-soft border border-primary/30 text-sm text-ink hover:border-primary/50 transition-all"
        >
          <UserCheck size={14} className="text-ink-2 flex-shrink-0" />
          <span>Aceitar convites de testador</span>
          <ChevronRight size={14} className="text-ink-3 ml-auto flex-shrink-0" />
        </a>

        {options.length > 0 ? (
          <div className="space-y-2">
            {/* <a> e não <Link>: o prefetch do Link chamaria a rota que inicia o OAuth. */}
            {options.map((option) => (
              <a
                key={option.key}
                href={`/add/oauth/${token}?app=${option.key}`}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-surface border border-line text-sm text-ink-2 hover:border-line-control hover:bg-surface-hover transition-all"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                <span className="min-w-0 flex flex-col">
                  <span className="truncate">{option.name}</span>
                  <span className="text-[11px] text-ink-3">ID {option.igAppId}</span>
                </span>
                <ChevronRight size={14} className="text-ink-3 ml-auto flex-shrink-0" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-ink-3 text-sm leading-relaxed">
            Nenhum app cadastrado. Cadastre um app em Meus Apps no ScaleMaster.
          </p>
        )}

        <p className="text-ink-3 text-[11px] leading-relaxed">
          Ainda não é testadora? Aceite o convite primeiro e volte para esta página. Depois de escolher o app, é só autorizar no Instagram com a conta que vai ser conectada.
        </p>
      </div>
    </div>
  );
}
