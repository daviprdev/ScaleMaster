"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldAlert, TrendingUp, DollarSign, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface Settings {
  proxy_alerts_enabled: boolean;
  account_alerts_enabled: boolean;
  daily_profit_enabled: boolean;
  daily_profit_time: string;
  sale_alerts_enabled: boolean;
  daily_views_goal_enabled: boolean;
  daily_views_goal: number;
  daily_views_goal_time: string;
}

const DEFAULTS: Settings = {
  proxy_alerts_enabled: true,
  account_alerts_enabled: true,
  daily_profit_enabled: false,
  daily_profit_time: "23:55",
  sale_alerts_enabled: true,
  daily_views_goal_enabled: false,
  daily_views_goal: 100000,
  daily_views_goal_time: "18:00",
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex w-11 h-6 rounded-full transition-colors duration-300 focus:outline-none shrink-0 disabled:opacity-40",
        checked ? "bg-[#00498D]/60" : "bg-white/10"
      )}
    >
      <motion.span
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

function Row({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-white/30 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80">{title}</p>
          <p className="text-xs text-white/40">{description}</p>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function NotificationAlertSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [localViewsGoal, setLocalViewsGoal] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.role === "admin") setIsAdmin(true);
        });
    });

    fetch("/api/notification-settings")
      .then((r) => r.json())
      .then((data: { settings?: Settings }) => {
        if (data.settings) {
          setSettings(data.settings);
          setLocalViewsGoal(String(data.settings.daily_views_goal));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = useCallback(async (fields: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...fields }));
    setSaving(true);
    try {
      const res = await fetch("/api/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
    } catch {
      // reverte silenciosamente se falhar
      const fresh = await fetch("/api/notification-settings").then((r) => r.json());
      if (fresh.settings) setSettings(fresh.settings);
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return <div className="text-sm text-white/40">Carregando preferências…</div>;
  }

  return (
    <div className="space-y-3">
      <Row
        icon={<ShieldAlert size={16} />}
        title="Queda de contas"
        description="Avisa quando alguma das suas contas do Instagram fica com status de erro."
        checked={settings.account_alerts_enabled}
        onChange={(v) => patch({ account_alerts_enabled: v })}
        disabled={saving}
      />
      <Row
        icon={<DollarSign size={16} />}
        title="Notificações de vendas"
        description="Avisa na hora, a cada venda aprovada (ApexVips/SharkBot)."
        checked={settings.sale_alerts_enabled}
        onChange={(v) => patch({ sale_alerts_enabled: v })}
        disabled={saving}
      />
      {isAdmin && (
        <div className="px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-white/30 shrink-0"><TrendingUp size={16} /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white/80">Lucro diário</p>
                <p className="text-xs text-white/40">Resumo do faturamento do dia, todo dia no horário escolhido.</p>
              </div>
            </div>
            <Toggle
              checked={settings.daily_profit_enabled}
              onChange={(v) => patch({ daily_profit_enabled: v })}
              disabled={saving}
            />
          </div>
          {settings.daily_profit_enabled && (
            <div className="flex items-center gap-2 pl-7">
              <label className="text-xs text-white/40">Horário (Brasília)</label>
              <input
                type="time"
                value={settings.daily_profit_time}
                onChange={(e) => patch({ daily_profit_time: e.target.value })}
                disabled={saving}
                className="input-glass text-sm px-3 py-1.5 w-28"
              />
            </div>
          )}
        </div>
      )}

      {/* Meta de views do dia */}
      <div className="px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-white/30 shrink-0"><Eye size={16} /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/80">Meta de views do dia</p>
              <p className="text-xs text-white/40">Avisa quando suas contas passarem desta marca no dia.</p>
            </div>
          </div>
          <Toggle
            checked={settings.daily_views_goal_enabled}
            onChange={(v) => patch({ daily_views_goal_enabled: v })}
            disabled={saving}
          />
        </div>
        {settings.daily_views_goal_enabled && (
          <div className="space-y-2 pl-7">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100000000}
                value={localViewsGoal}
                onChange={(e) => setLocalViewsGoal(e.target.value)}
                onBlur={() => {
                  const val = Math.round(Number(localViewsGoal) || 0);
                  if (val !== settings.daily_views_goal) {
                    setLocalViewsGoal(String(val));
                    patch({ daily_views_goal: val });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                disabled={saving}
                className="input-glass text-sm px-3 py-1.5 w-32"
                placeholder="100000"
              />
              <span className="text-xs text-white/40">views</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-white/40">Horário (Brasília)</label>
              <select
                value={settings.daily_views_goal_time}
                onChange={(e) => patch({ daily_views_goal_time: e.target.value })}
                disabled={saving}
                className="input-glass text-sm px-3 py-1.5"
              >
                <option value="18:00">18:00</option>
                <option value="20:00">20:00</option>
                <option value="22:00">22:00</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
