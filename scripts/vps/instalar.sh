#!/usr/bin/env bash
# Prepara a VPS (Ubuntu 24.04, ARM64, Hetzner CAX31) para o agente da aba
# Contas VPS: Docker, módulo binder do kernel (redroid), adb, bridge vpsnet,
# sysctl, imagem do sidecar redsocks, pastas em /opt/scalemaster e a unit
# systemd. Idempotente: pode rodar de novo.
#
#   sudo bash scripts/vps/instalar.sh [--apk URL]
#
# Depois: bash scripts/vps/golden.sh (base com o APK) e, na pasta agente-vps,
# node agente.mjs conectar smag_... (código gerado na aba Contas VPS).
set -euo pipefail

CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APK_URL="${APK_URL:-}"
APK_VERSAO="${APK_VERSAO:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apk) APK_URL="$2"; shift 2 ;;
    --versao) APK_VERSAO="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "rode como root (sudo)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== pacotes"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release android-tools-adb iptables dkms git jq "linux-headers-$(uname -r)" >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "== docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io >/dev/null
fi
systemctl enable --now docker

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "== node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "== módulos binder (redroid)"
# O kernel da Ubuntu 24.04 (6.8) traz binder_linux como módulo; ashmem não existe
# mais no Android 13 (usa memfd). Sem o módulo no kernel, compila pelo dkms.
if ! modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null; then
  if [ ! -d /usr/src/redroid-modules ]; then
    git clone --depth 1 https://github.com/remote-android/redroid-modules.git /usr/src/redroid-modules
  fi
  (cd /usr/src/redroid-modules && make -C binder && make -C binder install) || {
    echo "não consegui compilar o binder: veja https://github.com/remote-android/redroid-doc" >&2
    exit 1
  }
  modprobe binder_linux devices="binder,hwbinder,vndbinder"
fi
cat > /etc/modules-load.d/redroid.conf <<EOF
binder_linux
EOF
cat > /etc/modprobe.d/redroid.conf <<EOF
options binder_linux devices=binder,hwbinder,vndbinder
EOF
ls /dev/binder /dev/hwbinder /dev/vndbinder >/dev/null 2>&1 || echo "aviso: /dev/binder* ainda não apareceu (o docker cria no --privileged)"

echo "== sysctl"
cat > /etc/sysctl.d/90-scalemaster-vps.conf <<EOF
net.ipv4.ip_forward = 1
net.ipv4.conf.all.route_localnet = 1
fs.inotify.max_user_instances = 8192
fs.inotify.max_user_watches = 1048576
kernel.pid_max = 4194304
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

echo "== bridge vpsnet (10.77.0.0/24)"
docker network inspect vpsnet >/dev/null 2>&1 || \
  docker network create --driver bridge --subnet 10.77.0.0/24 --gateway 10.77.0.1 -o com.docker.network.bridge.name=vpsnet vpsnet >/dev/null

echo "== pastas"
install -d -m 0755 /opt/scalemaster/apks /opt/scalemaster/midias /opt/scalemaster/midias/perfil
install -d -m 0700 /opt/scalemaster/sessoes /opt/scalemaster/vps /opt/scalemaster/vps/instancias /opt/scalemaster/vps/props /opt/scalemaster/vps/base /opt/scalemaster/vps/rede

echo "== imagem do sidecar (alpine + redsocks + iptables + curl)"
TMP="$(mktemp -d)"
cat > "$TMP/Dockerfile" <<'EOF'
FROM alpine:3.20
# uid 60000 fixo (agente-vps/lib/rede.mjs UID_REDSOCKS): 1000/2000 são system/shell do Android, 10000+ os apps.
RUN apk add --no-cache redsocks iptables curl && adduser -D -H -s /sbin/nologin -u 60000 redsocks
EOF
docker build -q -t scalemaster-redsocks:1 "$TMP" >/dev/null
rm -rf "$TMP"

echo "== imagem do redroid"
docker pull -q redroid/redroid:13.0.0_64only-latest >/dev/null
docker pull -q alpine:3.20 >/dev/null

if [ -n "$APK_URL" ]; then
  echo "== APK do Instagram"
  [ -n "$APK_VERSAO" ] || APK_VERSAO="$(basename "$APK_URL" | grep -oE '[0-9]+(\.[0-9]+)+' | head -1 || true)"
  [ -n "$APK_VERSAO" ] || { echo "informe --versao <versão> junto do --apk" >&2; exit 2; }
  curl -fL -o "/opt/scalemaster/apks/instagram-${APK_VERSAO}.apk" "$APK_URL"
fi
if ! ls /opt/scalemaster/apks/instagram-*.apk >/dev/null 2>&1; then
  echo "aviso: nenhum APK em /opt/scalemaster/apks. Copie instagram-<versão>.apk para lá (o lote escolhe a versão)."
fi

echo "== unit systemd"
[ -f /opt/scalemaster/agente-vps/.env ] || { touch /opt/scalemaster/agente-vps/.env; chmod 600 /opt/scalemaster/agente-vps/.env; }
install -m 0644 "$CHECKOUT/agente-vps/scalemaster-vps-agent.service" /etc/systemd/system/scalemaster-vps-agent.service
systemctl daemon-reload
systemctl enable scalemaster-vps-agent.service >/dev/null

echo
echo "Pronto. Próximos passos:"
echo "  1. bash $CHECKOUT/scripts/vps/golden.sh            (base com o APK de /opt/scalemaster/apks)"
echo "  2. cd $CHECKOUT/agente-vps && node agente.mjs conectar smag_...   (código da aba Contas VPS)"
echo "  3. echo 'CAPSOLVER_KEY=...' >> /opt/scalemaster/agente-vps/.env && systemctl restart scalemaster-vps-agent"
