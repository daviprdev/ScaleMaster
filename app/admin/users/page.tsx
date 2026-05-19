"use client";

import { useEffect, useState } from "react";
import { Users, Loader2, AlertCircle, ShieldBan, Instagram } from "lucide-react";
import { cn } from "@/lib/utils";

interface Account {
  username: string;
  is_active: boolean;
  token_expires_at: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  role: "user" | "admin" | "banned";
  accounts: Account[];
}

const ROLE_BADGE: Record<AdminUser["role"], string> = {
  admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  user: "bg-white/5 text-white/50 border-white/10",
  banned: "bg-red-500/20 text-red-400 border-red-500/30",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setUsers(data.users);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Usuários</h1>
          <p className="mt-1 text-sm text-white/40">
            Todos os usuários cadastrados na plataforma
          </p>
        </div>
        {!loading && (
          <span className="text-sm text-white/30">{users.length} registros</span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Carregando usuários…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-left">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
                <th className="px-4 py-3 font-medium">Cargo</th>
                <th className="px-4 py-3 font-medium">Contas Meta</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Email */}
                  <td className="px-4 py-3 text-white font-medium">
                    {u.email}
                  </td>

                  {/* Created at */}
                  <td className="px-4 py-3 text-white/40">
                    {formatDate(u.created_at)}
                  </td>

                  {/* Role badge */}
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                        ROLE_BADGE[u.role]
                      )}
                    >
                      {u.role}
                    </span>
                  </td>

                  {/* Accounts */}
                  <td className="px-4 py-3">
                    {u.accounts.length === 0 ? (
                      <span className="text-white/20 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.accounts.map((acc) => (
                          <span
                            key={acc.username}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                              acc.is_active
                                ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                                : "bg-white/5 text-white/30 border-white/10"
                            )}
                          >
                            <Instagram className="w-3 h-3" />
                            {acc.username}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled
                      title="Em breve: banir usuário"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 opacity-50 cursor-not-allowed"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                      Banir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/30">
              <Users className="w-8 h-8" />
              <p className="text-sm">Nenhum usuário encontrado</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
