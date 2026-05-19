"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Loader2,
  AlertCircle,
  ShieldBan,
  ShieldCheck,
  Instagram,
  Crown,
  UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

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

type PendingAction = { userId: string; role: AdminUser["role"] };

export default function AdminUsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users").then((r) => r.json()),
      supabase.auth.getUser(),
    ])
      .then(([usersData, { data: { user } }]) => {
        if (usersData.error) throw new Error(usersData.error);
        setUsers(usersData.users);
        setCurrentUserId(user?.id ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [supabase]);

  async function applyRole(userId: string, role: AdminUser["role"]) {
    setActioning(userId);
    setPending(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar cargo");
    } finally {
      setActioning(null);
    }
  }

  function requestAction(userId: string, role: AdminUser["role"]) {
    if (pending?.userId === userId && pending.role === role) {
      applyRole(userId, role);
    } else {
      setPending({ userId, role });
    }
  }

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

      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Carregando usuários…</span>
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
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
                <th className="px-4 py-3 font-medium">Cargo</th>
                <th className="px-4 py-3 font-medium">Contas Meta</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                const isActioning = actioning === u.id;
                const isPending = pending?.userId === u.id;

                return (
                  <tr
                    key={u.id}
                    className="hover:bg-white/[0.02] transition-colors"
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
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="text-white/20 text-xs">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          {isPending && (
                            <span className="text-xs text-amber-400/80 mr-1">
                              Clique para confirmar
                            </span>
                          )}

                          {isActioning ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                          ) : (
                            <>
                              {/* Banned → Unban */}
                              {u.role === "banned" && (
                                <button
                                  onClick={() => requestAction(u.id, "user")}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                                    isPending && pending?.role === "user"
                                      ? "border-emerald-400/40 bg-emerald-400/20 text-emerald-300"
                                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                  )}
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  {isPending && pending?.role === "user"
                                    ? "Confirmar?"
                                    : "Desbanir"}
                                </button>
                              )}

                              {/* User → Promote to admin */}
                              {u.role === "user" && (
                                <button
                                  onClick={() => requestAction(u.id, "admin")}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                                    isPending && pending?.role === "admin"
                                      ? "border-violet-400/40 bg-violet-400/20 text-violet-300"
                                      : "border-violet-500/20 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20"
                                  )}
                                >
                                  <Crown className="w-3.5 h-3.5" />
                                  {isPending && pending?.role === "admin"
                                    ? "Confirmar?"
                                    : "Admin"}
                                </button>
                              )}

                              {/* Admin → Demote */}
                              {u.role === "admin" && (
                                <button
                                  onClick={() => requestAction(u.id, "user")}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                                    isPending && pending?.role === "user"
                                      ? "border-amber-400/40 bg-amber-400/20 text-amber-300"
                                      : "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                  )}
                                >
                                  <UserMinus className="w-3.5 h-3.5" />
                                  {isPending && pending?.role === "user"
                                    ? "Confirmar?"
                                    : "Rebaixar"}
                                </button>
                              )}

                              {/* Ban — visible for non-banned users */}
                              {u.role !== "banned" && (
                                <button
                                  onClick={() => requestAction(u.id, "banned")}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all",
                                    isPending && pending?.role === "banned"
                                      ? "border-red-400/40 bg-red-400/20 text-red-300"
                                      : "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                  )}
                                >
                                  <ShieldBan className="w-3.5 h-3.5" />
                                  {isPending && pending?.role === "banned"
                                    ? "Confirmar?"
                                    : "Banir"}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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
