"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Instagram,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Clock,
  Trash2,
  ChevronDown,
  Users,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AccountRow {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  connected_at: string;
  token_expires_at: string | null;
}

interface UserRow {
  id: string;
  email: string;
  created_at: string;
  accounts: AccountRow[];
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function userInitial(email: string) {
  return email.charAt(0).toUpperCase();
}

export default function AdminAccountsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUsers, setOpenUsers] = useState<Set<string>>(new Set());
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setUsers(data.users);
        if (data.users?.length === 1) {
          setOpenUsers(new Set([data.users[0].id]));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleUser(userId: string) {
    setPendingRevoke(null);
    setOpenUsers((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  const totalAccounts = users.reduce((sum, u) => sum + u.accounts.length, 0);
  const expiredCount = users.flatMap(u => u.accounts).filter(a => {
    const d = daysUntil(a.token_expires_at);
    return d !== null && d < 0;
  }).length;
  const expiringCount = users.flatMap(u => u.accounts).filter(a => {
    const d = daysUntil(a.token_expires_at);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  async function revokeAccount(accountId: string, userId: string) {
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
      setUsers((prev) =>
        prev
          .map((u) =>
            u.id === userId
              ? { ...u, accounts: u.accounts.filter((a) => a.id !== accountId) }
              : u
          )
          .filter((u) => u.accounts.length > 0)
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao revogar conta");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Contas Conectadas</h1>
          <p className="page-subtitle mt-1">
            Perfis Instagram agrupados por usuário
          </p>
        </div>
        {!loading && (
          <div className="flex items-center gap-3 text-sm text-white/30">
            <span>{users.length} usuários</span>
            <span className="w-1 h-1 rounded-full bg-white/20" />
            <span>{totalAccounts} contas</span>
          </div>
        )}
      </div>

      {/* Token health alerts */}
      {!loading && !error && (expiredCount > 0 || expiringCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {expiredCount > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-2.5">
              <TriangleAlert className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-sm text-red-300 font-medium">
                {expiredCount} {expiredCount === 1 ? "conta com token expirado" : "contas com tokens expirados"}
              </span>
            </div>
          )}
          {expiringCount > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-2.5">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300 font-medium">
                {expiringCount} {expiringCount === 1 ? "conta expirando em ≤7 dias" : "contas expirando em ≤7 dias"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-white/40 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-[#00498D]" />
          <span className="text-sm">Carregando contas…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-400">
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

      {/* Accordion list */}
      {!loading && !error && (
        <>
          {users.length === 0 ? (
            <div className="glass-card rounded-2xl flex flex-col items-center justify-center gap-3 py-16 text-white/30">
              <Users className="w-8 h-8" />
              <p className="text-sm">Nenhuma conta conectada na plataforma</p>
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => {
                const isOpen = openUsers.has(user.id);
                const activeCount = user.accounts.filter(
                  (a) => a.is_active && (daysUntil(a.token_expires_at) ?? 1) > 0
                ).length;

                return (
                  <div
                    key={user.id}
                    className="glass-card rounded-2xl overflow-hidden"
                  >
                    {/* User row — clickable header */}
                    <button
                      onClick={() => toggleUser(user.id)}
                      className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-white/[0.03] transition-colors text-left"
                    >
                      {/* Avatar initial */}
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00498D]/25 to-[#85B9E9]/25 border border-white/10 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                        {userInitial(user.email)}
                      </div>

                      {/* Email */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white/90 truncate">
                          {user.email}
                        </p>
                      </div>

                      {/* Account count badge */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                            activeCount > 0
                              ? "bg-[#85B9E9]/10 text-[#85B9E9] border-[#85B9E9]/20"
                              : "bg-white/5 text-white/30 border-white/10"
                          )}
                        >
                          <Instagram className="w-3 h-3" />
                          {user.accounts.length}{" "}
                          {user.accounts.length === 1 ? "conta" : "contas"}
                        </span>

                        {/* Chevron */}
                        <motion.span
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                          className="text-white/30"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </motion.span>
                      </div>
                    </button>

                    {/* Expandable accounts list */}
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                            {user.accounts.length === 0 ? (
                              <p className="px-12 py-4 text-xs text-white/25">
                                Nenhuma conta conectada
                              </p>
                            ) : (
                              user.accounts.map((acc) => {
                                const days = daysUntil(acc.token_expires_at);
                                const tokenOk = days === null || days > 0;
                                const isActive = acc.is_active && tokenOk;
                                const isRevoking = revoking === acc.id;
                                const isPending = pendingRevoke === acc.id;

                                return (
                                  <div
                                    key={acc.id}
                                    className="flex items-center gap-3 px-4 pl-16 py-3"
                                  >
                                    {/* Instagram icon */}
                                    <div className="w-8 h-8 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center flex-shrink-0">
                                      <Instagram className="w-4 h-4 text-pink-400" />
                                    </div>

                                    {/* Username */}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-white/90">
                                        @{acc.username}
                                      </p>
                                      {acc.display_name && (
                                        <p className="text-xs text-white/30 truncate">
                                          {acc.display_name}
                                        </p>
                                      )}
                                    </div>

                                    {/* Token status */}
                                    {days !== null ? (
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 flex-shrink-0",
                                          days < 0
                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                            : days <= 7
                                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                            : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        )}
                                      >
                                        <Clock className="w-3 h-3" />
                                        {days < 0
                                          ? "Expirado"
                                          : `${days}d restantes`}
                                      </span>
                                    ) : (
                                      <span className="text-white/20 text-xs flex-shrink-0">
                                        —
                                      </span>
                                    )}

                                    {/* Active badge */}
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 flex-shrink-0",
                                        isActive
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                          : "bg-red-500/10 text-red-400 border-red-500/20"
                                      )}
                                    >
                                      <ShieldCheck className="w-3 h-3" />
                                      {isActive ? "Ativa" : "Inativa"}
                                    </span>

                                    {/* Revoke button */}
                                    {isRevoking ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-white/30 flex-shrink-0" />
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          revokeAccount(acc.id, user.id);
                                        }}
                                        className={cn(
                                          "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-all flex-shrink-0",
                                          isPending
                                            ? "border-red-400/40 bg-red-400/20 text-red-300"
                                            : "border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                        )}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        {isPending ? "Confirmar?" : "Revogar"}
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
