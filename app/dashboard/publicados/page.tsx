"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  Film,
  Filter,
  ImagePlay,
  Instagram,
  Loader2,
  RefreshCw,
  Search,
  Share2,
  ThumbsUp,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────
interface Account {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  followers_count: number | null;
}

interface PublishedItem {
  id: string;
  source: "scheduled" | "loop";
  account_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  type: "story" | "reel";
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  caption: string | null;
  media_id: string | null;
  video_url: string | null;
  published_at: string;
  campaign_id: string | null;
  loop_id: string | null;
}

interface Stats {
  total_views: number;
  total_reach: number;
  stories: number;
  reels: number;
}

// ── Helpers ───────────────────────────────────────────────────
const AVATAR_COLORS = [
  "from-[#00498D] to-[#00346D]",
  "from-pink-500 to-rose-600",
  "from-[#85B9E9] to-[#00498D]",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
];

function strHash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return Math.abs(h);
}

function avatarColor(u: string) {
  return AVATAR_COLORS[strHash(u) % AVATAR_COLORS.length];
}

function formatNumber(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d atrás`;
  return formatDate(dateStr);
}

// ── Página principal ──────────────────────────────────────────
export default function PublicadosPage() {
  // Dados
  const [items, setItems] = useState<PublishedItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Stats>({ total_views: 0, total_reach: 0, stories: 0, reels: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "story" | "reel">("all");

  const filterRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────
  const fetchData = useCallback(async (accountId: string | null = null) => {
    if (accountId !== null) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams();
      if (accountId) params.set("account_id", accountId);
      params.set("limit", "1000");

      const res = await fetch(`/api/published?${params.toString()}`);
      const data = await res.json();

      if (res.ok) {
        setItems(data.items ?? []);
        setAccounts(data.accounts ?? []);
        setStats(data.stats ?? { total_views: 0, total_reach: 0, stories: 0, reels: 0 });
        setTotal(data.total ?? 0);
      }
    } catch (err) {
      console.error("[publicados] Erro ao buscar:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  // ── Filtragem local ───────────────────────────────────────
  const filteredItems = useMemo(() => {
    let result = items;

    // Filtro por tipo
    if (typeFilter !== "all") {
      result = result.filter((i) => i.type === typeFilter);
    }

    // Filtro por busca
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (i) =>
          i.username?.toLowerCase().includes(q) ||
          i.caption?.toLowerCase().includes(q) ||
          i.media_id?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [items, typeFilter, searchQuery]);

  // Conta selecionada (para mostrar no botão)
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  // ── Handlers ──────────────────────────────────────────────
  const handleSelectAccount = (id: string | null) => {
    setSelectedAccountId(id);
    setFilterOpen(false);
    fetchData(id);
  };

  const handleClearFilter = () => {
    setSelectedAccountId(null);
    fetchData(null);
  };

  // ── Loading state ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 size={32} className="animate-spin text-[#85B9E9]" />
        <p className="text-ink-3 text-sm">Carregando publicações...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      {/* ── Cabeçalho ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <CheckCircle2 size={22} className="text-[#85B9E9]" />
              Publicados
            </h1>
            <p className="text-sm text-ink-3 mt-0.5">
              Histórico completo de todas as publicações realizadas
            </p>
          </div>

          <button
            onClick={() => fetchData(selectedAccountId)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-line bg-surface text-ink-2 hover:text-white hover:border-line-control transition-all text-sm disabled:opacity-40"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>
      </motion.div>

      {/* ── Filtros ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Filtro de conta (discreto — dropdown) */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition-all",
                selectedAccount
                  ? "border-[#85B9E9]/40 bg-[#85B9E9]/10 text-[#85B9E9]"
                  : "border-line bg-surface text-ink-2 hover:text-white hover:border-line-control"
              )}
            >
              <Filter size={14} />
              {selectedAccount ? (
                <>
                  <span className="font-medium">@{selectedAccount.username}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearFilter();
                    }}
                    className="ml-1 w-4 h-4 rounded-full bg-[#85B9E9]/20 flex items-center justify-center hover:bg-[#85B9E9]/40 transition-colors"
                  >
                    <X size={10} />
                  </button>
                </>
              ) : (
                <span>Todas as contas</span>
              )}
              <ChevronDown
                size={14}
                className={cn("transition-transform", filterOpen ? "rotate-180" : "")}
              />
            </button>

            {/* Dropdown de contas */}
            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-line shadow-2xl z-50"
                  style={{
                    background: "rgba(0,0,0,0.92)",
                    backdropFilter: "blur(28px) saturate(180%)",
                    WebkitBackdropFilter: "blur(28px) saturate(180%)",
                  }}
                >
                  <div className="p-2 border-b border-line">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ink-3 px-2 py-1.5">
                      Selecionar conta
                    </p>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    {/* Opção "Todas" */}
                    <button
                      onClick={() => handleSelectAccount(null)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                        !selectedAccountId
                          ? "bg-[#85B9E9]/10 text-[#85B9E9]"
                          : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                      )}
                    >
                      <Users size={15} className="flex-shrink-0" />
                      <span className="font-medium">Todas as contas</span>
                      {!selectedAccountId && (
                        <CheckCircle2 size={14} className="ml-auto text-[#85B9E9]" />
                      )}
                    </button>

                    <div className="my-1 border-t border-line" />

                    {/* Lista de contas */}
                    {accounts.length === 0 ? (
                      <p className="text-ink-3 text-xs text-center py-4">
                        Nenhuma conta ativa
                      </p>
                    ) : (
                      accounts.map((acc) => {
                        const isSelected = selectedAccountId === acc.id;
                        return (
                          <button
                            key={acc.id}
                            onClick={() => handleSelectAccount(acc.id)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                              isSelected
                                ? "bg-[#85B9E9]/10 text-[#85B9E9]"
                                : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                            )}
                          >
                            {acc.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/proxy-image?url=${encodeURIComponent(acc.avatar_url)}`}
                                alt={acc.username}
                                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0",
                                  avatarColor(acc.username)
                                )}
                              >
                                <Instagram size={11} className="text-white" />
                              </div>
                            )}
                            <span className="font-medium truncate">@{acc.username}</span>
                            {acc.followers_count != null && (
                              <span className="text-[10px] text-ink-3 ml-auto flex-shrink-0">
                                {formatNumber(acc.followers_count)}
                              </span>
                            )}
                            {isSelected && (
                              <CheckCircle2 size={14} className="text-[#85B9E9] flex-shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Filtro por tipo */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-line bg-surface">
            <TypeButton
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
              label="Todos"
            />
            <TypeButton
              active={typeFilter === "story"}
              onClick={() => setTypeFilter("story")}
              label="Stories"
              icon={<ImagePlay size={12} />}
            />
            <TypeButton
              active={typeFilter === "reel"}
              onClick={() => setTypeFilter("reel")}
              label="Reels"
              icon={<Film size={12} />}
            />
          </div>

          {/* Busca */}
          <div className="flex-1 min-w-[200px] relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por conta, legenda ou ID..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-raised border border-line text-sm text-ink placeholder:text-ink-3/60 focus:border-accent/40 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-2 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Resumo do filtro */}
        {(selectedAccount || searchQuery || typeFilter !== "all") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-3 pt-3 border-t border-line flex items-center gap-2 text-xs text-ink-3"
          >
            <span>
              Mostrando <span className="text-white font-semibold">{filteredItems.length}</span>{" "}
              de {total} publicações
            </span>
            <button
              onClick={() => {
                setSelectedAccountId(null);
                setSearchQuery("");
                setTypeFilter("all");
                fetchData(null);
              }}
              className="ml-auto text-[#85B9E9] hover:text-[#AFBDD0] transition-colors"
            >
              Limpar filtros
            </button>
          </motion.div>
        )}
      </motion.div>

      {/* ── Tabela de publicações ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card rounded-2xl overflow-hidden"
      >
        {/* Header da tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3">
                  Publicado em
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3">
                  Conta
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3">
                  Tipo
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3">
                  Views
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3 hidden sm:table-cell">
                  Alcance
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3 hidden md:table-cell">
                  Likes
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3 hidden lg:table-cell">
                  Comentários
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3 hidden lg:table-cell">
                  Compartilh.
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-ink-3 hidden xl:table-cell">
                  Legenda
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center">
                        <CheckCircle2 size={24} className="text-ink-3/50" />
                      </div>
                      <p className="text-ink-3 text-sm">
                        {searchQuery || selectedAccount || typeFilter !== "all"
                          ? "Nenhuma publicação encontrada com esses filtros"
                          : "Nenhuma publicação ainda"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <motion.tr
                    key={`${item.source}-${item.id}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    className="border-b border-line hover:bg-surface-hover transition-colors"
                  >
                    {/* Data */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-ink-2 text-xs font-medium">
                          {formatDate(item.published_at)}
                        </span>
                        <span className="text-ink-3 text-[10px]">
                          {timeAgo(item.published_at)}
                        </span>
                      </div>
                    </td>

                    {/* Conta */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/proxy-image?url=${encodeURIComponent(item.avatar_url)}`}
                            alt={item.username ?? ""}
                            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center flex-shrink-0",
                              avatarColor(item.username ?? "x")
                            )}
                          >
                            <Instagram size={11} className="text-white" />
                          </div>
                        )}
                        <span className="text-ink-2 text-xs font-medium truncate">
                          @{item.username ?? "conta removida"}
                        </span>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold",
                          item.type === "story"
                            ? "bg-pink-500/15 text-pink-400"
                            : "bg-amber-500/15 text-amber-400"
                        )}
                      >
                        {item.type === "story" ? <ImagePlay size={9} /> : <Film size={9} />}
                        {item.type === "story" ? "STORY" : "REEL"}
                      </span>
                    </td>

                    {/* Views */}
                    <td className="px-4 py-3 text-right">
                      <span className="text-ink text-xs font-semibold tabular-nums">
                        {formatNumber(item.views)}
                      </span>
                    </td>

                    {/* Reach */}
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-ink-3 text-xs tabular-nums">
                        {formatNumber(item.reach)}
                      </span>
                    </td>

                    {/* Likes */}
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-ink-3 text-xs tabular-nums">
                        {formatNumber(item.likes)}
                      </span>
                    </td>

                    {/* Comments */}
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-ink-3 text-xs tabular-nums">
                        {formatNumber(item.comments)}
                      </span>
                    </td>

                    {/* Shares */}
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-ink-3 text-xs tabular-nums">
                        {formatNumber(item.shares)}
                      </span>
                    </td>

                    {/* Caption */}
                    <td className="px-4 py-3 hidden xl:table-cell max-w-[200px]">
                      <p className="text-ink-3 text-xs truncate" title={item.caption ?? ""}>
                        {item.caption ?? "—"}
                      </p>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {filteredItems.length > 0 && (
          <div className="px-4 py-3 border-t border-line flex items-center justify-between text-xs text-ink-3">
            <span>
              Mostrando {filteredItems.length} de {total} publicações
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Eye size={11} className="text-emerald-400" />
                {formatNumber(stats.total_views)} views totais
              </span>
              <span className="flex items-center gap-1">
                <TrendingUp size={11} className="text-[#85B9E9]" />
                {formatNumber(stats.total_reach)} alcance
              </span>
            </span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Componentes auxiliares ────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  color,
  bgColor,
  borderColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div className={cn("rounded-xl border p-3.5", bgColor, borderColor)}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={color}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3">
          {label}
        </span>
      </div>
      <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
    </div>
  );
}

function TypeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
        active
          ? "bg-[#85B9E9]/15 text-[#85B9E9]"
          : "text-ink-3 hover:text-ink-2 hover:bg-surface-raised"
      )}
    >
      {icon}
      {label}
    </button>
  );
}