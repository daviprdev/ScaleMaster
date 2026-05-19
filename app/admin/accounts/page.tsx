"use client";

import { useEffect, useState } from "react";
import {
  Instagram,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Clock,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConnectedAccount {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  connected_at: string;
  token_expires_at: string | null;
  user_email: string;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setAccounts(data.accounts);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function revokeAccount(accountId: string) {
    if (pendingRevoke !== accountId) {
      setPendingRevoke(accountId);
      return;
    }
    setPendingRevoke(null);
    setRevoking(accountId);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao revogar conta");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Contas Conectadas</h1>
          <p className="mt-1 text-sm text-white/40">
            Todas as contas Instagram vinculadas na plataforma
          </p>
        </div>
        {!loading && (
          <span className="text-sm text-white/30">{accounts.length} contas</span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Carregando contas…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400/60 hover:text-red-400"
          >
            ✕
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-left">
                <th className="px-4 py-3 font-medium">Conta Instagram</th>
                <th className="px-4 py-3 font-medium">Usuário</th>
                <th className="px-4 py-3 font-medium">Conectada em</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {accounts.map((acc) => {
                const days = daysUntil(acc.token_expires_at);
                const tokenOk = days === null || days > 7;
                const isRevoking = revoking === acc.id;
                const isPending = pendingRevoke === acc.id;

                return (
                  <tr
                    key={acc.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Instagram className="w-4 h-4 text-pink-400 shrink-0" />
                        <div>
                          <p className="text-white font-medium">
                            @{acc.username}
                          </p>
                          {acc.display_name && (
                            <p className="text-xs text-white/30">
                              {acc.display_name}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs">
                      {acc.user_email}
                    </td>
                    <td className="px-4 py-3 text-white/40">
                      {formatDate(acc.connected_at)}
                    </td>
                    <td className="px-4 py-3">
                      {days !== null ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5",
                            days < 0
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : days <= 7
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          <Clock className="w-3 h-3" />
                          {days < 0 ? "Expirado" : `${days}d restantes`}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5",
                          acc.is_active && tokenOk
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}
                      >
                        <ShieldCheck className="w-3 h-3" />
                        {acc.is_active && tokenOk ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isRevoking ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white/40 ml-auto" />
                      ) : (
                        <button
                          onClick={() => revokeAccount(acc.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                            isPending
                              ? "border-red-400/40 bg-red-400/20 text-red-300"
                              : "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          )}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {isPending ? "Confirmar?" : "Revogar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {accounts.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/30">
              <Instagram className="w-8 h-8" />
              <p className="text-sm">Nenhuma conta conectada</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
