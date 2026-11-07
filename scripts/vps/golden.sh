#!/usr/bin/env bash
# Cria (ou refaz) o container base dos redroids: sobe um redroid com
# fingerprint neutro no volume scalemaster-base, espera o boot, instala o APK
# mais novo de /opt/scalemaster/apks, para e guarda o volume como template.
# Também extrai os build.prop da imagem (system, vendor, product) para
# /opt/scalemaster/vps/base, que o driver reescreve por conta.
#
#   bash scripts/vps/golden.sh [versão-do-apk] [--force]
#
# O APK precisa do instagram-<versão>.apk.sha256 ao lado (formato do
# sha256sum: "<hash>  instagram-<versão>.apk"); --force pula a conferência.
#
# Chamado pelo botão "Rebuild imagem" da aba (agente-vps/tarefas/rebuild-imagem.mjs).
set -euo pipefail

IMAGEM="redroid/redroid:13.0.0_64only-latest"
BASE_VOLUME="scalemaster-base"
BASE_CONTAINER="scalemaster-golden"
PORTA=5999
APKS=/opt/scalemaster/apks
PROPS=/opt/scalemaster/vps/base
VERSAO=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) VERSAO="$arg" ;;
  esac
done

log() { echo "[golden $(date +%H:%M:%S)] $*"; }

if [ -z "$VERSAO" ]; then
  VERSAO="$(ls "$APKS"/instagram-*.apk 2>/dev/null | sed -E 's#.*/instagram-(.+)\.apk#\1#' | sort -V | tail -1 || true)"
fi
APK="$APKS/instagram-${VERSAO}.apk"
[ -f "$APK" ] || { log "APK não encontrado: $APK (copie instagram-<versão>.apk e instagram-<versão>.apk.sha256 para $APKS/)"; exit 1; }

if [ "$FORCE" = 1 ]; then
  log "AVISO: --force, pulando a conferência do sha256 de $(basename "$APK")"
else
  SHA="$APK.sha256"
  [ -f "$SHA" ] || { log "Falta o checksum $SHA. Gere com: (cd $APKS && sha256sum $(basename "$APK") > $(basename "$SHA")) ou rode com --force"; exit 1; }
  (cd "$APKS" && sha256sum -c --quiet "$(basename "$SHA")") || {
    log "sha256 de $(basename "$APK") não bate com $SHA. Baixe o APK de novo para $APKS/ (ou --force para instalar mesmo assim)"
    exit 1
  }
  log "sha256 de $(basename "$APK") conferido"
fi

log "imagem $IMAGEM"
docker pull -q "$IMAGEM" >/dev/null

log "build.prop da imagem → $PROPS"
install -d -m 0700 "$PROPS"
docker rm -f scalemaster-props >/dev/null 2>&1 || true
docker create --name scalemaster-props "$IMAGEM" >/dev/null
docker cp scalemaster-props:/system/build.prop "$PROPS/system.prop"
docker cp scalemaster-props:/vendor/build.prop "$PROPS/vendor.prop"
docker cp scalemaster-props:/product/etc/build.prop "$PROPS/product.prop" 2>/dev/null || docker cp scalemaster-props:/product/build.prop "$PROPS/product.prop"
docker rm -f scalemaster-props >/dev/null

log "volume $BASE_VOLUME (recriado)"
docker rm -f "$BASE_CONTAINER" >/dev/null 2>&1 || true
docker volume rm -f "$BASE_VOLUME" >/dev/null 2>&1 || true
docker volume create --label scalemaster.vps=1 "$BASE_VOLUME" >/dev/null

log "subindo a base na vpsnet (porta adb 127.0.0.1:$PORTA), sem internet"
docker run -d --name "$BASE_CONTAINER" --privileged --network vpsnet --label scalemaster.vps=1 \
  -p "127.0.0.1:${PORTA}:5555" -v "$BASE_VOLUME:/data" --memory 2g \
  "$IMAGEM" \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_width=1080 androidboot.redroid_height=1920 \
  androidboot.redroid_dpi=420 androidboot.redroid_fps=30 androidboot.redroid_net_ndns=1 androidboot.redroid_net_dns1=1.1.1.1 >/dev/null
# Mesmo kill switch dos containers de conta (lib/rede.mjs, modo bloqueado): a base nunca sai para a internet.
docker rm -f "${BASE_CONTAINER}-proxy" >/dev/null 2>&1 || true
docker run -d --name "${BASE_CONTAINER}-proxy" --network "container:${BASE_CONTAINER}" --cap-add NET_ADMIN scalemaster-redsocks:1 \
  sh -c 'iptables -A OUTPUT -o lo -j ACCEPT; iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A OUTPUT -j DROP; exec sleep infinity' >/dev/null
IP="127.0.0.1:${PORTA}"

log "esperando o Android (até 5 min) em $IP"
for i in $(seq 1 100); do
  if adb connect "$IP" >/dev/null 2>&1 && [ "$(adb -s "$IP" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    break
  fi
  sleep 3
  [ "$i" = 100 ] && { log "a base não terminou de ligar"; docker logs --tail 30 "$BASE_CONTAINER"; exit 1; }
done
adb -s "$IP" root >/dev/null 2>&1 || true
sleep 2
adb connect "$IP" >/dev/null 2>&1 || true

log "fingerprint neutro e ajustes de base"
adb -s "$IP" shell settings put global development_settings_enabled 0 >/dev/null
adb -s "$IP" shell settings put global adb_enabled 1 >/dev/null
adb -s "$IP" shell settings put system screen_off_timeout 1800000 >/dev/null
adb -s "$IP" shell settings put secure android_id 0000000000000000 >/dev/null
adb -s "$IP" shell setprop persist.sys.timezone UTC >/dev/null
adb -s "$IP" shell setprop persist.sys.locale en-US >/dev/null

log "instalando $APK"
adb -s "$IP" install -r -g "$APK" | tail -1
adb -s "$IP" shell am force-stop com.instagram.android >/dev/null 2>&1 || true
INSTALADA="$(adb -s "$IP" shell dumpsys package com.instagram.android 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r')"

log "parando e guardando"
adb disconnect "$IP" >/dev/null 2>&1 || true
docker stop -t 30 "$BASE_CONTAINER" >/dev/null
docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null
docker volume inspect "$BASE_VOLUME" >/dev/null
# Versão usada na base: o agente põe esta em primeiro na lista que a aba mostra.
echo "$VERSAO" > "$APKS/ATUAL"

echo "RESUMO: base pronta com Instagram ${INSTALADA:-$VERSAO} (volume $BASE_VOLUME, props em $PROPS)"
