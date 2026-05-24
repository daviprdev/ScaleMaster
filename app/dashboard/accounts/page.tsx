"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Instagram,
  Plus,
  Trash2,
  Power,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  RefreshCw,
  Users,
  FileText,
  Clock,
  CheckCircle2,
  X,
  KeyRound,
  AlertTriangle,
  Clapperboard,
  ChevronRight,
  WifiOff,
  LinkIcon,
  Folder,
  FolderPlus,
  FolderOpen,
  Pencil,
  Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface UserMetaApp {
  id: string;
  app_name: string;
  ig_app_id: string;
}

interface AccountFolder {
  id: string;
  name: string;
  account_count: number;
  created_at: string;
}

interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  connected_at: string;
  followers_count: number | null;
  posts_count: number | null;
  last_post_at: string | null;
  has_active_stories: boolean | null;
  profile_refreshed_at: string | null;
  ig_business_account_id: string | null;
  token_expires_at: string | null;
  health_status: "online" | "error" | "blocked";
  folder_id: string | null;
}

interface AccountStoriesData {
  count: number;
  expiring_first_at: string | null;
}

function storyCountdown(timestamp: string | null): string {
  if (!timestamp) return "";
  const expiresAt = new Date(timestamp).getTime() + 24 * 60 * 60 * 1000;
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "expirando";
  const totalMins = Math.floor(diff / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function daysUntilExpiry(tokenExpiresAt: string | null): number | null {
  if (!tokenExpiresAt) return null;
  return Math.floor((new Date(tokenExpiresAt).getTime() - Date.now()) / 86_400_000);
}

function tokenStatusChip(tokenExpiresAt: string | null, isMetaAccount: boolean) {
  if (!isMetaAccount || !tokenExpiresAt) return null;
  const days = daysUntilExpiry(tokenExpiresAt);
  if (days === null) return null;
  if (days < 0) return { label: "Token expirado", color: "bg-red-500/15 text-red-400", icon: "danger" } as const;
  if (days <= 7) return { label: `Expira em ${days}d`, color: "bg-red-500/15 text-red-400", icon: "danger" } as const;
  if (days <= 15) return { label: `Expira em ${days}d`, color: "bg-amber-500/15 text-amber-400", icon: "warning" } as const;
  return null;
}

const AVATAR_COLORS = [
  "from-violet-500 to-purple-600",
  "from-pink-500 to-rose-600",
  "from-cyan-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
];

function avatarColor(username: string) {
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d atrás`;
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Conexão cancelada. Nenhuma conta foi adicionada.",
  state_mismatch: "Erro de segurança (state inválido). Tente novamente.",
  no_code: "Código de autorização ausente. Tente novamente.",
  server_error: "Erro retornado pela Meta API:",
  personal_account: "Conta pessoal detectada. Converta para Comercial ou Criador: Instagram → Configurações → Conta → Mudar para conta profissional.",
  rate_limit: "Limite de requisições da Meta API atingido. Aguarde alguns minutos antes de conectar a próxima conta.",
};


// ── Chip de métrica ───────────────────────────────────────────
function Metric({
  icon,
  label,
  muted = false,
  blue = false,
  amber = false,
  red = false,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
  blue?: boolean;
  amber?: boolean;
  red?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-1 whitespace-nowrap text-[11px] flex-shrink-0",
      red ? "text-red-400" : amber ? "text-amber-400" : blue ? "text-blue-400" : muted ? "text-white/20" : "text-white/45"
    )}>
      <span className={cn(
        "flex-shrink-0",
        red ? "text-red-400/70" : amber ? "text-amber-400/70" : blue ? "text-blue-400" : muted ? "text-white/15" : "text-white/30"
      )}>
        {icon}
      </span>
      {label}
    </div>
  );
}

// ── Card de conta ─────────────────────────────────────────────
function AccountCard({
  account,
  storiesData,
  folders,
  onRefresh,
  onToggle,
  onDelete,
  onRefreshToken,
  onMove,
  refreshing,
  toggling,
  deleting,
  tokenRefreshing,
  moving,
}: {
  account: Account;
  storiesData?: AccountStoriesData;
  folders: AccountFolder[];
  onRefresh: (id: string) => void;
  onToggle: (acc: Account) => void;
  onDelete: (id: string) => void;
  onRefreshToken: (id: string) => void;
  onMove: (accountId: string, folderId: string | null) => void;
  refreshing: boolean;
  toggling: boolean;
  deleting: boolean;
  tokenRefreshing: boolean;
  moving: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const proxyImg = (url: string) => `/api/proxy-image?url=${encodeURIComponent(url)}`;
  const busy = refreshing || toggling || deleting || tokenRefreshing || moving;
  const isMetaConnected = !!account.ig_business_account_id;
  const tokenChip = tokenStatusChip(account.token_expires_at, isMetaConnected);
  const accountFell = account.health_status === "error" || account.health_status === "blocked";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn("glass-card rounded-2xl", accountFell && "border border-red-500/25")}
    >
      {/* Cabeçalho */}
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="relative flex-shrink-0">
          {account.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxyImg(account.avatar_url)}
              alt={account.username}
              className={cn(
                "w-12 h-12 rounded-full object-cover ring-2",
                accountFell ? "ring-red-500/40 opacity-60 grayscale" : "ring-white/10"
              )}
            />
          ) : (
            <div className={cn(
              "w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center ring-2",
              accountFell
                ? "from-red-900 to-red-800 ring-red-500/30"
                : cn("ring-white/10", avatarColor(account.username))
            )}>
              <Instagram size={20} className={accountFell ? "text-red-400/60" : "text-white"} />
            </div>
          )}
          {accountFell && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center ring-2 ring-black">
              <WifiOff size={8} className="text-white" />
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className={cn("text-sm font-bold truncate", accountFell ? "text-white/50" : "text-white/90")}>
            @{account.username}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Instagram size={9} className={accountFell ? "text-red-400/40 flex-shrink-0" : "text-pink-400 flex-shrink-0"} />
            <span className="text-[10px] text-white/30">Instagram</span>
            {isMetaConnected && !accountFell && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-300 flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-blue-400" />
                META API
              </span>
            )}
            {tokenChip && !accountFell && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
                tokenChip.color
              )}>
                {tokenChip.icon === "danger"
                  ? <AlertTriangle size={8} className="flex-shrink-0" />
                  : <AlertCircle size={8} className="flex-shrink-0" />
                }
                {tokenChip.label}
              </span>
            )}
            {accountFell ? (
              <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-red-500/20 text-red-400 border border-red-500/30 flex-shrink-0 animate-pulse">
                <WifiOff size={8} className="flex-shrink-0" />
                {account.health_status === "blocked" ? "BLOQUEADA" : "DESCONECTADA"}
              </span>
            ) : (
              <span className={cn(
                "inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0",
                account.is_active
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-white/[0.05] text-white/20"
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", account.is_active ? "bg-emerald-400" : "bg-white/20")} />
                {account.is_active ? "ATIVA" : "INATIVA"}
              </span>
            )}
          </div>
        </div>

        {/* Menu três pontos */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => !busy && setMenuOpen(o => !o)}
            disabled={busy}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
          >
            {(refreshing || deleting || tokenRefreshing || moving)
              ? <Loader2 size={13} className="animate-spin text-cyan-400" />
              : <MoreHorizontal size={15} />
            }
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                key="menu"
                initial={{ opacity: 0, scale: 0.9, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -6 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1.5 z-30 min-w-[172px] bg-[#111318] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
              >
                <button
                  onClick={() => { onRefresh(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <RefreshCw size={12} className="text-cyan-400" /> Atualizar Dados
                </button>
                <button
                  onClick={() => { onToggle(account); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Power size={12} className={account.is_active ? "text-amber-400" : "text-emerald-400"} />
                  {account.is_active ? "Desativar conta" : "Ativar conta"}
                </button>
                {isMetaConnected && (
                  <button
                    onClick={() => { onRefreshToken(account.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                  >
                    <KeyRound size={12} className="text-violet-400" /> Renovar Token
                  </button>
                )}

                {/* Mover para pasta — abre modal */}
                <button
                  onClick={() => { setPendingFolderId(account.folder_id); setMoveModalOpen(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                >
                  <Folder size={12} className="text-violet-400/80" /> Mover para pasta...
                </button>

                <div className="h-px bg-white/[0.06]" />
                <button
                  onClick={() => { onDelete(account.id); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} /> Remover Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className={cn("h-px mx-5", accountFell ? "bg-red-500/15" : "bg-white/[0.05]")} />

      {accountFell ? (
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/[0.08] border border-red-500/20">
            <WifiOff size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-red-400 uppercase tracking-wide">
                {account.health_status === "blocked"
                  ? "Conta bloqueada pela Meta"
                  : "Token inválido — sessão encerrada"}
              </p>
              <p className="text-[11px] text-red-400/60 mt-0.5 leading-relaxed">
                {account.health_status === "blocked"
                  ? "Sua conta foi bloqueada pela Meta. Acesse o Instagram e siga as instruções de recuperação."
                  : "A sessão desta conta expirou ou a senha foi alterada. Reconecte para voltar a publicar."}
              </p>
            </div>
          </div>
          <button
            onClick={() => { onRefreshToken(account.id); }}
            disabled={tokenRefreshing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold uppercase tracking-wide hover:bg-red-500/25 hover:border-red-500/50 transition-all disabled:opacity-50"
          >
            {tokenRefreshing
              ? <><Loader2 size={12} className="animate-spin" /> Reconectando...</>
              : <><LinkIcon size={12} /> Reconectar Instagram</>
            }
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-3">
          <Metric icon={<Users size={11} />} label={`${formatNumber(account.followers_count)} seg.`} muted={account.followers_count == null} />
          <Metric icon={<FileText size={11} />} label={`${account.posts_count ?? "—"} posts`} muted={account.posts_count == null} />
          <Metric icon={<Clock size={11} />} label={account.last_post_at ? timeAgo(account.last_post_at) : "—"} muted={!account.last_post_at} />
          <Metric
            icon={<span className={cn(
              "w-1.5 h-1.5 rounded-full inline-block flex-shrink-0",
              account.profile_refreshed_at ? "bg-emerald-400" : "bg-white/20"
            )} />}
            label={account.profile_refreshed_at ? `sync ${timeAgo(account.profile_refreshed_at)}` : "não sincronizado"}
            muted={!account.profile_refreshed_at}
          />
          {isMetaConnected && storiesData !== undefined && (
            <Metric
              icon={<Clapperboard size={11} />}
              label={
                storiesData.count > 0
                  ? `${storiesData.count} ${storiesData.count === 1 ? "story" : "stories"} · exp. ${storyCountdown(storiesData.expiring_first_at)}`
                  : "0 stories ativos"
              }
              amber={storiesData.count > 0}
              muted={storiesData.count === 0}
            />
          )}
        </div>
      )}

      {/* ── Modal: Mover para pasta ── */}
      <AnimatePresence>
        {moveModalOpen && (
          <>
            <motion.div
              key="move-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setMoveModalOpen(false)}
            />
            <motion.div
              key="move-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <Folder size={13} className="text-violet-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Mover para pasta</h3>
                      <p className="text-[11px] text-white/30">@{account.username}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setMoveModalOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Folder options */}
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {/* Sem pasta */}
                  <button
                    onClick={() => setPendingFolderId(null)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                      pendingFolderId === null
                        ? "bg-white/[0.07] border-white/20 text-white"
                        : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                    )}
                  >
                    <FolderOpen size={12} className="text-white/30 flex-shrink-0" />
                    <span className="flex-1">Sem pasta</span>
                    {account.folder_id === null && pendingFolderId !== null && (
                      <span className="text-[9px] text-white/25 flex-shrink-0">atual</span>
                    )}
                    {pendingFolderId === null && (
                      <CheckCircle2 size={12} className="text-[#00FF41] flex-shrink-0" />
                    )}
                  </button>

                  {folders.length === 0 ? (
                    <p className="text-[11px] text-white/25 text-center py-3">
                      Nenhuma pasta criada. Crie pastas nas abas acima.
                    </p>
                  ) : (
                    folders.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setPendingFolderId(f.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs transition-all text-left",
                          pendingFolderId === f.id
                            ? "bg-violet-600/15 border-violet-500/30 text-violet-200"
                            : "border-white/[0.05] text-white/45 hover:bg-white/[0.04] hover:text-white/70"
                        )}
                      >
                        <Folder size={12} className={cn(
                          "flex-shrink-0",
                          pendingFolderId === f.id ? "text-violet-400" : "text-violet-400/50"
                        )} />
                        <span className="flex-1 truncate">{f.name}</span>
                        {account.folder_id === f.id && pendingFolderId !== f.id && (
                          <span className="text-[9px] text-white/25 flex-shrink-0">atual</span>
                        )}
                        {pendingFolderId === f.id && (
                          <CheckCircle2 size={12} className="text-violet-400 flex-shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setMoveModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      onMove(account.id, pendingFolderId);
                      setMoveModalOpen(false);
                    }}
                    disabled={moving || pendingFolderId === account.folder_id}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600/25 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-600/35 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                  >
                    {moving
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Folder size={12} />
                    }
                    Mover
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AccountSkeleton() {
  return (
    <div className="glass-card rounded-2xl animate-pulse">
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="w-12 h-12 rounded-full bg-white/[0.07] flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3.5 bg-white/[0.07] rounded-full w-28" />
          <div className="h-2.5 bg-white/[0.04] rounded-full w-36" />
        </div>
        <div className="w-7 h-7 rounded-lg bg-white/[0.04]" />
      </div>
      <div className="h-px bg-white/[0.05] mx-5" />
      <div className="flex items-center gap-3 px-5 py-3">
        {[52, 40, 48, 56].map((w, i) => (
          <div key={i} style={{ width: w }} className="h-2.5 bg-white/[0.05] rounded-full flex-shrink-0" />
        ))}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [userApps, setUserApps] = useState<UserMetaApp[]>([]);
  const [appPickerOpen, setAppPickerOpen] = useState(false);

  // Folder state
  const [folders, setFolders] = useState<AccountFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);

  // New folder modal
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Rename modal
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(false);

  // Delete folder dialog
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string; count: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [tokenRefreshingId, setTokenRefreshingId] = useState<string | null>(null);
  const [movingAccountId, setMovingAccountId] = useState<string | null>(null);
  const [storiesMap, setStoriesMap] = useState<Record<string, AccountStoriesData>>({});

  const supabase = useMemo(() => createClient(), []);
  const _togglingRef = useRef<string | null>(null);
  const _deletingRef = useRef<string | null>(null);
  const _refreshingRef = useRef<string | null>(null);
  const _tokenRefreshingRef = useRef<string | null>(null);
  const _autoRefreshDone = useRef(false);
  const _autoSyncDone = useRef(false);

  // Close folder menu on outside click
  useEffect(() => {
    if (!openFolderMenuId) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-folder-menu]")) setOpenFolderMenuId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openFolderMenuId]);

  const fetchUserApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (!res.ok) return;
      const data = await res.json() as { apps?: UserMetaApp[] };
      setUserApps(data.apps ?? []);
    } catch {
      // non-critical
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/folders");
      if (!res.ok) return;
      const data = await res.json() as { folders?: AccountFolder[] };
      setFolders(data.folders ?? []);
    } catch { /* silent */ }
  }, []);

  const handleConnectClick = useCallback(async () => {
    await fetchUserApps();
    setAppPickerOpen(true);
  }, [fetchUserApps]);

  // Lê parâmetros de retorno do OAuth (?connected=1 ou ?error=xxx)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      setNotification({
        type: "success",
        message: `${connected} conta${Number(connected) !== 1 ? "s" : ""} conectada${Number(connected) !== 1 ? "s" : ""} com sucesso!`,
      });
      window.history.replaceState({}, "", "/dashboard/accounts");
    } else if (error) {
      const detail = params.get("detail");
      const base = OAUTH_ERROR_MESSAGES[error] ?? "Ocorreu um erro ao conectar. Tente novamente.";
      setNotification({
        type: "error",
        message: detail ? `${base}\n${detail}` : base,
      });
      window.history.replaceState({}, "", "/dashboard/accounts");
    }
  }, []);

  const fetchAccounts = useCallback(async (): Promise<Account[]> => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("instagram_accounts")
        .select(
          "id, username, display_name, avatar_url, is_active, connected_at, followers_count, posts_count, last_post_at, has_active_stories, profile_refreshed_at, ig_business_account_id, token_expires_at, health_status, folder_id"
        )
        .order("connected_at", { ascending: false });
      const fetched = (data ?? []) as unknown as Account[];
      setAccounts(fetched);
      return fetched;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchStories = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/stories");
      if (!res.ok) return;
      const data = await res.json() as { stories?: Record<string, AccountStoriesData> };
      if (data.stories) setStoriesMap(data.stories);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchUserApps();
    fetchFolders();
    fetchAccounts().then(async (fetched) => {
      fetchStories();

      if (_autoRefreshDone.current) return;
      _autoRefreshDone.current = true;

      const expiring = fetched.filter(
        (a) => a.ig_business_account_id && (daysUntilExpiry(a.token_expires_at) ?? 99) <= 7
      );
      if (expiring.length === 0) return;

      const results = await Promise.allSettled(
        expiring.map((acc) =>
          fetch("/api/meta/refresh-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acc.id }),
          }).then((r) => r.json() as Promise<{ ok?: boolean; expires_at?: string }>)
        )
      );

      const renewed = results.filter(
        (r) => r.status === "fulfilled" && r.value.ok
      ).length;

      if (renewed > 0) {
        setNotification({
          type: "success",
          message: `${renewed} token${renewed !== 1 ? "s" : ""} Meta renovado${renewed !== 1 ? "s" : ""} automaticamente.`,
        });
        fetchAccounts();
      }
    });
  }, [fetchAccounts, fetchStories, fetchUserApps, fetchFolders]);

  useEffect(() => {
    if (_autoSyncDone.current) return;
    _autoSyncDone.current = true;
    fetch("/api/accounts/sync-all", { method: "POST" })
      .then((r) => r.json())
      .then((data: { synced?: number; errors?: number; token_errors?: number }) => {
        if ((data.synced ?? 0) > 0 || (data.token_errors ?? 0) > 0) {
          fetchAccounts();
          fetchStories();
        }
      })
      .catch(() => {/* silent */});
  }, [fetchAccounts, fetchStories]);

  const handleRefresh = useCallback(async (id: string) => {
    if (_refreshingRef.current) return;
    _refreshingRef.current = id;
    setRefreshingId(id);
    try {
      const res = await fetch("/api/accounts/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: id }),
      });
      if (res.ok) {
        await Promise.all([fetchAccounts(), fetchStories()]);
      }
    } finally {
      _refreshingRef.current = null;
      setRefreshingId(null);
    }
  }, [fetchAccounts, fetchStories]);

  const handleRefreshToken = useCallback(async (id: string) => {
    if (_tokenRefreshingRef.current) return;
    _tokenRefreshingRef.current = id;
    setTokenRefreshingId(id);
    try {
      const res = await fetch("/api/meta/refresh-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: id }),
      });
      const data = (await res.json()) as { ok?: boolean; expires_at?: string; error?: string };
      if (data.ok && data.expires_at) {
        setNotification({ type: "success", message: "Token Meta renovado com sucesso!" });
        setAccounts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, token_expires_at: data.expires_at! } : a))
        );
      } else {
        setNotification({ type: "error", message: data.error ?? "Falha ao renovar token." });
      }
    } finally {
      _tokenRefreshingRef.current = null;
      setTokenRefreshingId(null);
    }
  }, []);

  const handleToggle = async (account: Account) => {
    if (_togglingRef.current) return;
    _togglingRef.current = account.id;
    setTogglingId(account.id);
    try {
      await supabase.from("instagram_accounts").update({ is_active: !account.is_active }).eq("id", account.id);
      setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, is_active: !a.is_active } : a));
    } finally {
      _togglingRef.current = null;
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (_deletingRef.current) return;
    _deletingRef.current = id;
    setDeletingId(id);
    try {
      await supabase.from("instagram_accounts").delete().eq("id", id);
      setAccounts(prev => prev.filter(a => a.id !== id));
      // Update folder counts
      setFolders(prev => prev.map(f => {
        const account = accounts.find(a => a.id === id);
        if (account?.folder_id === f.id) return { ...f, account_count: Math.max(0, f.account_count - 1) };
        return f;
      }));
    } finally {
      _deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const handleMoveAccount = useCallback(async (accountId: string, folderId: string | null) => {
    setMovingAccountId(accountId);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });

      if (res.ok) {
        setAccounts(prev => {
          const movedAcc = prev.find(a => a.id === accountId);
          setFolders(folders => folders.map(f => {
            if (f.id === movedAcc?.folder_id) return { ...f, account_count: Math.max(0, f.account_count - 1) };
            if (f.id === folderId) return { ...f, account_count: f.account_count + 1 };
            return f;
          }));
          return prev.map(a => a.id === accountId ? { ...a, folder_id: folderId } : a);
        });
      }
    } finally {
      setMovingAccountId(null);
    }
  }, []);

  // ── Folder CRUD ────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/accounts/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      const data = await res.json() as { folder?: AccountFolder; error?: string };
      if (data.folder) {
        setFolders(prev => [...prev, data.folder!]);
        setNewFolderName("");
        setShowNewFolderModal(false);
        setActiveFolderId(data.folder.id);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao criar pasta." });
      }
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameModal || !renameName.trim()) return;
    setRenamingFolder(true);
    try {
      const res = await fetch(`/api/accounts/folders/${renameModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setFolders(prev => prev.map(f => f.id === renameModal.id ? { ...f, name: renameName.trim() } : f));
        setRenameModal(null);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao renomear pasta." });
      }
    } finally {
      setRenamingFolder(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteDialog) return;
    setDeletingFolder(true);
    try {
      const res = await fetch(`/api/accounts/folders/${deleteDialog.id}`, { method: "DELETE" });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setFolders(prev => prev.filter(f => f.id !== deleteDialog.id));
        if (activeFolderId === deleteDialog.id) setActiveFolderId(null);
        // Unlink accounts from deleted folder in local state
        setAccounts(prev => prev.map(a =>
          a.folder_id === deleteDialog.id ? { ...a, folder_id: null } : a
        ));
        setDeleteDialog(null);
      } else {
        setNotification({ type: "error", message: data.error ?? "Erro ao excluir pasta." });
      }
    } finally {
      setDeletingFolder(false);
    }
  };

  const filteredAccounts = useMemo(() => {
    if (activeFolderId === null) return accounts;
    return accounts.filter(a => a.folder_id === activeFolderId);
  }, [accounts, activeFolderId]);

  const active = accounts.filter(a => a.is_active).length;

  return (
    <div className="space-y-6">

      {/* App picker modal */}
      <AnimatePresence>
        {appPickerOpen && (
          <>
            <motion.div
              key="app-picker-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setAppPickerOpen(false)}
            />
            <motion.div
              key="app-picker-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-sm p-6 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <KeyRound size={13} className="text-violet-400" />
                    </div>
                    <h3 className="text-base font-bold text-white">Conectar Conta</h3>
                  </div>
                  <button
                    onClick={() => setAppPickerOpen(false)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                {userApps.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-4 space-y-1.5 text-center">
                      <p className="text-sm font-semibold text-amber-300">Nenhum App cadastrado</p>
                      <p className="text-xs text-white/35 leading-relaxed">
                        Você precisa cadastrar um App da Meta antes de adicionar uma conta.
                      </p>
                    </div>
                    <button
                      onClick={() => { setAppPickerOpen(false); router.push("/dashboard/apps"); }}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm font-semibold px-4 py-3 hover:bg-blue-600/30 hover:border-blue-500/50 transition-all"
                    >
                      <KeyRound size={14} />
                      Configurar Meu Primeiro App
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3"
                  >
                    <p className="text-xs text-white/35">
                      Escolha qual App Meta usar para autorizar a conta no Instagram:
                    </p>
                    <div className="space-y-2">
                      {userApps.map(app => (
                        <button
                          key={app.id}
                          onClick={() => {
                            setAppPickerOpen(false);
                            window.location.href = `/api/instagram/auth?appId=${app.id}`;
                          }}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.07] hover:bg-violet-600/10 hover:border-violet-500/25 transition-all text-left group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                              <KeyRound size={13} className="text-violet-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white/80 truncate group-hover:text-white transition-colors">
                                {app.app_name}
                              </p>
                              <p className="text-[10px] text-white/25 font-mono truncate">
                                ID: {app.ig_app_id}
                              </p>
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-white/20 flex-shrink-0 group-hover:text-violet-400 transition-colors" />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => { setAppPickerOpen(false); router.push("/dashboard/apps"); }}
                      className="w-full text-center text-xs text-white/25 hover:text-violet-400 transition-colors py-1"
                    >
                      + Cadastrar novo app
                    </button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Nova pasta modal */}
      <AnimatePresence>
        {showNewFolderModal && (
          <>
            <motion.div
              key="new-folder-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
            />
            <motion.div
              key="new-folder-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                      <FolderPlus size={13} className="text-violet-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Nova Pasta</h3>
                  </div>
                  <button
                    onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); }}
                  placeholder="Ex: Cliente A, Marca XYZ..."
                  maxLength={50}
                  className="input-glass w-full text-sm px-3 py-2.5"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowNewFolderModal(false); setNewFolderName(""); }}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-violet-600/25 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-600/35 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {creatingFolder ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
                    Criar
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Rename pasta modal */}
      <AnimatePresence>
        {renameModal && (
          <>
            <motion.div
              key="rename-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setRenameModal(null)}
            />
            <motion.div
              key="rename-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl neon-border w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                      <Pencil size={13} className="text-amber-400" />
                    </div>
                    <h3 className="text-sm font-bold text-white">Renomear Pasta</h3>
                  </div>
                  <button
                    onClick={() => setRenameModal(null)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <input
                  autoFocus
                  value={renameName}
                  onChange={e => setRenameName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(); }}
                  maxLength={50}
                  className="input-glass w-full text-sm px-3 py-2.5"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setRenameModal(null)}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRenameFolder}
                    disabled={!renameName.trim() || renamingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-amber-600/20 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-600/30 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {renamingFolder ? <Loader2 size={12} className="animate-spin" /> : <Pencil size={12} />}
                    Salvar
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete folder dialog */}
      <AnimatePresence>
        {deleteDialog && (
          <>
            <motion.div
              key="delete-folder-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => !deletingFolder && setDeleteDialog(null)}
            />
            <motion.div
              key="delete-folder-modal"
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-6 pointer-events-none"
            >
              <div className="glass rounded-2xl border border-red-500/20 w-full max-w-xs p-5 space-y-4 pointer-events-auto">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Trash2 size={15} className="text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Excluir &quot;{deleteDialog.name}&quot;?</h3>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      {deleteDialog.count > 0
                        ? `${deleteDialog.count} conta${deleteDialog.count !== 1 ? "s" : ""} ficará${deleteDialog.count !== 1 ? "ão" : ""} sem pasta e continuará${deleteDialog.count !== 1 ? "ão" : ""} ativa${deleteDialog.count !== 1 ? "s" : ""}.`
                        : "A pasta está vazia. Esta ação não pode ser desfeita."
                      }
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteDialog(null)}
                    disabled={deletingFolder}
                    className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleDeleteFolder}
                    disabled={deletingFolder}
                    className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-600/30 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    {deletingFolder ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Excluir
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Banner de notificação OAuth */}
      <AnimatePresence>
        {notification && (
          <motion.div
            key="notification"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm",
              notification.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                : "bg-red-500/10 border border-red-500/20 text-red-300"
            )}
          >
            {notification.type === "success"
              ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
              : <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            }
            <span className="flex-1 whitespace-pre-line">{notification.message}</span>
            <button onClick={() => setNotification(null)} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabeçalho */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Contas do Instagram</h1>
          <p className="text-sm text-white/35 mt-0.5">
            {accounts.length} conectada{accounts.length !== 1 ? "s" : ""} · {active} ativa{active !== 1 ? "s" : ""}
          </p>
        </div>
        <motion.button
          onClick={() => { handleConnectClick(); }}
          whileTap={{ scale: 0.97 }}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus size={15} />
          Conectar conta
        </motion.button>
      </motion.div>

      {/* ── Pasta tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {/* Tab: Todas */}
        <button
          onClick={() => setActiveFolderId(null)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all",
            activeFolderId === null
              ? "bg-[#00FF41]/12 text-[#00FF41] border border-[#00FF41]/25"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.05] border border-transparent"
          )}
        >
          <Users size={11} className="flex-shrink-0" />
          Todas ({accounts.length})
        </button>

        {/* Tabs por pasta */}
        {folders.map(folder => {
          const isActive = activeFolderId === folder.id;
          const menuOpen = openFolderMenuId === folder.id;
          return (
            <div key={folder.id} className="relative flex items-center flex-shrink-0" data-folder-menu>
              <button
                onClick={() => setActiveFolderId(folder.id)}
                className={cn(
                  "flex items-center gap-1.5 pl-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all rounded-l-lg",
                  isActive ? "pr-1" : "pr-3 rounded-r-lg",
                  isActive
                    ? "bg-violet-500/12 text-violet-300 border border-violet-500/25 border-r-0"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.05] border border-transparent"
                )}
              >
                <Folder size={11} className="flex-shrink-0" />
                {folder.name}
                <span className={cn(
                  "text-[9px] px-1 py-0.5 rounded-full",
                  isActive ? "bg-violet-500/20 text-violet-300/70" : "bg-white/[0.06] text-white/25"
                )}>
                  {folder.account_count}
                </span>
              </button>

              {/* Gear button — só visível na pasta ativa */}
              {isActive && (
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenFolderMenuId(menuOpen ? null : folder.id); }}
                  className="h-full px-2 flex items-center rounded-r-lg bg-violet-500/12 border border-violet-500/25 border-l-0 text-violet-400/50 hover:text-violet-300 transition-colors"
                >
                  <Settings2 size={11} />
                </button>
              )}

              {/* Folder gear dropdown */}
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute left-0 top-full mt-1.5 z-30 min-w-[148px] bg-[#111318] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setRenameModal({ id: folder.id, name: folder.name });
                        setRenameName(folder.name);
                        setOpenFolderMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors"
                    >
                      <Pencil size={12} className="text-amber-400" /> Renomear Pasta
                    </button>
                    <div className="h-px bg-white/[0.06]" />
                    <button
                      onClick={() => {
                        setDeleteDialog({ id: folder.id, name: folder.name, count: folder.account_count });
                        setOpenFolderMenuId(null);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400/70 hover:bg-red-500/[0.08] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} /> Excluir Pasta
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Nova pasta button */}
        <button
          onClick={() => setShowNewFolderModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 text-white/30 hover:text-violet-400 hover:bg-violet-500/[0.06] border border-transparent hover:border-violet-500/20 transition-all"
        >
          <FolderPlus size={11} className="flex-shrink-0" />
          Nova Pasta
        </button>
      </div>

      {/* Grid de contas */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <AccountSkeleton key={i} />)}
        </div>
      ) : filteredAccounts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card rounded-2xl flex flex-col items-center gap-4 py-20 text-center px-6"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            {activeFolderId
              ? <Folder size={24} className="text-white/20" />
              : <Instagram size={24} className="text-white/20" />
            }
          </div>
          <div className="space-y-1">
            {activeFolderId ? (
              <>
                <p className="text-white/40 text-sm font-medium">Pasta vazia</p>
                <p className="text-white/20 text-xs max-w-xs">
                  Mova contas para esta pasta usando o menu ⋯ em cada conta.
                </p>
              </>
            ) : (
              <>
                <p className="text-white/40 text-sm font-medium">Nenhuma conta conectada</p>
                <p className="text-white/20 text-xs max-w-xs">
                  Clique em &quot;Conectar conta&quot; e autorize via Instagram para adicionar sua primeira conta Business ou Creator.
                </p>
              </>
            )}
          </div>
          {!activeFolderId && (
            <motion.button
              onClick={() => { handleConnectClick(); }}
              whileTap={{ scale: 0.97 }}
              className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2"
            >
              <Plus size={14} /> Conectar primeira conta
            </motion.button>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {filteredAccounts.map(account => (
              <AccountCard
                key={account.id}
                account={account}
                storiesData={storiesMap[account.id]}
                folders={folders}
                onRefresh={handleRefresh}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onRefreshToken={handleRefreshToken}
                onMove={handleMoveAccount}
                refreshing={refreshingId === account.id}
                toggling={togglingId === account.id}
                deleting={deletingId === account.id}
                tokenRefreshing={tokenRefreshingId === account.id}
                moving={movingAccountId === account.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
