#!/bin/sh
# Entrypoint do serviço de cron.
# Grava CRON_SECRET + WEB_INTERNAL_URL num arquivo que os jobs sourcam
# (busybox crond não repassa o environment do container aos jobs) e sobe o
# crond em foreground para manter o container vivo e logar em stdout.

set -eu

if [ -z "${CRON_SECRET:-}" ]; then
  echo "ERRO: CRON_SECRET não definido — os crons não seriam autenticados. Abortando." >&2
  exit 1
fi

WEB_INTERNAL_URL="${WEB_INTERNAL_URL:-http://web:3000}"

cat > /etc/cron-env <<EOF
export CRON_SECRET='${CRON_SECRET}'
export WEB_INTERNAL_URL='${WEB_INTERNAL_URL}'
EOF
chmod 600 /etc/cron-env

echo "[cron] iniciando — alvo: ${WEB_INTERNAL_URL} — 13 jobs carregados de /etc/crontabs/root"

# -f: foreground | -l 8: loglevel info | -L /dev/stdout: log do crond em stdout
exec crond -f -l 8 -L /dev/stdout
