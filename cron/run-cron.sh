#!/bin/sh
# Dispara UM endpoint de cron no serviço "web", autenticado com CRON_SECRET.
# Uso: run-cron.sh /api/cron/<nome>
#
# crond (busybox) roda os jobs com um ambiente mínimo, então lemos as variáveis
# de um arquivo gravado pelo entrypoint em vez de confiar no environment herdado.

set -eu

# shellcheck disable=SC1091
. /etc/cron-env

path="$1"
ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

code="$(
  curl -sS -m 300 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${WEB_INTERNAL_URL}${path}" 2>/tmp/curl_err
)" || {
  echo "[cron ${ts}] ${path} -> FALHA: $(cat /tmp/curl_err)"
  exit 0
}

echo "[cron ${ts}] ${path} -> HTTP ${code}"
