# Migrar as Contas VPS para outro host

Tudo o que uma conta precisa para voltar a funcionar noutro host: a imagem do
redroid, a imagem do sidecar, o volume de cada conta (o `/data` do Android:
Instagram instalado, sessão, Android ID), o retrato de cada container
(`/opt/scalemaster/vps/instancias/ig-N.json`: identidade, proxy, rede, volume),
os build.prop por conta, os APKs pinados, as sessões exportadas, as mídias, o
`.env` e o `config.json` do agente, a unit systemd, o firewall e os módulos do
kernel.

Os **containers** de conta não são copiados. O agente recria o container `ig-N`
a partir do retrato e do volume na primeira vez que a conta liga (`abrir()` →
`criarContainer`), com a mesma identidade, a mesma rede `/24` do lote, o mesmo
IP e MAC e a cota do host novo. Por isso não há `docker export` de container:
o que vai é o volume, por `tar` (um container `alpine` monta o volume e
empacota o conteúdo).

## Resumo

No host antigo:

```
bash /opt/scalemaster/scripts/vps/exportar.sh /opt/scalemaster/migracao   # --simular mostra os comandos
rsync -a --progress /opt/scalemaster/migracao/ root@HOST_NOVO:/opt/scalemaster/migracao/
```

No host novo (Ubuntu com Docker):

```
git clone https://github.com/daviprdev/ScaleMaster /opt/scalemaster
bash /opt/scalemaster/scripts/vps/instalar.sh                              # adb, Node, binder, sidecar, bridge, ufw
bash /opt/scalemaster/scripts/vps/importar.sh /opt/scalemaster/migracao    # --simular mostra os comandos
```

O agente sobe conectado com o mesmo código (`.env`/`config.json`) e a aba
continua mostrando as mesmas contas: a VPS é a mesma para o SaaS.

## O que o exportar.sh grava

| Arquivo | Conteúdo | Como sai |
| --- | --- | --- |
| `imagens.tar` | `redroid/redroid:13.0.0-latest` (x86_64) ou `:13.0.0_64only-latest` (arm64), `scalemaster-redsocks:1` (sidecar, construída pelo `instalar.sh`, não existe em registry) e `alpine:3.20` (cópia de volumes) | `docker save` |
| `volumes/<volume>.tgz` | cada volume com o label `scalemaster.vps=1`: a base `scalemaster-base` e o de cada conta (`scalemaster-ig-N`) | `docker run alpine tar -czf` |
| `dados.tgz` | `/opt/scalemaster/vps` (retratos, props por conta, props da base, script do sidecar), `apks`, `sessoes`, `midias` — sem os prints | `tar` |
| `agente.tgz` | `agente-vps/.env` (`SCALEMASTER_AGENT_TOKEN`, `CAPSOLVER_KEY`, `HOST_TESTE`…) e `config.json`, permissão 0600 | `tar` |
| `sistema/` | unit `scalemaster-vps-agent.service`, `/etc/default/ufw`, `user.rules`/`user6.rules` (só referência), configs de módulos (`binder`, `xt_owner`…) | `cp -p` |
| `MANIFESTO` | arquitetura, imagens, volumes, data e host de origem | — |
| `SHA256SUMS` | hash de todos os arquivos | `sha256sum` |

Com container de conta ligado o script para (o volume estaria sendo escrito):
desligue pela aba antes. `--com-ligados` exporta assim mesmo.

## O que o importar.sh faz, na ordem

1. `sha256sum -c SHA256SUMS` e a arquitetura do `MANIFESTO` contra `uname -m` (diferente = para).
2. `docker load -i imagens.tar`.
3. Para cada `volumes/<volume>.tgz`: `docker volume create --label scalemaster.vps=1 <volume>` e desempacota dentro dele. Volume que já existe com dados = para (`--sobrescrever` substitui).
4. `dados.tgz` em `/` e `agente.tgz` em `/opt/scalemaster/agente-vps`.
5. Unit systemd e configs de módulos copiadas; `modprobe binder_linux`.
6. Firewall: as regras do `instalar.sh` (não o `user.rules` do host antigo, que traz as regras dele):
   `DEFAULT_FORWARD_POLICY="ACCEPT"`, `ufw allow from 10.77.0.0/16`, `ufw allow from 172.17.0.0/16`,
   `ufw route allow in on vpsnet+`, `ufw route allow out on vpsnet+`, `ufw reload`.
7. `systemctl daemon-reload` e `systemctl enable --now scalemaster-vps-agent`.

As bridges dos lotes (`vpsnet`, `vpsnet-<n>`) não são copiadas: o agente cria
cada uma quando o primeiro container daquele lote é recriado. A capacidade
(`maxLigadas`, `maxCadastro`, `--cpus`) é recalculada pelas vCPUs do host novo.

## Conferir depois

```
systemctl is-active scalemaster-vps-agent
tail -n 5 /opt/scalemaster/agente-vps/agente.log      # "Conectado ao SaaS. N container(s) de conta."
docker volume ls --filter label=scalemaster.vps=1
lsmod | grep binder
ufw status verbose                                    # allow (routed), 10.77.0.0/16, 172.17.0.0/16, vpsnet+
```

Na aba, ligue uma conta: o container é recriado, sobe com a proxy dela e a
sessão continua logada (a etapa `sessao` do Estruturar confere).

## Outra arquitetura (x86_64 ↔ arm64)

O `importar.sh` para quando a arquitetura muda, porque três coisas são por arquitetura:

| | x86_64 | arm64 |
| --- | --- | --- |
| Imagem do redroid | `redroid/redroid:13.0.0-latest` | `redroid/redroid:13.0.0_64only-latest` |
| Instagram | `apks/x86-<versão>/base.apk` + `split_config.xxhdpi.apk` (`install-multiple`); o arm64 crasha em 7 s (SIGSEGV em `libnb.so`) | `apks/instagram-<versão>.apk` |
| Chrome | `apks/browser/chrome-<versão>/` x86_64 | o mesmo esquema, com o build arm64 (Aurora no arm64 + `pm path` + `adb pull`) |
| `primaryCpuAbi` esperado | `x86_64` | `arm64-v8a` |
| Capacidade | `vCPU ÷ 2` (1 a 8 ligadas, 1 a 4 jobs) | igual |

A identidade das contas (retratos, Android ID, serial, MAC, rede) e as sessões
não dependem da arquitetura; o que muda são as bibliotecas nativas dentro de
cada volume. O caminho:

1. No host novo, `instalar.sh`; fixar os APKs da arquitetura nova em `apks/` (com `.sha256`) e o Chrome em `apks/browser/` (com `SHA256SUMS`).
2. `golden.sh` para gerar a base da arquitetura nova (não importe `scalemaster-base`).
3. Importar só os volumes de conta, `dados.tgz` e `agente.tgz` (os passos 3–7 do importar.sh à mão, pulando o `docker load` do redroid antigo e o volume `scalemaster-base`).
4. Para cada conta: ligar e reinstalar o Instagram e o Chrome por cima, mantendo os dados: `adb -s 127.0.0.1:<6000+N> install-multiple -r -g <apks da arquitetura nova>`. Conferir `primaryCpuAbi`.

## O que não vai

- Os prints do Estruturar (`vps/prints`): são regenerados a cada execução.
- Containers de teste (`teste-ig`, `proxy-teste`) e qualquer outro container fora do label `scalemaster.vps`.
- O app (Next.js) e o python-server: o deploy deles é o do `CLAUDE.md` (`git pull` + `docker compose`).
