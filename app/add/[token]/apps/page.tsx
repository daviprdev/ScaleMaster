import { redirect } from "next/navigation";
import { ChevronRight, Link2 } from "lucide-react";
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
    .select("id, app_name")
    .eq("user_id", record.user_id)
    .order("created_at", { ascending: false });

  // Mesma ordem do modal do Magic Link: app global primeiro, depois Meus Apps.
  const options = [
    ...(process.env.NEXT_PUBLIC_META_CLIENT_ID ? [{ key: "global", name: "App global" }] : []),
    ...(apps ?? []).map((app) => ({ key: app.id as string, name: app.app_name as string })),
  ];

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center p-4 pt-safe pb-safe">
      <div className="glass-card rounded-2xl p-6 max-w-sm w-full space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#00498D]/10 border border-[#00498D]/20 flex items-center justify-center flex-shrink-0">
            <Link2 size={16} className="text-[#00498D]" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-[15px] leading-tight">Em qual app conectar?</h1>
            <p className="text-white/40 text-xs mt-0.5">Escolha o app em que esta conta é testadora.</p>
          </div>
        </div>

        {options.length > 0 ? (
          <div className="space-y-2">
            {/* <a> e não <Link>: o prefetch do Link chamaria a rota que inicia o OAuth. */}
            {options.map((option) => (
              <a
                key={option.key}
                href={`/add/oauth/${token}?app=${option.key}`}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white/80 hover:border-white/20 hover:bg-white/[0.06] transition-all"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#00498D]/50 flex-shrink-0" />
                <span className="truncate">{option.name}</span>
                <ChevronRight size={14} className="text-white/30 ml-auto flex-shrink-0" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-white/50 text-sm leading-relaxed">
            Nenhum app cadastrado. Cadastre um app em Meus Apps no ScaleMaster.
          </p>
        )}

        <p className="text-white/25 text-[11px] leading-relaxed">
          Depois de escolher, é só autorizar no Instagram com a conta que vai ser conectada.
        </p>
      </div>
    </div>
  );
}
