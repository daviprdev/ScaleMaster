#!/usr/bin/env bash
# Cria (ou refaz) a base dos redroids SEM tocar na base atual até a nova estar
# conferida: sobe um redroid com fingerprint neutro num volume temporário
# (scalemaster-base-novo), instala o Instagram e o Chrome pinados de
# /opt/scalemaster/apks, confere a presença dos dois e só então troca o volume
# scalemaster-base. Os build.prop da imagem (system, vendor, product), que o
# driver reescreve por conta, também só entram em /opt/scalemaster/vps/base na troca.
#
#   bash scripts/vps/golden.sh [versão-do-apk] [--force]
#
# Qualquer falha antes da troca apaga só o que é temporário (container
# scalemaster-golden, volume scalemaster-base-novo, pasta base.novo): a base em
# uso continua igual. Na troca, a base anterior fica guardada em
# scalemaster-base-anterior (uma geração) e volta sozinha se a cópia falhar.
#
# O APK precisa do .sha256 ao lado (formato do sha256sum) e o navegador do
# browser/SHA256SUMS; --force pula a conferência dos hashes, nunca a verificação
# de presença dos pacotes.
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
# Temporários sem o label scalemaster.vps: o prune do agente (lib/disco.mjs) apaga volume com o label que não é de conta.
NOVO_VOLUME="scalemaster-base-novo"
ANTERIOR_VOLUME="scalemaster-base-anterior"
BASE_CONTAINER="scalemaster-golden"
PORTA=5999
# decisão: SCALEMASTER_APKS / SCALEMASTER_PROPS só existem para os testes apontarem para um diretório temporário.
APKS="${SCALEMASTER_APKS:-/opt/scalemaster/apks}"
PROPS="${SCALEMASTER_PROPS:-/opt/scalemaster/vps/base}"
PROPS_NOVO="${PROPS}.novo"
COPIADOR="alpine:3.20"
VERSAO=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) VERSAO="$arg" ;;
  esac
done
INICIO=$SECONDS

log() { echo "[golden $(date +%H:%M:%S)] $*"; }

# Tudo o que é temporário sai em qualquer saída que não seja a troca concluída. A base atual não é tocada.
TROCADA=0
limpar() {
  local rc=$?
  adb disconnect "127.0.0.1:${PORTA}" >/dev/null 2>&1 || true
  docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" scalemaster-props >/dev/null 2>&1 || true
  docker volume rm -f "$NOVO_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$PROPS_NOVO"
  if [ "$TROCADA" != 1 ]; then log "FALHOU (rc $rc): temporários apagados, a base $BASE_VOLUME em uso não foi alterada"; fi
}
trap limpar EXIT

falhar() { log "$*"; exit 1; }

# Confere "<arquivo>.sha256" (formato do sha256sum) dentro da pasta do arquivo.
conferir_sha() {
  local arquivo="$1" sha="$1.sha256"
  if [ "$FORCE" = 1 ]; then log "AVISO: --force, pulando a conferência do sha256 de $(basename "$arquivo")"; return 0; fi
  [ -f "$sha" ] || falhar "Falta o checksum $sha. Gere com: (cd $(dirname "$arquivo") && sha256sum $(basename "$arquivo") > $(basename "$sha")) ou rode com --force"
  (cd "$(dirname "$arquivo")" && sha256sum -c --quiet "$(basename "$sha")") || falhar "sha256 de $(basename "$arquivo") não bate com $sha. Baixe de novo (ou --force para instalar mesmo assim)"
  log "sha256 de $(basename "$arquivo") conferido"
}

# cp -a de um volume para outro (o destino já existe).
copiar_volume() {
  docker run --rm -v "$1:/de:ro" -v "$2:/para" "$COPIADOR" sh -c "cp -a /de/. /para/" >/dev/null
}

