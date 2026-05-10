"use client";

import { motion } from "framer-motion";
import { Instagram, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InstagramAccount {
  id: string;
  username: string;
  display_name: string;
  avatar_color: string;
  followers?: number;
  is_active: boolean;
}

interface AccountSelectorProps {
  accounts: InstagramAccount[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function AccountSelector({ accounts, selected, onChange }: AccountSelectorProps) {
  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  };

  const selectAll = () => onChange(accounts.map((a) => a.id));
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white/70">
          Selecione as contas
          {selected.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold">
              {selected.length}
            </span>
          )}
        </p>
        <div className="flex gap-2 text-[11px]">
          <button
            onClick={selectAll}
            className="text-violet-400 hover:text-violet-300 transition-colors"
          >
            Todas
          </button>
          <span className="text-white/20">·</span>
          <button
            onClick={clearAll}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* Account list */}
      <div className="space-y-2">
        {accounts.map((account) => {
          const isSelected = selected.includes(account.id);
          return (
            <motion.button
              key={account.id}
              onClick={() => toggle(account.id)}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-200 text-left",
                isSelected
                  ? "bg-violet-600/15 border-violet-500/40"
                  : "bg-white/[0.03] border-white/[0.07] hover:border-white/15 hover:bg-white/[0.06]"
              )}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white",
                  account.avatar_color
                )}
              >
                <Instagram size={16} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-sm font-semibold truncate transition-colors",
                  isSelected ? "text-violet-200" : "text-white/70"
                )}>
                  @{account.username}
                </p>
                <p className="text-[11px] text-white/30 truncate">
                  {account.display_name}
                  {account.followers && (
                    <> · {(account.followers / 1000).toFixed(1)}K seguidores</>
                  )}
                </p>
              </div>

              {/* Status dot + checkbox */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  account.is_active ? "bg-emerald-400" : "bg-white/20"
                )} />
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                  isSelected
                    ? "border-violet-500 bg-violet-500"
                    : "border-white/20"
                )}>
                  {isSelected && <Check size={11} className="text-white" strokeWidth={3} />}
                </div>
              </div>
            </motion.button>
          );
        })}

        {/* Add account placeholder */}
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-white/10 text-white/25 hover:border-violet-500/30 hover:text-violet-400/60 transition-all text-sm">
          <div className="w-9 h-9 rounded-full bg-white/[0.03] flex items-center justify-center">
            <Plus size={14} />
          </div>
          Adicionar nova conta
        </button>
      </div>
    </div>
  );
}
