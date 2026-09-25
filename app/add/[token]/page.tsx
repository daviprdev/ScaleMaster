"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Página pública /add/[token]
 * O worker RPA navega até esta URL no final do onboarding.
 * Ela chama POST /api/onboarding/complete-magic-link para vincular a conta.
 * Não requer auth de sessão — o token é a prova de autorização.
 */
export default function AddTokenPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Vinculando conta ao AutoScale...");
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Token não encontrado na URL.");
      return;
    }

    async function completeMagicLink() {
      try {
        // Lê os dados da conta do localStorage (setados pelo worker via query params ou cookie)
        // O worker passa os dados via query string: ?username=X&ig_user_id=Y
        const searchParams = new URLSearchParams(window.location.search);
        const igUsername = searchParams.get("username") ?? "";
        const igUserId = searchParams.get("ig_user_id") ?? undefined;
        const displayName = searchParams.get("display_name") ?? undefined;
        const avatarUrl = searchParams.get("avatar_url") ?? undefined;

        if (!igUsername) {
          // Se o worker não passou username via query, tenta buscar do próprio token
          // (o worker pode ter navegado sem params — nesse caso usamos um fallback)
          setStatus("error");
          setMessage("Dados da conta não encontrados. O worker deve passar ?username= na URL.");
          return;
        }

        const res = await fetch("/api/onboarding/complete-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            username: igUsername,
            ig_user_id: igUserId,
            display_name: displayName,
            avatar_url: avatarUrl,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setStatus("error");
          setMessage(data.error ?? "Erro ao vincular conta.");
          return;
        }

        setUsername(data.username ?? igUsername);
        setStatus("success");
        setMessage(`Conta @${data.username ?? igUsername} vinculada com sucesso!`);

        // Redireciona para o dashboard após 3 segundos
        setTimeout(() => {
          router.push("/dashboard/accounts?connected=1");
        }, 3000);
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Erro de rede ao vincular conta.");
      }
    }

    completeMagicLink();
  }, [token, router]);

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center p-4 pt-safe pb-safe">
      <div className="glass-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
        {status === "loading" && (
          <>
            <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
            <h1 className="text-white font-bold text-xl">Vinculando conta...</h1>
            <p className="text-white/50 text-sm leading-relaxed">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-16 h-16 rounded-full bg-[#00FF41]/10 border border-[#00FF41]/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-[#00FF41]" />
            </div>
            <h1 className="text-white font-bold text-xl">Conta conectada!</h1>
            <p className="text-white/50 text-sm leading-relaxed">
              {username && <>@{username} foi vinculada com sucesso. </>}
              Redirecionando para o dashboard...
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-white font-bold text-xl">Erro na vinculação</h1>
            <p className="text-red-400/70 text-sm leading-relaxed">{message}</p>
            <button
              onClick={() => router.push("/dashboard/accounts")}
              className="mt-4 px-4 py-2 rounded-xl bg-white/10 text-white/70 text-sm hover:bg-white/15 transition-colors"
            >
              Voltar ao dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}