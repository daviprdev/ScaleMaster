#!/usr/bin/env bash
# Importa num host novo o que o exportar.sh gerou (ver MIGRACAO.md). Pré-requisitos
# no host novo: Docker, o repositório em /opt/scalemaster (git clone) e o
# scripts/vps/instalar.sh já rodado (adb, Node, binder, sidecar, bridge).
#
#   bash scripts/vps/importar.sh <pasta-exportada> [--simular] [--sobrescrever]
#
# Ordem: confere SHA256SUMS e a arquitetura do MANIFESTO (diferente = para: veja
# "Outra arquitetura" no MIGRACAO.md) → docker load → cria cada volume e
# desempacota → pastas de estado → .env/config.json do agente → unit systemd →
# firewall e módulos → liga o agente. Os containers de conta são recriados pelo
# agente quando cada conta liga. Volume que já existe com dados = para, a não ser
# com --sobrescrever. --simular só mostra os comandos.
set -euo pipefail

RAIZ="${SCALEMASTER_RAIZ:-/opt/scalemaster}"
ORIGEM=""
SIMULAR=0
SOBRESCREVER=0
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    --sobrescrever) SOBRESCREVER=1 ;;
    *) ORIGEM="$arg" ;;
  esac
done
[ -n "$ORIGEM" ] && [ -f "$ORIGEM/MANIFESTO" ] || { echo "Uso: importar.sh <pasta com MANIFESTO> [--simular] [--sobrescrever]" >&2; exit 1; }
COPIADOR="alpine:3.20"

log() { echo "[importar $(date +%H:%M:%S)] $*"; }
r() { if [ "$SIMULAR" = 1 ]; then echo "+ $*"; else "$@"; fi; }
campo() { grep -m1 "^$1=" "$ORIGEM/MANIFESTO" | cut -d= -f2-; }

ARCH="${SCALEMASTER_ARCH:-$(uname -m)}"
case "$ARCH" in x86_64|amd64) ARCH=x86_64 ;; aarch64|arm64) ARCH=arm64 ;; esac
ARCH_ORIGEM="$(campo arch)"
if [ "$ARCH_ORIGEM" != "$ARCH" ]; then
  echo "A exportação é de $ARCH_ORIGEM e este host é $ARCH: imagem do redroid, APKs e libs dos volumes são por arquitetura." >&2
  echo "Siga \"Outra arquitetura\" no MIGRACAO.md (base nova com golden.sh e Instagram/Chrome reinstalados por conta)." >&2
  exit 1
fi

if [ "$SIMULAR" != 1 ]; then
  log "conferindo SHA256SUMS"
  (cd "$ORIGEM" && sha256sum -c --quiet SHA256SUMS) || { echo "SHA256SUMS não bate: cópia incompleta ou alterada." >&2; exit 1; }
fi

log "docker load ($(campo imagens))"
r docker load -i "$ORIGEM/imagens.tar"

for arq in "$ORIGEM"/volumes/*.tgz; do
  [ -e "$arq" ] || continue
  v="$(basename "$arq" .tgz)"
  if [ "$SIMULAR" != 1 ] && docker volume inspect "$v" >/dev/null 2>&1; then
    CHEIO="$(docker run --rm -v "$v:/v:ro" "$COPIADOR" sh -c 'ls -A /v | head -1')"
    if [ -n "$CHEIO" ] && [ "$SOBRESCREVER" != 1 ]; then echo "O volume $v já existe com dados neste host (use --sobrescrever)." >&2; exit 1; fi
  fi
  log "volume $v"
  r docker volume create --label scalemaster.vps=1 "$v"
  r docker run --rm -v "$v:/para" -v "$ORIGEM/volumes:/de:ro" "$COPIADOR" sh -c "rm -rf /para/..?* /para/.[!.]* /para/* 2>/dev/null; tar -xzf /de/$v.tgz -C /para"
done

log "pastas de estado"
r tar -xzf "$ORIGEM/dados.tgz" -C /
log ".env e config.json do agente"
r tar -xzf "$ORIGEM/agente.tgz" -C "$RAIZ/agente-vps"
r chmod 600 "$RAIZ/agente-vps/.env"

log "unit systemd, módulos e firewall"
if [ -f "$ORIGEM/sistema/etc_systemd_system_scalemaster-vps-agent.service" ] || [ "$SIMULAR" = 1 ]; then
  r cp "$ORIGEM/sistema/etc_systemd_system_scalemaster-vps-agent.service" /etc/systemd/system/scalemaster-vps-agent.service
fi
for m in etc_modules-load.d_redroid.conf etc_modprobe.d_redroid.conf etc_modules-load.d_scalemaster-vps.conf; do
  if [ -f "$ORIGEM/sistema/$m" ] || [ "$SIMULAR" = 1 ]; then r cp "$ORIGEM/sistema/$m" "/$(echo "$m" | sed 's#^etc_#etc/#; s#_#/#')"; fi
done
r modprobe binder_linux devices=binder,hwbinder,vndbinder
# Firewall: as mesmas regras do instalar.sh (idempotentes), não o user.rules do host antigo (que traz as dele).
if command -v ufw >/dev/null 2>&1; then
  r sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
  r ufw allow from 10.77.0.0/16
  r ufw allow from 172.17.0.0/16
  r ufw route allow in on vpsnet+
  r ufw route allow out on vpsnet+
  r ufw reload
fi

log "ligando o agente"
r systemctl daemon-reload
r systemctl enable --now scalemaster-vps-agent

echo "RESUMO: importado de $ORIGEM ($ARCH_ORIGEM → $ARCH, $(ls "$ORIGEM"/volumes/*.tgz 2>/dev/null | wc -l) volume(s))$( [ "$SIMULAR" = 1 ] && echo " [simulado]")"
