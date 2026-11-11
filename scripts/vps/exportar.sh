#!/usr/bin/env bash
# Exporta tudo o que a aba Contas VPS precisa para subir noutro host (ver MIGRACAO.md):
#   imagens Docker (redroid, sidecar, alpine) por docker save, cada volume com o
#   label scalemaster.vps (a base e as contas) em .tgz, as pastas de estado
#   (/opt/scalemaster/vps, apks, sessoes, midias), o .env e o config.json do
#   agente, a unit systemd, os arquivos de firewall e de módulos, e um MANIFESTO
#   com a arquitetura e o sha256 de cada arquivo.
#
#   bash scripts/vps/exportar.sh [pasta-destino] [--simular] [--com-ligados]
#
# Os containers de conta não são exportados: o agente recria cada um a partir
# do retrato (vps/instancias/ig-N.json) e do volume na primeira vez que liga.
# Por padrão recusa exportar com container de conta ligado (o volume estaria
# sendo escrito); --com-ligados exporta assim mesmo. --simular só mostra os comandos.
set -euo pipefail

RAIZ="${SCALEMASTER_RAIZ:-/opt/scalemaster}"
DESTINO=""
SIMULAR=0
COM_LIGADOS=0
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    --com-ligados) COM_LIGADOS=1 ;;
    *) DESTINO="$arg" ;;
  esac
done
DESTINO="${DESTINO:-$RAIZ/migracao-$(date +%Y%m%d-%H%M)}"
ARCH="${SCALEMASTER_ARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64; IMAGEM_REDROID="redroid/redroid:13.0.0-latest" ;;
  aarch64|arm64) ARCH=arm64; IMAGEM_REDROID="redroid/redroid:13.0.0_64only-latest" ;;
  *) echo "arquitetura sem imagem do redroid: $ARCH" >&2; exit 1 ;;
esac
IMAGENS=("$IMAGEM_REDROID" "scalemaster-redsocks:1" "alpine:3.20")
COPIADOR="alpine:3.20"

log() { echo "[exportar $(date +%H:%M:%S)] $*"; }
# Em --simular só mostra; senão roda.
r() { if [ "$SIMULAR" = 1 ]; then echo "+ $*"; else "$@"; fi; }

LIGADOS="$(docker ps --filter label=scalemaster.vps=1 --format '{{.Names}}' | grep -E '^ig-[0-9]+$' || true)"
if [ -n "$LIGADOS" ] && [ "$COM_LIGADOS" != 1 ]; then
  echo "Containers de conta ligados: $(echo "$LIGADOS" | tr '\n' ' ')— desligue pela aba (ou rode com --com-ligados)." >&2
  exit 1
fi

log "destino $DESTINO ($ARCH)"
r mkdir -p "$DESTINO/volumes" "$DESTINO/sistema"

log "imagens: ${IMAGENS[*]}"
r docker save -o "$DESTINO/imagens.tar" "${IMAGENS[@]}"

VOLUMES="$(docker volume ls -q --filter label=scalemaster.vps=1 | sort)"
for v in $VOLUMES; do
  log "volume $v"
  r docker run --rm -v "$v:/de:ro" -v "$DESTINO/volumes:/para" "$COPIADOR" tar -czf "/para/$v.tgz" -C /de .
done

log "pastas de estado (vps, apks, sessoes, midias; sem os prints)"
r tar -czf "$DESTINO/dados.tgz" -C / --exclude="${RAIZ#/}/vps/prints" \
  "${RAIZ#/}/vps" "${RAIZ#/}/apks" "${RAIZ#/}/sessoes" "${RAIZ#/}/midias"

log "agente: .env e config.json (0600)"
r tar -czf "$DESTINO/agente.tgz" -C "$RAIZ/agente-vps" --ignore-failed-read .env config.json
r chmod 600 "$DESTINO/agente.tgz"

log "sistema: unit, firewall e módulos"
for f in /etc/systemd/system/scalemaster-vps-agent.service /etc/default/ufw /etc/ufw/user.rules /etc/ufw/user6.rules \
  /etc/modules-load.d/redroid.conf /etc/modprobe.d/redroid.conf /etc/modules-load.d/scalemaster-vps.conf; do
  if [ -f "$f" ] || [ "$SIMULAR" = 1 ]; then r cp -p "$f" "$DESTINO/sistema/$(echo "${f#/}" | tr / _)"; fi
done

log "MANIFESTO"
if [ "$SIMULAR" = 1 ]; then
  echo "+ MANIFESTO: arch=$ARCH imagens=${IMAGENS[*]} volumes=$(echo $VOLUMES | tr '\n' ' ')"
else
  {
    echo "arch=$ARCH"
    echo "imagem_redroid=$IMAGEM_REDROID"
    echo "imagens=${IMAGENS[*]}"
    echo "volumes=$(echo $VOLUMES | tr '\n' ' ')"
    echo "exportado_em=$(date -Iseconds)"
    echo "host=$(hostname)"
  } > "$DESTINO/MANIFESTO"
  (cd "$DESTINO" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum > SHA256SUMS)
  chmod 700 "$DESTINO"
fi

echo "RESUMO: exportado para $DESTINO ($ARCH, $(echo $VOLUMES | wc -w) volume(s))$( [ "$SIMULAR" = 1 ] && echo " [simulado]" || echo ", $(du -sh "$DESTINO" | cut -f1)")"
