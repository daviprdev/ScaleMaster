# AutoScale — serviço de cron
# Alpine + busybox crond + curl. Reproduz os 13 Cron Jobs do vercel.json,
# batendo nos endpoints do serviço "web" pela rede interna do compose.
FROM alpine:3.20

RUN apk add --no-cache curl

# crontab exato (5 campos, UTC) + scripts
COPY crontab /etc/crontabs/root
COPY run-cron.sh /usr/local/bin/run-cron.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/run-cron.sh /usr/local/bin/entrypoint.sh \
    && chmod 600 /etc/crontabs/root

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