if [ "$ABI" = "x86_64" ]; then
  if [ -z "$VERSAO" ]; then
    VERSAO="$(ls -d "$APKS"/x86-*/ 2>/dev/null | sed -E 's#.*/x86-([^/]+)/?$#\1#' | sort -V | tail -1 || true)"
  fi
  APK_DIR="$APKS/x86-${VERSAO}"
  APK_ARQUIVOS=("$APK_DIR/base.apk" "$APK_DIR/split_config.xxhdpi.apk")
  for a in "${APK_ARQUIVOS[@]}"; do
    [ -f "$a" ] || falhar "APK x86_64 não encontrado: $a (fixe base.apk + split_config.xxhdpi.apk + .sha256 em $APK_DIR/)"
    conferir_sha "$a"
  done
else
  if [ -z "$VERSAO" ]; then
    VERSAO="$(ls "$APKS"/instagram-*.apk 2>/dev/null | sed -E 's#.*/instagram-(.+)\.apk#\1#' | sort -V | tail -1 || true)"
  fi
  APK="$APKS/instagram-${VERSAO}.apk"
  [ -f "$APK" ] || falhar "APK não encontrado: $APK (copie instagram-<versão>.apk e instagram-<versão>.apk.sha256 para $APKS/)"
  conferir_sha "$APK"
  APK_ARQUIVOS=("$APK")
fi

# Navegador: Chrome pinado em $APKS/browser/chrome-<versão>/ (base + splits tirados do Aurora com pm path +
# adb pull), conferido pelo $APKS/browser/SHA256SUMS. O Estruturar usa quando a página do link abre sem sessão.
BROWSER_DIR="$APKS/browser"
CHROME_DIR="$(ls -d "$BROWSER_DIR"/chrome-*/ 2>/dev/null | sort -V | tail -1 || true)"
{ [ -n "$CHROME_DIR" ] && ls "$CHROME_DIR"*.apk >/dev/null 2>&1; } || falhar "Navegador não encontrado: fixe os APKs do Chrome em $BROWSER_DIR/chrome-<versão>/ e o SHA256SUMS em $BROWSER_DIR/"
if [ "$FORCE" = 1 ]; then
  log "AVISO: --force, pulando a conferência do sha256 do navegador"
else
  [ -f "$BROWSER_DIR/SHA256SUMS" ] || falhar "Falta $BROWSER_DIR/SHA256SUMS. Gere com: (cd $BROWSER_DIR && sha256sum chrome-*/*.apk > SHA256SUMS) ou rode com --force"
  (cd "$BROWSER_DIR" && sha256sum -c --quiet SHA256SUMS) || falhar "sha256 do navegador não bate com $BROWSER_DIR/SHA256SUMS"
  for a in "$CHROME_DIR"*.apk; do
    grep -q "[ *]$(basename "$CHROME_DIR")/$(basename "$a")\$" "$BROWSER_DIR/SHA256SUMS" || falhar "$(basename "$a") não está no SHA256SUMS do navegador"
  done
  log "sha256 do navegador conferido ($(basename "$CHROME_DIR"))"
fi

log "imagem $IMAGEM"
docker pull -q "$IMAGEM" >/dev/null

log "build.prop da imagem → $PROPS_NOVO (entra em $PROPS só na troca)"
rm -rf "$PROPS_NOVO"
mkdir -p "$PROPS_NOVO"
chmod 0700 "$PROPS_NOVO" 2>/dev/null || true
docker rm -f scalemaster-props >/dev/null 2>&1 || true
docker create --name scalemaster-props "$IMAGEM" >/dev/null
docker cp scalemaster-props:/system/build.prop "$PROPS_NOVO/system.prop"
docker cp scalemaster-props:/vendor/build.prop "$PROPS_NOVO/vendor.prop"
docker cp scalemaster-props:/product/etc/build.prop "$PROPS_NOVO/product.prop" 2>/dev/null || docker cp scalemaster-props:/product/build.prop "$PROPS_NOVO/product.prop"
docker rm -f scalemaster-props >/dev/null

