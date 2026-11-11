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

# Imagem e APK por arquitetura (mesma regra de agente-vps/lib/android.mjs e fluxos/apk.mjs):
#   arm64   redroid 13.0.0_64only + instagram-<versão>.apk (adb install)
#   x86_64  redroid 13.0.0-latest + x86-<versão>/base.apk + split_config.xxhdpi.apk (adb install-multiple)
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) IMAGEM="redroid/redroid:13.0.0-latest"; ABI="x86_64" ;;
  aarch64|arm64) IMAGEM="redroid/redroid:13.0.0_64only-latest"; ABI="arm64-v8a" ;;
  *) echo "arquitetura sem imagem do redroid: $ARCH" >&2; exit 1 ;;
esac
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

# Confere "<arquivo>.sha256" (formato do sha256sum) dentro da pasta do arquivo.
conferir_sha() {
  local arquivo="$1" sha="$1.sha256"
  if [ "$FORCE" = 1 ]; then log "AVISO: --force, pulando a conferência do sha256 de $(basename "$arquivo")"; return 0; fi
  [ -f "$sha" ] || { log "Falta o checksum $sha. Gere com: (cd $(dirname "$arquivo") && sha256sum $(basename "$arquivo") > $(basename "$sha")) ou rode com --force"; exit 1; }
  (cd "$(dirname "$arquivo")" && sha256sum -c --quiet "$(basename "$sha")") || {
    log "sha256 de $(basename "$arquivo") não bate com $sha. Baixe de novo (ou --force para instalar mesmo assim)"
    exit 1
  }
  log "sha256 de $(basename "$arquivo") conferido"
}

if [ "$ABI" = "x86_64" ]; then
  if [ -z "$VERSAO" ]; then
    VERSAO="$(ls -d "$APKS"/x86-*/ 2>/dev/null | sed -E 's#.*/x86-([^/]+)/?$#\1#' | sort -V | tail -1 || true)"
  fi
  APK_DIR="$APKS/x86-${VERSAO}"
  APK_ARQUIVOS=("$APK_DIR/base.apk" "$APK_DIR/split_config.xxhdpi.apk")
  for a in "${APK_ARQUIVOS[@]}"; do
    [ -f "$a" ] || { log "APK x86_64 não encontrado: $a (fixe base.apk + split_config.xxhdpi.apk + .sha256 em $APK_DIR/)"; exit 1; }
    conferir_sha "$a"
  done
  APK="$APK_DIR"
else
  if [ -z "$VERSAO" ]; then
    VERSAO="$(ls "$APKS"/instagram-*.apk 2>/dev/null | sed -E 's#.*/instagram-(.+)\.apk#\1#' | sort -V | tail -1 || true)"
  fi
  APK="$APKS/instagram-${VERSAO}.apk"
  [ -f "$APK" ] || { log "APK não encontrado: $APK (copie instagram-<versão>.apk e instagram-<versão>.apk.sha256 para $APKS/)"; exit 1; }
  conferir_sha "$APK"
  APK_ARQUIVOS=("$APK")
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
  androidboot.redroid_dpi=420 androidboot.redroid_fps=30 androidboot.use_memfd=true \
  androidboot.redroid_net_ndns=1 androidboot.redroid_net_dns1=1.1.1.1 >/dev/null
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

# ABI do container antes de qualquer APK: a abilist tem que trazer a ABI da VPS (senão ABI_AUSENTE).
ABILIST="$(adb -s "$IP" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r')"
case ",$ABILIST," in
  *",$ABI,"*) log "abilist ok: $ABILIST" ;;
  *) log "ABI_AUSENTE: ro.product.cpu.abilist=$ABILIST não traz $ABI"; docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null 2>&1 || true; exit 1 ;;
esac

log "instalando ${APK_ARQUIVOS[*]}"
if [ "$ABI" = "x86_64" ]; then
  adb -s "$IP" install-multiple -r -g "${APK_ARQUIVOS[@]}" | tail -1
else
  adb -s "$IP" install -r -g "${APK_ARQUIVOS[@]}" | tail -1
