"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Send, Loader2, AlertCircle, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminUserOption {
  id: string;
  email: string;
}

interface NotificationRow {
  id: string;
  target_type: "all" | "admins" | "user";
  target_user_id: string | null;
  type: "admin" | "system" | "sale";
  title: string;
  body: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const TARGET_LABEL: Record<NotificationRow["target_type"], string> = {
  all: "Todos",
  admins: "Admins",
  user: "Usuário",
};

const TYPE_BADGE: Record<NotificationRow["type"], string> = {
  admin: "bg-[#00E5FF]/10 text-[#00E5FF] border-[#00E5FF]/25",
  system: "bg-white/5 text-white/50 border-white/10",
  sale: "bg-[#00FF41]/10 text-[#00FF41] border-[#00FF41]/25",
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

export default function AdminNotificationsPage() {
  const [users, setUsers] = useState<AdminUserOption[]>([]);
  const [history, setHistory] = useState<NotificationRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [targetType, setTargetType] = useState<"all" | "admins" | "user">("all");
  const [targetUserId, setTargetUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/admin/notifications");
      const data = (await res.json()) as { notifications?: NotificationRow[] };
      setHistory(data.notifications ?? []);
    } catch {
      // silencioso
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data: { users?: AdminUserOption[] }) => setUsers(data.users ?? []))
      .catch(() => {});
  }, []);

  const canSend = useMemo(() => {
    if (!title.trim() || !body.trim()) return false;
    if (targetType === "user" && !targetUserId) return false;
    return true;
  }, [title, body, targetType, targetUserId]);

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_user_id: targetType === "user" ? targetUserId : undefined,
          title: title.trim(),
          body: body.trim(),
          url: url.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao enviar notificação");

      setSuccess(`Enviado para ${data.sent}/${data.targeted} dispositivo(s).`);
      setTitle("");
      setBody("");
      setUrl("");
      loadHistory();
    } catch (err: any) {
      setError(err?.message || "Erro ao enviar notificação");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2.5">
          <Bell size={20} className="text-[#00FF41]" />
          Notificações
        </h1>
        <p className="page-subtitle">Envie um push manual para usuários ou consulte o histórico de disparos.</p>
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-white/40 mb-1.5 block">Destinatário</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as typeof targetType)}
              className="input-glass w-full"
            >
              <option value="all">Todos os usuários</option>
              <option value="admins">Somente admins</option>
              <option value="user">Usuário específico</option>
            </select>
          </div>
          {targetType === "user" && (
            <div className="md:col-span-2">
              <label className="text-xs text-white/40 mb-1.5 block">Usuário</label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="input-glass w-full"
              >
                <option value="">Selecione…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-white/40 mb-1.5 block">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Ex: Manutenção programada"
            className="input-glass w-full"
          />
        </div>

        <div>
          <label className="text-xs text-white/40 mb-1.5 block">Mensagem</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Ex: O sistema ficará indisponível às 22h para manutenção."
            className="input-glass w-full resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-white/40 mb-1.5 block">Link ao clicar (opcional)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/dashboard"
            className="input-glass w-full"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
            <AlertCircle size={14} className="text-red-400 shrink-0" />
            <p className="text-xs text-red-300/80">{error}</p>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00FF41]/[0.06] border border-[#00FF41]/20">
            <CheckCheck size={14} className="text-[#00FF41] shrink-0" />
            <p className="text-xs text-[#00FF41]/90">{success}</p>
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={!canSend || sending}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Disparar
        </button>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-white/65 uppercase tracking-wider">Histórico</h2>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {loadingHistory && (
            <div className="p-6 text-sm text-white/40 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          )}
          {!loadingHistory && history.length === 0 && (
            <div className="p-6 text-sm text-white/40">Nenhuma notificação enviada ainda.</div>
          )}
          {history.map((n) => (
            <div key={n.id} className="px-6 py-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", TYPE_BADGE[n.type])}>
                    {n.type}
                  </span>
                  <span className="text-[10px] text-white/35">{TARGET_LABEL[n.target_type]}</span>
                  <span className="text-[10px] text-white/25">· {timeAgo(n.created_at)}</span>
                </div>
                <p className="text-sm font-medium text-white/85 truncate">{n.title}</p>
                <p className="text-xs text-white/45 truncate">{n.body}</p>
              </div>
              <div className="text-xs text-white/40 shrink-0 text-right">
                <p className="text-[#00FF41]">{n.sent_count} ok</p>
                {n.failed_count > 0 && <p className="text-red-400">{n.failed_count} falha</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