log "volume temporário $NOVO_VOLUME (a base $BASE_VOLUME em uso fica como está)"
docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null 2>&1 || true
docker volume rm -f "$NOVO_VOLUME" >/dev/null 2>&1 || true
docker volume create "$NOVO_VOLUME" >/dev/null

log "subindo a base nova na vpsnet (porta adb 127.0.0.1:$PORTA), sem internet"
docker run -d --name "$BASE_CONTAINER" --privileged --network vpsnet --label scalemaster.vps=1 \
  -p "127.0.0.1:${PORTA}:5555" -v "$NOVO_VOLUME:/data" --memory 2g \
  "$IMAGEM" \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_width=1080 androidboot.redroid_height=1920 \
  androidboot.redroid_dpi=420 androidboot.redroid_fps=30 androidboot.use_memfd=true \
  androidboot.redroid_net_ndns=1 androidboot.redroid_net_dns1=1.1.1.1 >/dev/null
# Mesmo kill switch dos containers de conta (lib/rede.mjs, modo bloqueado): a base nunca sai para a internet.
docker run -d --name "${BASE_CONTAINER}-proxy" --network "container:${BASE_CONTAINER}" --cap-add NET_ADMIN scalemaster-redsocks:1 \
  sh -c 'iptables -A OUTPUT -o lo -j ACCEPT; iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A OUTPUT -j DROP; exec sleep infinity' >/dev/null
IP="127.0.0.1:${PORTA}"

log "esperando o Android (até 5 min) em $IP"
for i in $(seq 1 100); do
  if adb connect "$IP" >/dev/null 2>&1 && [ "$(adb -s "$IP" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    break
  fi
  sleep 3
  if [ "$i" = 100 ]; then docker logs --tail 30 "$BASE_CONTAINER" || true; falhar "a base nova não terminou de ligar"; fi
done
adb -s "$IP" root >/dev/null 2>&1 || true
sleep "${GOLDEN_ESPERA_ROOT:-2}"
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
  *) falhar "ABI_AUSENTE: ro.product.cpu.abilist=$ABILIST não traz $ABI" ;;
esac

log "instalando o Instagram: ${APK_ARQUIVOS[*]}"
if [ "$ABI" = "x86_64" ]; then
  adb -s "$IP" install-multiple -r -g "${APK_ARQUIVOS[@]}" | tail -1
else
  adb -s "$IP" install -r -g "${APK_ARQUIVOS[@]}" | tail -1
fi
adb -s "$IP" shell am force-stop com.instagram.android >/dev/null 2>&1 || true

log "instalando o navegador: $(basename "$CHROME_DIR")"
adb -s "$IP" install-multiple -r -g "$CHROME_DIR"*.apk | tail -1
# Sem a tela de boas-vindas nem o pedido de navegador padrão: o Chrome abre direto na página.
adb -s "$IP" shell "echo 'chrome --no-first-run --disable-fre --no-default-browser-check' > /data/local/tmp/chrome-command-line" >/dev/null 2>&1 || true
adb -s "$IP" shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true
adb -s "$IP" shell am force-stop com.android.chrome >/dev/null 2>&1 || true

# ── VERIFICAÇÃO OBRIGATÓRIA (antes de qualquer toque na base em uso; --force não pula) ──────────────────────
# pm list packages com o Chrome e o Instagram, e o primaryCpuAbi dos dois igual à ABI da VPS (x86_64 neste host).
log "verificando a base nova"
PACOTES="$(adb -s "$IP" shell pm list packages 2>/dev/null | tr -d '\r')"
for pacote in com.android.chrome com.instagram.android; do
  echo "$PACOTES" | grep -qx "package:$pacote" || falhar "VERIFICACAO: pm list packages não traz $pacote"
