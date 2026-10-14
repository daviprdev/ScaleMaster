"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Moon, Sun, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ElementType;
  action: () => void;
  keywords?: string[];
}

const NAV_ITEMS: Omit<CommandItem, "action">[] = [
  { id: "dashboard", label: "Visão geral", keywords: ["início", "home"] },
  { id: "accounts", label: "Contas", keywords: ["contas"] },
  { id: "contas-leitoras", label: "Contas leitoras", keywords: ["leitora"] },
  { id: "proxy-test", label: "Proxies", keywords: ["proxy"] },
  { id: "failover", label: "Failover" },
  { id: "postar", label: "Postar", keywords: ["publicar", "distribuir"] },
  { id: "loop", label: "Loop", keywords: ["ciclo"] },
  { id: "stories", label: "Stories" },
  { id: "queue", label: "Fila", keywords: ["pendentes"] },
  { id: "publicados", label: "Publicados" },
  { id: "inspirations", label: "Inspirações", keywords: ["reels", "viral"] },
  { id: "clone", label: "Clonar" },
  { id: "library", label: "Biblioteca", keywords: ["vídeos", "mídia"] },
  { id: "monitor", label: "Monitor" },
  { id: "analytics", label: "Analytics", keywords: ["relatório", "dados"] },
  { id: "settings", label: "Configurações", keywords: ["ajustes"] },
  { id: "apps", label: "Meu App", keywords: ["aplicativo"] },
];

const ACTION_ITEMS: Omit<CommandItem, "action">[] = [
  { id: "action-post", label: "Postar agora", keywords: ["nova postagem"] },
  { id: "action-loop", label: "Novo loop", keywords: ["criar ciclo"] },
  { id: "action-connect", label: "Conectar conta", keywords: ["adicionar conta"] },
  { id: "action-folder", label: "Nova pasta na biblioteca", keywords: ["criar pasta"] },
  { id: "action-theme-dark", label: "Tema escuro", keywords: ["dark mode"] },
  { id: "action-theme-light", label: "Tema claro", keywords: ["light mode"] },
  { id: "action-theme-system", label: "Tema do sistema", keywords: ["auto"] },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Build full items list with actions
  const allItems: CommandItem[] = React.useMemo(() => {
    const navs: CommandItem[] = NAV_ITEMS.map((item) => ({
      ...item,
      action: () => {
        router.push(`/dashboard/${item.id === "dashboard" ? "" : item.id}`);
        setOpen(false);
        setQuery("");
      },
    }));

    const actions: CommandItem[] = ACTION_ITEMS.map((item) => ({
      ...item,
      action: () => {
        if (item.id.startsWith("action-theme-")) {
          const theme = item.id.replace("action-theme-", "");
          localStorage.setItem("sm-theme", theme);
          document.documentElement.setAttribute(
            "data-theme",
            theme === "system"
              ? window.matchMedia("(prefers-color-scheme: light)").matches
                ? "light"
                : "dark"
              : theme
          );
        } else if (item.id === "action-post") {
          router.push("/dashboard/postar");
        } else if (item.id === "action-loop") {
          router.push("/dashboard/loop");
        } else if (item.id === "action-connect") {
          router.push("/dashboard/accounts?action=connect");
        } else if (item.id === "action-folder") {
          router.push("/dashboard/library?action=new-folder");
        }
        setOpen(false);
        setQuery("");
      },
    }));

    return [...navs, ...actions];
  }, [router]);

  // Filter items by query
  const filteredItems = React.useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  }, [allItems, query]);

  // Reset active index when filter changes
  React.useEffect(() => {
    setActiveIndex(0);
  }, [filteredItems.length]);

  // Keyboard shortcut to open
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll active item into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filteredItems[activeIndex]?.action();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh]">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-overlay transition-opacity duration-200"
        onClick={() => {
          setOpen(false);
          setQuery("");
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "relative w-full max-w-[560px] rounded-xl border border-line bg-surface-raised shadow-pop",
          "animate-in fade-in zoom-in-95 duration-200 ease-out"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search size={18} strokeWidth={1.75} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar páginas e ações…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
          />
          <Kbd keys={["Esc"]} />
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[320px] overflow-y-auto p-1.5 custom-scrollbar"
        >
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-3">
              Nenhum resultado para &ldquo;{query}&rdquo;
            </div>
          ) : (
            filteredItems.map((item, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => item.action()}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150",
                    isActive
                      ? "bg-surface-hover text-ink"
                      : "text-ink-2 hover:bg-surface-hover hover:text-ink"
                  )}
                >
                  {item.id.startsWith("action-theme-") && (
                    <span className="shrink-0 text-ink-3">
                      {item.id === "action-theme-dark" && <Moon size={16} strokeWidth={1.75} />}
                      {item.id === "action-theme-light" && <Sun size={16} strokeWidth={1.75} />}
                      {item.id === "action-theme-system" && <Monitor size={16} strokeWidth={1.75} />}
                    </span>
                  )}
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {item.description && (
                    <span className="hidden sm:inline text-xs text-ink-3">
                      {item.description}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-ink-3">
          <span>
            <Kbd keys={["↑", "↓"]} /> navegar
          </span>
          <span>
            <Kbd keys={["↵"]} /> selecionar
          </span>
        </div>
      </div>
    </div>
  );
}

CommandPalette.displayName = "CommandPalette";