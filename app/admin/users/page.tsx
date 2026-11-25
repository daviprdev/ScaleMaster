"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
  X,
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
  admin: "bg-info-soft text-link border-primary/25",
  user: "bg-white/5 text-ink-3 border-white/10",
  banned: "bg-danger/20 text-danger border-danger/30",
};

const STATUS_BADGE: Record<AdminUser["account_status"], string> = {
  pending: "bg-warning/20 text-warning border-warning/30",
  approved: "bg-success-soft text-success border-success/20",
  banned: "bg-danger/20 text-danger border-danger/30",
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
      fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
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
  const [accountsModal, setAccountsModal] = useState<AdminUser | null>(null);

  return (
    <div className="space-y-6">
      {/* Modal: contas do usuário */}
      <AnimatePresence>
        {accountsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm"
            onClick={() => setAccountsModal(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className="glass w-full max-w-md rounded-2xl p-6 space-y-4 border border-white/10"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-info-soft border border-primary-2/20 flex items-center justify-center flex-shrink-0">
                    <Instagram size={16} className="text-link" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">Contas Conectadas</h3>
                    <p className="text-xs text-ink-3 truncate">{accountsModal.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setAccountsModal(null)}
                  className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/10 transition-colors flex-shrink-0"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Accounts list */}
              {accountsModal.accounts.length === 0 ? (
                <p className="text-sm text-ink-3 text-center py-6">
                  Nenhuma conta conectada
                </p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                  {accountsModal.accounts.map((acc) => (
                    <div
                      key={acc.username}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl border",
                        acc.is_active
                          ? "bg-info-soft border-primary-2/15"
                          : "bg-white/[0.03] border-white/[0.07]"
                      )}
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0",
                        acc.is_active
                          ? "bg-danger-soft border-danger/20"
                          : "bg-white/5 border-white/10"
                      )}>
                        <Instagram size={13} className={acc.is_active ? "text-danger" : "text-ink-3"} />
                      </div>
                      <span className={cn(
                        "text-sm font-medium flex-1",
                        acc.is_active ? "text-ink" : "text-ink-3"
                      )}>
                        @{acc.username}
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium rounded-full border px-2 py-0.5 flex-shrink-0",
                        acc.is_active
                          ? "text-link border-primary-2/20 bg-info-soft"
                          : "text-ink-3 border-white/10 bg-white/5"
                      )}>
                        {acc.is_active ? "Ativa" : "Inativa"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Footer count */}
              <p className="text-xs text-ink-3 text-right pt-1 border-t border-white/[0.06]">
                {accountsModal.accounts.length} {accountsModal.accounts.length === 1 ? "conta" : "contas"} no total
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Usuários</h1>
          <p className="page-subtitle mt-1">
            Todos os usuários cadastrados na plataforma
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-medium text-warning">
              <Clock className="w-3 h-3" />
              {pendingCount} aguardando aprovação
            </span>
          )}
          {!loading && (
            <span className="text-sm text-ink-3">{users.length} registros</span>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-ink-3 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-link" />
          <span className="text-sm">Carregando usuários…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-danger/60 hover:text-danger"
          >
            ✕
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.04] text-ink-3 text-left">
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Email</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Criado em</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Cargo</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider">Contas Meta</th>
                <th className="px-4 py-3.5 font-medium text-xs uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
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
                        ? "bg-warning-soft hover:bg-warning-soft border-l-2 border-l-warning/40"
                        : "hover:bg-white/[0.04]"
                    )}
                  >
                    {/* Email */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink font-medium">{u.email}</span>
                        {isPendingApproval && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft border border-warning/20 px-1.5 py-0.5 text-[10px] text-warning font-medium">
                            <Clock className="w-2.5 h-2.5" />
                            Novo
                          </span>
                        )}
                        {isPendingApproval && u.pending_message && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-info-soft border border-primary/20 px-1.5 py-0.5 text-[10px] text-link font-medium">
                            <MessageSquare className="w-2.5 h-2.5" />
                            mensagem
                          </span>
                        )}
                      </div>
                      {isPendingApproval && u.pending_message && (
                        <div className="mt-1.5 flex items-start gap-1.5 max-w-xs">
                          <MessageSquare className="w-3 h-3 text-link/60 shrink-0 mt-0.5" />
                          <p className="text-[11px] text-ink-3 leading-relaxed italic">
                            &ldquo;{u.pending_message}&rdquo;
                          </p>
                        </div>
                      )}
                    </td>

                    {/* Created at */}
                    <td className="px-4 py-3 text-ink-3 text-xs">
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
                        <span className="text-ink-3 text-xs">0 contas</span>
                      ) : (
                        <button
                          onClick={() => setAccountsModal(u)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-primary-2/20 bg-info-soft px-3 py-1.5 text-xs font-medium text-link hover:bg-info-soft transition-all"
                        >
                          <Instagram className="w-3 h-3" />
                          Ver {u.accounts.length} {u.accounts.length === 1 ? "conta" : "contas"}
                        </button>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="text-ink-3 text-xs text-right block">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {(isPending || isRejectPending || isRevokeAccessPending) && (
                            <span className="text-xs text-warning/80 mr-1">
                              Confirmar?
                            </span>
                          )}

                          {isActioning ? (
                            <Loader2 className="w-4 h-4 animate-spin text-link/60" />
                          ) : (
                            <>
                              {/* Approve / Reject buttons — only for pending users */}
                              {isPendingApproval && (
                                <>
                                  <button
                                    onClick={() => approveUser(u.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-success/30 bg-success-soft px-3 py-1.5 text-xs text-success hover:bg-success/25 transition-all font-medium"
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
                                      "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all font-medium",
                                      isRejectPending
                                        ? "border-danger/40 bg-danger/20 text-danger"
                                        : "border-danger/30 bg-danger-soft text-danger hover:bg-danger/25"
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
                                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all",
                                        isPending && pending?.role === "user"
                                          ? "border-success/40 bg-success/20 text-success"
                                          : "border-success/20 bg-success-soft text-success hover:bg-success/20"
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
                                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all",
                                        isPending && pending?.role === "admin"
                                          ? "border-primary/30 bg-info-soft text-link"
                                          : "border-primary/15 bg-info-soft text-link/80 hover:bg-info-soft"
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
                                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all",
                                        isPending && pending?.role === "user"
                                          ? "border-warning/40 bg-warning/20 text-warning"
                                          : "border-warning/20 bg-warning-soft text-warning hover:bg-warning/20"
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
                                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all",
                                        isPending && pending?.role === "banned"
                                          ? "border-danger/40 bg-danger/20 text-danger"
                                          : "border-danger/20 bg-danger-soft text-danger hover:bg-danger/20"
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
                                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-all font-medium",
                                        isRevokeAccessPending
                                          ? "border-warning/40 bg-warning/20 text-warning"
                                          : "border-warning/20 bg-warning-soft text-warning hover:bg-warning/20"
                                      )}
                                    >
                                      <PauseCircle className="w-3.5 h-3.5" />
                                      {isRevokeAccessPending ? "Confirmar?" : "Pausar Acesso"}
                                    </button>
                                  )}

                                  {/* Impersonate */}
                                  <button
                                    onClick={() => impersonateUser(u.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-ink-3 hover:bg-white/[0.08] hover:text-ink transition-all"
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
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-3">
              <Users className="w-8 h-8" />
              <p className="text-sm">Nenhum usuário encontrado</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