done
abi_de() { adb -s "$IP" shell dumpsys package "$1" 2>/dev/null | grep -m1 primaryCpuAbi | sed 's/.*primaryCpuAbi=//' | tr -d '\r'; }
versao_de() { adb -s "$IP" shell dumpsys package "$1" 2>/dev/null | grep -m1 versionName | sed 's/.*versionName=//' | tr -d '\r'; }
ABI_CHROME="$(abi_de com.android.chrome)"
[ "$ABI_CHROME" = "$ABI" ] || falhar "VERIFICACAO: primaryCpuAbi do Chrome é ${ABI_CHROME:-?}, esta VPS exige $ABI"
PRIMARIA="$(abi_de com.instagram.android)"
[ "$PRIMARIA" = "$ABI" ] || falhar "ABI_AUSENTE: o Instagram instalou como ${PRIMARIA:-?}, esta VPS exige $ABI"
INSTALADA="$(versao_de com.instagram.android)"
NAVEGADOR="$(versao_de com.android.chrome)"
log "verificado: com.android.chrome $NAVEGADOR ($ABI_CHROME) e com.instagram.android $INSTALADA ($PRIMARIA)"

log "parando a base nova"
adb disconnect "$IP" >/dev/null 2>&1 || true
docker stop -t 30 "$BASE_CONTAINER" >/dev/null
docker rm -f "${BASE_CONTAINER}-proxy" "$BASE_CONTAINER" >/dev/null

# ── TROCA: só daqui para baixo a base em uso é tocada ───────────────────────────────────────────────────────
log "trocando $BASE_VOLUME pela base nova (a anterior fica em $ANTERIOR_VOLUME)"
TINHA_BASE=0
if docker volume inspect "$BASE_VOLUME" >/dev/null 2>&1; then
  TINHA_BASE=1
  docker volume rm -f "$ANTERIOR_VOLUME" >/dev/null 2>&1 || true
  docker volume create "$ANTERIOR_VOLUME" >/dev/null
  # Se esta cópia falhar a base em uso ainda está inteira: sai sem trocar.
  copiar_volume "$BASE_VOLUME" "$ANTERIOR_VOLUME" || { docker volume rm -f "$ANTERIOR_VOLUME" >/dev/null 2>&1 || true; falhar "não consegui guardar a base anterior: nada foi trocado"; }
fi
docker volume rm -f "$BASE_VOLUME" >/dev/null
docker volume create --label scalemaster.vps=1 "$BASE_VOLUME" >/dev/null
if ! copiar_volume "$NOVO_VOLUME" "$BASE_VOLUME"; then
  log "a cópia para $BASE_VOLUME falhou: voltando a base anterior"
  docker volume rm -f "$BASE_VOLUME" >/dev/null 2>&1 || true
  if [ "$TINHA_BASE" = 1 ]; then
    docker volume create --label scalemaster.vps=1 "$BASE_VOLUME" >/dev/null
    copiar_volume "$ANTERIOR_VOLUME" "$BASE_VOLUME" || falhar "ATENÇÃO: a base anterior não voltou; ela está inteira em $ANTERIOR_VOLUME"
  fi
  falhar "troca desfeita: a base em uso é a anterior"
fi
rm -rf "$PROPS"
mv "$PROPS_NOVO" "$PROPS"
# Versão usada na base: o agente põe esta em primeiro na lista que a aba mostra.
echo "$VERSAO" > "$APKS/ATUAL"
TROCADA=1

TAMANHO="$(du -sh "$(docker volume inspect -f '{{.Mountpoint}}' "$BASE_VOLUME" 2>/dev/null)" 2>/dev/null | cut -f1 || true)"
echo "RESUMO: base pronta com Instagram ${INSTALADA:-$VERSAO} $ABI e Chrome $NAVEGADOR (imagem $IMAGEM, volume $BASE_VOLUME ${TAMANHO:-?}, props em $PROPS, $((SECONDS - INICIO)) s)"
