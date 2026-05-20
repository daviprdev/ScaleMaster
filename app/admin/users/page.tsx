"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Loader2,
  AlertCircle,
  ShieldBan,
  ShieldCheck,
  Instagram,
  Crown,
  UserMinus,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  PauseCircle,
  MessageSquare,
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
  account_status: "pending" | "approved" | "banned";
  pending_message: string | null;
  accounts: Account[];
}

const ROLE_BADGE: Record<AdminUser["role"], string> = {
  admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  user: "bg-white/5 text-white/50 border-white/10",
  banned: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_BADGE: Record<AdminUser["account_status"], string> = {
  pending: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  banned: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<AdminUser["account_status"], string> = {
  pending: "Pendente",
  approved: "Aprovado",
  banned: "Banido",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type PendingAction = { userId: string; role: AdminUser["role"] };
type PendingReject = { userId: string };

export default function AdminUsersPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingReject, setPendingReject] = useState<PendingReject | null>(null);
  const [pendingRevokeAccess, setPendingRevokeAccess] = useState<{ userId: string } | null>(null);
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
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar cargo");
    } finally {
      setActioning(null);
    }
  }

  async function approveUser(userId: string) {
    setActioning(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_status: "approved" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, account_status: "approved" } : u
        )
      );
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao aprovar usuário");
    } finally {
      setActioning(null);
    }
  }

  async function rejectUser(userId: string) {
    setActioning(userId);
    setPendingReject(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_status: "banned" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, account_status: "banned" } : u
        )
      );
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao reprovar usuário");
    } finally {
      setActioning(null);
    }
  }

  async function revokeAccess(userId: string) {
    setActioning(userId);
    setPendingRevokeAccess(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_status: "pending" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, account_status: "pending" } : u
        )
      );
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao pausar acesso");
    } finally {
      setActioning(null);
    }
  }

  async function impersonateUser(userId: string) {
    setActioning(userId);
    try {
      const res = await fetch(`/api/admin/impersonate/${userId}`, { method: "POST" });
      const data = await res.json() as { redirectTo?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao gerar acesso");
      window.location.href = data.redirectTo ?? "/dashboard";
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao impersonar usuário");
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

  const pendingCount = users.filter((u) => u.account_status === "pending").length;

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
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Clock className="w-3 h-3" />
              {pendingCount} aguardando aprovação
            </span>
          )}
          {!loading && (
            <span className="text-sm text-white/30">{users.length} registros</span>
          )}
        </div>
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
                <th className="px-4 py-3 font-medium">Status</th>
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
                const isRejectPending = pendingReject?.userId === u.id;
                const isRevokeAccessPending = pendingRevokeAccess?.userId === u.id;
                const isPendingApproval = u.account_status === "pending";

                return (
                  <tr
                    key={u.id}
                    className={cn(
                      "transition-colors",
                      isPendingApproval
                        ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.07] border-l-2 border-l-amber-500/40"
                        : "hover:bg-white/[0.02]"
                    )}
                  >
                    {/* Email */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">{u.email}</span>
                        {isPendingApproval && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium">
                            <Clock className="w-2.5 h-2.5" />
                            Novo
                          </span>
                        )}
                        {isPendingApproval && u.pending_message && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300 font-medium">
                            <MessageSquare className="w-2.5 h-2.5" />
                            mensagem
                          </span>
                        )}
                      </div>
                      {isPendingApproval && u.pending_message && (
                        <div className="mt-1.5 flex items-start gap-1.5 max-w-xs">
                          <MessageSquare className="w-3 h-3 text-blue-400/60 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-white/45 leading-relaxed italic">
                            &ldquo;{u.pending_message}&rdquo;
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Created at */}
                    <td className="px-4 py-3 text-white/40">
                      {formatDate(u.created_at)}
                    </td>

                    {/* Account status badge */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                          STATUS_BADGE[u.account_status]
                        )}
                      >
                        {STATUS_LABEL[u.account_status]}
                      </span>
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
                        <span className="text-white/20 text-xs text-right block">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {(isPending || isRejectPending || isRevokeAccessPending) && (
                            <span className="text-xs text-amber-400/80 mr-1">
                              Confirmar?
                            </span>
                          )}

                          {isActioning ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                          ) : (
                            <>
                              {/* Approve / Reject buttons — only for pending users */}
                              {isPendingApproval && (
                                <>
                                  <button
                                    onClick={() => approveUser(u.id)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 transition-all font-medium"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Aprovar
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (isRejectPending) {
                                        rejectUser(u.id);
                                      } else {
                                        setPendingReject({ userId: u.id });
                                        setPending(null);
                                      }
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all font-medium",
                                      isRejectPending
                                        ? "border-red-400/40 bg-red-400/20 text-red-300"
                                        : "border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                                    )}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    {isRejectPending ? "Confirmar?" : "Reprovar"}
                                  </button>
                                </>
                              )}

                              {/* Role actions — only for approved users */}
                              {!isPendingApproval && (
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
                                      {isPending && pending?.role === "user" ? "Confirmar?" : "Desbanir"}
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
                                      {isPending && pending?.role === "admin" ? "Confirmar?" : "Admin"}
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
                                      {isPending && pending?.role === "user" ? "Confirmar?" : "Rebaixar"}
                                    </button>
                                  )}

                                  {/* Ban */}
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
                                      {isPending && pending?.role === "banned" ? "Confirmar?" : "Banir"}
                                    </button>
                                  )}

                                  {/* Pause access — revert approved user to pending */}
                                  {u.account_status === "approved" && (
                                    <button
                                      onClick={() => {
                                        if (isRevokeAccessPending) {
                                          revokeAccess(u.id);
                                        } else {
                                          setPendingRevokeAccess({ userId: u.id });
                                          setPending(null);
                                          setPendingReject(null);
                                        }
                                      }}
                                      className={cn(
                                        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-all font-medium",
                                        isRevokeAccessPending
                                          ? "border-amber-400/40 bg-amber-400/20 text-amber-300"
                                          : "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                      )}
                                    >
                                      <PauseCircle className="w-3.5 h-3.5" />
                                      {isRevokeAccessPending ? "Confirmar?" : "Pausar Acesso"}
                                    </button>
                                  )}

                                  {/* Impersonate */}
                                  <button
                                    onClick={() => impersonateUser(u.id)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-all"
                                    title="Acessar como este usuário"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    Acessar como
                                  </button>
                                </>
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
