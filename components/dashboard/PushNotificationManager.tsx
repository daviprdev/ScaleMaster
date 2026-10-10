"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, BellRing, BellOff, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SupportState = "checking" | "unsupported" | "ios-needs-install" | "supported";

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushNotificationManager() {
  const [supportState, setSupportState] = useState<SupportState>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const checkExistingSubscription = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    const hasApis =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!hasApis) {
      setSupportState("unsupported");
      return;
    }
    if (isIos() && !isStandalone()) {
      setSupportState("ios-needs-install");
      return;
    }
    setSupportState("supported");
    checkExistingSubscription();
  }, [checkExistingSubscription]);

  const handleSubscribe = async () => {
    setBusy(true);
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Permissão de notificação negada pelo navegador.");
        setBusy(false);
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const keyRes = await fetch("/api/push/vapid-public-key");
      const keyData = (await keyRes.json()) as { publicKey?: string; error?: string };
      if (!keyData.publicKey) throw new Error(keyData.error || "Chave VAPID indisponível");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("Falha ao registrar subscription no servidor.");

      setSubscribed(true);
    } catch (err: any) {
      setError(err?.message || "Não foi possível ativar as notificações.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    setError("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err: any) {
      setError(err?.message || "Não foi possível desativar as notificações.");
    } finally {
      setBusy(false);
    }
  };

  if (supportState === "checking") {
    return <div className="text-sm text-white/40">Verificando suporte a notificações…</div>;
  }

  if (supportState === "unsupported") {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <AlertCircle size={16} className="text-white/30 shrink-0" />
        <p className="text-sm text-white/45">
          Este navegador não suporta notificações push.
        </p>
      </div>
    );
  }

  if (supportState === "ios-needs-install") {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
        <AlertCircle size={16} className="text-amber-400 shrink-0" />
        <p className="text-sm text-amber-200/80">
          No iPhone, primeiro adicione o Scale Master à Tela de Início (Compartilhar → Adicionar à
          Tela de Início) e abra por esse ícone para poder ativar notificações.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-3">
          <span className={cn("shrink-0", subscribed ? "text-[#00FF41]" : "text-white/30")}>
            {subscribed ? <BellRing size={16} /> : <Bell size={16} />}
          </span>
          <div>
            <p className="text-sm font-medium text-white/80">Notificações push</p>
            <p className="text-xs text-white/40">
              {subscribed
                ? "Ativas neste dispositivo."
                : "Receba avisos de vendas, mensagens do admin e resumos do sistema."}
            </p>
          </div>
        </div>
        <button
          onClick={subscribed ? handleUnsubscribe : handleSubscribe}
          disabled={busy}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 shrink-0",
            subscribed
              ? "bg-red-500/[0.06] border border-red-500/20 text-red-400 hover:bg-red-500/[0.10]"
              : "bg-[#00FF41]/[0.08] border border-[#00FF41]/25 text-[#00FF41] hover:bg-[#00FF41]/[0.14]"
          )}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {subscribed ? <BellOff size={14} /> : <Bell size={14} />}
          {subscribed ? "Desativar" : "Ativar"}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300/80">{error}</p>
        </div>
      )}
    </div>
  );
}
