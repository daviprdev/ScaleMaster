#!/usr/bin/env bash
# Prova o kill switch de um container de conta, contra o container real:
#   (a) sidecar em modo bloqueado: DNS não resolve e TCP não abre;
#   (b) sidecar com a proxy do retrato: DNS resolve e TCP abre;
#   (c) o geo de dentro do netns devolve o país da proxy (nunca o da VPS);
#   (d) com o redsocks parado (sidecar fora), nada sai.
# Sai 0 só se os quatro passarem. No fim devolve o sidecar ao modo em que o
# container estava (proxy gravada → proxy; sem → bloqueado).
#
#   bash scripts/vps/provar-rede.sh <índice>        (container ig-<índice> ligado)
#
# As sondas rodam num container descartável no MESMO netns (--network
# container:ig-N), como root: em modo proxy o TCP dele é redirecionado para o
# redsocks igual ao dos apps; sem sidecar as regras continuam no netns.
set -uo pipefail

INDEX="${1:-}"
[[ "$INDEX" =~ ^[0-9]+$ ]] || { echo "uso: bash scripts/vps/provar-rede.sh <índice>"; exit 2; }
NOME="ig-$INDEX"
SIDECAR="$NOME-proxy"
RETRATO="/opt/scalemaster/vps/instancias/$NOME.json"
REDE_MJS="/opt/scalemaster/agente-vps/lib/rede.mjs"
IMAGEM="scalemaster-redsocks:1"
GEO_URL="http://ip-api.com/json/?fields=status,countryCode,query"

log() { echo "[provar-rede $(date +%H:%M:%S)] $*"; }

[ "$(docker inspect --format '{{.State.Status}}' "$NOME" 2>/dev/null)" = "running" ] || { log "$NOME não está ligado"; exit 2; }
[ -f "$RETRATO" ] || { log "retrato $RETRATO não existe"; exit 2; }
PROXY="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(s.proxy||"")' "$RETRATO")"
PAIS="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((s.device&&s.device.pais)||"")' "$RETRATO")"
[ -n "$PROXY" ] || { log "o retrato de $NOME não tem proxy gravada (rode a etapa geo/rede antes)"; exit 2; }
PROXY_HOST="$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.hostname)' "$PROXY")"

# Sonda no netns do container; devolve o código do comando.
sonda() { docker run --rm --network "container:$NOME" "$IMAGEM" sh -c "$1" 2>/dev/null; }
sonda_saida() { docker run --rm --network "container:$NOME" "$IMAGEM" sh -c "$1" 2>/dev/null || true; }

# Sobe o sidecar pelo mesmo código do agente (modo proxy ou bloqueado).
sidecar() {
  node -e 'import(process.argv[1]).then(m=>m.subirSidecar(process.argv[2], process.argv[3]||null)).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})' "$REDE_MJS" "$NOME" "${1:-}"
}

PASSOU=0
FALHOU=0
ok()   { PASSOU=$((PASSOU+1)); log "OK   $*"; }
nok()  { FALHOU=$((FALHOU+1)); log "FALHA $*"; }

# (a) bloqueado: DNS e TCP têm que falhar
log "(a) sidecar bloqueado"
sidecar "" || { log "não subiu o sidecar bloqueado"; exit 1; }
sleep 2
if sonda "nslookup -timeout=5 instagram.com 1.1.1.1 >/dev/null"; then nok "(a) DNS resolveu em modo bloqueado"; else ok "(a) DNS não resolve"; fi
if sonda "curl -sS -m 8 -o /dev/null http://1.1.1.1/"; then nok "(a) TCP abriu em modo bloqueado"; else ok "(a) TCP não abre"; fi

# (b) proxy: DNS e TCP têm que abrir
log "(b) sidecar com a proxy ($PROXY_HOST)"
sidecar "$PROXY" || { log "não subiu o sidecar com a proxy (proxy morta?)"; nok "(b) sidecar"; }
sleep 3
if sonda "nslookup -timeout=10 instagram.com 1.1.1.1 >/dev/null"; then ok "(b) DNS resolve pela proxy"; else nok "(b) DNS não resolveu com a proxy"; fi
if sonda "curl -sS -m 20 -o /dev/null https://www.instagram.com/"; then ok "(b) TCP abre pela proxy"; else nok "(b) TCP não abriu com a proxy"; fi

# (c) geo de dentro do netns = país da proxy
GEO="$(sonda_saida "curl -sS -m 20 '$GEO_URL'")"
GEO_PAIS="$(printf '%s' "$GEO" | sed -n 's/.*"countryCode":"\([A-Z][A-Z]\)".*/\1/p')"
GEO_IP="$(printf '%s' "$GEO" | sed -n 's/.*"query":"\([^"]*\)".*/\1/p')"
IP_VPS="$(curl -sS -m 10 "$GEO_URL" 2>/dev/null | sed -n 's/.*"query":"\([^"]*\)".*/\1/p')"
if [ -n "$GEO_PAIS" ] && { [ -z "$PAIS" ] || [ "$GEO_PAIS" = "$PAIS" ]; } && [ -n "$GEO_IP" ] && [ "$GEO_IP" != "$IP_VPS" ]; then
  ok "(c) geo dentro do netns: $GEO_IP ($GEO_PAIS), VPS é $IP_VPS"
else
  nok "(c) geo dentro do netns: '${GEO_PAIS:-?}' em ${GEO_IP:-?} (esperado país ${PAIS:-qualquer}, IP diferente de ${IP_VPS:-?})"
fi

# (d) redsocks parado: as regras ficam no netns e nada sai
log "(d) redsocks parado"
docker rm -f "$SIDECAR" >/dev/null 2>&1 || true
sleep 1
if sonda "nslookup -timeout=5 instagram.com 1.1.1.1 >/dev/null"; then nok "(d) DNS resolveu sem o redsocks"; else ok "(d) DNS não resolve sem o redsocks"; fi
if sonda "curl -sS -m 8 -o /dev/null http://1.1.1.1/"; then nok "(d) TCP abriu sem o redsocks"; else ok "(d) TCP não abre sem o redsocks"; fi
if sonda "curl -sS -m 8 -o /dev/null https://www.instagram.com/"; then nok "(d) HTTPS abriu sem o redsocks"; else ok "(d) nada sai sem o redsocks"; fi

# Devolve o sidecar ao modo gravado no retrato.
log "restaurando o sidecar (modo proxy)"
sidecar "$PROXY" || log "aviso: não consegui restaurar o sidecar com a proxy"

log "RESUMO: $PASSOU ok, $FALHOU falha(s)"
[ "$FALHOU" = 0 ]