fi
adb -s "$IP" shell am force-stop com.instagram.android >/dev/null 2>&1 || true
INSTALADA="$(adb -s "$IP" shell dumpsys package com.instagram.android 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r')"
PRIMARIA="$(adb -s "$IP" shell dumpsys package com.instagram.android 2>/dev/null | grep -m1 primaryCpuAbi | sed 's/.*primaryCpuAbi=//' | tr -d '\r')"
[ "$PRIMARIA" = "$ABI" ] || { log "ABI_AUSENTE: o Instagram instalou como ${PRIMARIA:-?}, esta VPS exige $ABI"; docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null 2>&1 || true; exit 1; }
log "primaryCpuAbi=$PRIMARIA"

# Navegador da base: Chrome pinado em $APKS/browser/chrome-<versão>/ (base + splits, puxados do Aurora com
# pm path + adb pull) e conferido pelo $APKS/browser/SHA256SUMS. É o que o Estruturar usa quando a página do
# link abre sem sessão (login pelo navegador); sem ele essa etapa falha com SEM_NAVEGADOR.
BROWSER_DIR="$APKS/browser"
CHROME_DIR="$(ls -d "$BROWSER_DIR"/chrome-*/ 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$CHROME_DIR" ] && ls "$CHROME_DIR"*.apk >/dev/null 2>&1; then
  if [ "$FORCE" = 1 ]; then
    log "AVISO: --force, pulando a conferência do sha256 do navegador"
  else
    [ -f "$BROWSER_DIR/SHA256SUMS" ] || { log "Falta $BROWSER_DIR/SHA256SUMS. Gere com: (cd $BROWSER_DIR && sha256sum chrome-*/*.apk > SHA256SUMS) ou rode com --force"; exit 1; }
    (cd "$BROWSER_DIR" && sha256sum -c --quiet SHA256SUMS) || { log "sha256 do navegador não bate com $BROWSER_DIR/SHA256SUMS"; exit 1; }
    for a in "$CHROME_DIR"*.apk; do
      grep -q " $(basename "$CHROME_DIR")/$(basename "$a")\$" "$BROWSER_DIR/SHA256SUMS" || { log "$(basename "$a") não está no SHA256SUMS do navegador"; exit 1; }
    done
    log "sha256 do navegador conferido ($(basename "$CHROME_DIR"))"
  fi
  log "instalando o navegador: $(basename "$CHROME_DIR")"
  adb -s "$IP" install-multiple -r -g "$CHROME_DIR"*.apk | tail -1
  NAVEGADOR="$(adb -s "$IP" shell dumpsys package com.android.chrome 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r')"
  [ -n "$NAVEGADOR" ] || { log "o Chrome não instalou na base"; docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null 2>&1 || true; exit 1; }
  # Sem a tela de boas-vindas nem o pedido de navegador padrão: o Chrome abre direto na página.
  adb -s "$IP" shell "echo 'chrome --no-first-run --disable-fre --no-default-browser-check' > /data/local/tmp/chrome-command-line" >/dev/null 2>&1 || true
  adb -s "$IP" shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true
  adb -s "$IP" shell am force-stop com.android.chrome >/dev/null 2>&1 || true
  log "navegador: Chrome $NAVEGADOR"
else
  NAVEGADOR=""
  log "AVISO: sem navegador em $BROWSER_DIR/chrome-<versão>/: a base fica sem Chrome (o Estruturar para em SEM_NAVEGADOR se a página pedir login)"
fi

log "parando e guardando"
adb disconnect "$IP" >/dev/null 2>&1 || true
docker stop -t 30 "$BASE_CONTAINER" >/dev/null
docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null
docker volume inspect "$BASE_VOLUME" >/dev/null
# Versão usada na base: o agente põe esta em primeiro na lista que a aba mostra.
echo "$VERSAO" > "$APKS/ATUAL"

echo "RESUMO: base pronta com Instagram ${INSTALADA:-$VERSAO} $ABI e ${NAVEGADOR:+Chrome $NAVEGADOR}${NAVEGADOR:-sem navegador} (imagem $IMAGEM, volume $BASE_VOLUME, props em $PROPS)"
