# Agente VPS

Liga uma VPS com Docker + redroid à aba **Contas VPS** do Scale Master. Cada conta do Instagram roda no seu container redroid (Android 13, sem tela), com a sua proxy HTTP fixa e kill switch. Precisa só do Node 18+ (sem `npm install`); o resto é Docker, adb e iptables.

Por arquitetura (`lib/android.mjs` escolhe a imagem e confere a ABI depois do boot, antes de qualquer APK — falha = `ABI_AUSENTE`):

| Host | Imagem do redroid | Instagram em `/opt/scalemaster/apks` | Capacidade |
| --- | --- | --- | --- |
| arm64 (Hetzner CAX31, 8 vCPU / 32 GB) | `redroid/redroid:13.0.0_64only-latest` | `instagram-<versão>.apk` (`adb install -r`) | `maxLigadas = RAM/1400` → 23, `maxCadastro = max(2, vCPU/2)` → 4 |
| x86_64 (Hostinger KVM 2, 2 vCPU / 8 GB) | `redroid/redroid:13.0.0-latest` | `x86-<versão>/base.apk` + `split_config.xxhdpi.apk`, cada um com `.sha256` ao lado, conferido antes do `adb install-multiple -r` | `maxLigadas = max(1, vCPU/2)` → 1, `maxCadastro = 1` (nada vem da RAM) |

Em x86 o build arm64 do Instagram instala e crasha em 7 s (SIGSEGV em `libnb.so`): a etapa `instagram` exige `primaryCpuAbi=x86_64` no `dumpsys package`.

## Instalar (uma vez)

```
git clone https://github.com/daviprdev/ScaleMaster.git /opt/scalemaster
cd /opt/scalemaster
sudo bash scripts/vps/instalar.sh --apk <URL do instagram-<versão>.apk> --versao <versão>
sudo bash scripts/vps/golden.sh
```

`instalar.sh` instala Docker, Node, adb, o módulo `binder_linux` (pelo dkms de [redroid-modules](https://github.com/remote-android/redroid-modules) se o kernel não trouxer), cria a bridge `vpsnet` (10.77.0.0/24), os sysctl, a imagem do sidecar (`scalemaster-redsocks:1`, alpine + redsocks + iptables + curl), as pastas em `/opt/scalemaster/{apks,midias,sessoes,vps}` e a unit `scalemaster-vps-agent.service`. Sem `--apk`, copie você mesmo `instagram-<versão>.apk` para `/opt/scalemaster/apks` (o lote escolhe a versão).

`golden.sh` confere o `instagram-<versão>.apk.sha256` ao lado do APK (`sha256sum -c`; `--force` pula), sobe um redroid com fingerprint neutro e **sem internet**, instala o APK mais novo de `/opt/scalemaster/apks`, grava a versão em `/opt/scalemaster/apks/ATUAL`, extrai os `build.prop` da imagem para `/opt/scalemaster/vps/base` e guarda o volume `scalemaster-base`. O botão **Rebuild imagem** da aba roda este mesmo script pelo agente.

## Conectar a VPS

1. No Scale Master, aba Contas VPS → **Conectar uma VPS** → **Gerar código**.
2. Na VPS:

   ```
   cd /opt/scalemaster/agente-vps
   node agente.mjs conectar smag_...
   ```

3. Para o serviço (sobe sozinho com a máquina e reinicia se cair):

   ```
   # opcional: captcha de imagem pelo Capsolver (sem chave, o captcha vira pedido manual na aba)
   echo 'CAPSOLVER_KEY=...' >> /opt/scalemaster/agente-vps/.env   # ou "capsolverKey" no config.json
   systemctl enable --now scalemaster-vps-agent
   journalctl -u scalemaster-vps-agent -f
   ```

O código fica em `config.json` (fora do git, chmod 600) ou em `SCALEMASTER_AGENT_TOKEN=smag_...` dentro de `/opt/scalemaster/agente-vps/.env` (lido pela unit). O log fica em `agente.log` (rotação em 5 MB) e no journal.

## Testar sem o SaaS

```
node agente.mjs capacidade              maxLigadas / maxCadastro / APKs desta máquina
node agente.mjs instancias              containers de conta (índice, nome, estado)
node agente.mjs proxy http://u:s@host:porta BR    valida a proxy no endpoint de geo
node agente.mjs abrir 3 / fechar 3      liga/desliga o container ig-3
node agente.mjs tarefa teste-adb 3      prova adb + props
node agente.mjs tarefa rebuild-imagem   roda o golden.sh
node agente.mjs excluir 3               apaga container + volume (sem volta)
node agente.mjs nova-conta dados.json   roda o fluxo inteiro a partir da base
node scripts/vps/calibrar.mjs 3         mapa de toques, dpi, escala do print
```

`dados.json`: `{ "proxy": "http://u:s@host:porta", "pais": "BR", "versaoIg": "309.0.0.40.113", "conta": { "email", "senha", "nome", "usuario", "nascimento" }, "imap": { "host", "porta", "usuario", "senha" } }`. Sem `device`, a identidade é gerada na hora.

## Como uma conta é criada (`fluxos/nova-conta.mjs`)

Mesmas chaves de `VPS_FLUXO` em `lib/vps/jobs.ts`; o Continuar retoma da etapa que falhou.

1. **copiar** — volume novo a partir de `scalemaster-base` (4 GB de cota; `lib/disco.mjs`), retrato em `/opt/scalemaster/vps/instancias/ig-N.json`, container `ig-N` criado parado.
2. **ids** / **fingerprint** — Android ID, serial, MAC, modelo, fabricante, fingerprint, fuso e idioma do perfil que o servidor gerou (`lib/fingerprint.mjs`). Modelo/fingerprint entram por `build.prop` montados por cima dos da imagem; serial pela cmdline (`androidboot.serialno`); MAC pelo Docker; Android ID/fuso/idioma por adb no boot. Divergência no `getprop` depois do boot = falha.
3. **geo** — `curl -x proxy` no endpoint de geo: exige HTTP 200 e o país da conta, em 15 s. Falha → `PROXY_MORTA`, a conta fica pausada na aba até trocar a proxy (sem fallback ao IP da VPS).
4. **nome**, **abrir** — liga o container com o sidecar em modo **bloqueado** (nada sai) e prova o kill switch.
5. **instagram** — `adb install` do APK pinado (sem Aurora, sem internet).
6. **rede** — sidecar `ig-N-proxy` no netns do container: redsocks (http-connect, uid fixo 60000 — 1000/2000 são system/shell do Android, 10000+ os apps) + `iptables -t nat OUTPUT REDIRECT` (udp/53 → unbound do sidecar, que encaminha por TCP com o uid do redsocks; tcp/53 e todo TCP → redsocks: o DNS nunca sai pelo resolver da VPS) + `udp/443 REJECT` (derruba o QUIC) + `OUTPUT DROP` no fim; confere de dentro do netns que a saída é a proxy. As regras são aplicadas pelo próprio sidecar (`--cap-add NET_ADMIN`, `sidecar.sh`) a cada boot dele — o script zera e recria as chains, então um restart do sidecar (`--restart unless-stopped`) reaplica tudo — e o agente só trata o container como ligado depois de o sidecar estar de pé: se ele não sobe, `abrir()` desliga o container na hora (nunca fica ligado sem regra). O redroid exige `--privileged`: `cap-drop` não se aplica ao container da conta, por isso o kill switch fica no netns, não nas capabilities.
7. **limpar**, **email** (login IMAP), **cadastro** — telas pelo texto (`fluxos/cadastro.mjs`); o código de confirmação é lido na caixa por IMAP (`lib/imap.mjs`, até 3 min) antes de perguntar na aba; captcha de imagem vai para o Capsolver (`lib/captcha.mjs`) até 3 vezes; telefone ou captcha sem solução encerram com o aviso em vermelho, igual ao MuMu.
8. **perfil** — foto sorteada de `/opt/scalemaster/midias/perfil` (ou da pasta toda), nome de exibição e bio.
9. **seguir**, **reels** — aquecimento (2–3 verificados, até 2 min de Reels).
10. **sessao** — `adb root` (ou `su 0`) + `tar` de `/data/data/com.instagram.android` puxado para `/opt/scalemaster/sessoes/<jobId>.tgz` (chmod 600, pasta 0700); falha aqui não derruba a conta.
11. **fechar** — Instagram parado e `docker stop`; roda de novo em todo Continuar.

Supervisor (`lib/supervisor.mjs`): semáforos de ligadas e de cadastro, watchdog de 1 h sem progresso (desliga o container e a conta para), e no boot do agente todo container de conta ligado sem conta em andamento é desligado.

## Diagnóstico de proxy

```
node agente.mjs proxy http://u:s@host:porta BR          # vista da VPS
docker exec ig-3-proxy curl -sS -m 10 http://ip-api.com/json/   # vista de dentro do container
docker logs --tail 50 ig-3-proxy                         # redsocks
docker exec ig-3-proxy iptables -t nat -S OUTPUT          # regras
```

Com o sidecar em modo bloqueado o `curl` de dentro **tem** que falhar (kill switch). Sem sidecar nenhum, as regras somem com o netns ao desligar; ao ligar de novo o agente sobe o sidecar antes de qualquer app.

Prova do kill switch (E2E, com o container ligado), automatizada em `scripts/vps/provar-rede.sh <índice>`: (a) sidecar bloqueado → DNS não resolve e TCP não abre; (b) sidecar com a proxy do retrato → os dois abrem; (c) o geo de dentro do netns devolve o país da proxy; (d) com o redsocks parado nada sai. Sai 0 só com os quatro passando e devolve o sidecar ao modo que estava. À mão:

```
bash scripts/vps/provar-rede.sh 3
docker exec ig-3-proxy nslookup instagram.com 1.1.1.1      # bloqueado: falha; proxy: resolve
docker exec ig-3-proxy curl -sS -m 8 https://instagram.com  # bloqueado: falha; proxy: abre
docker exec ig-3-proxy curl -sS -m 8 http://ip-api.com/json/ # proxy: o IP é o da proxy, nunca o da VPS
```

Com a proxy morta a etapa `geo`/`rede` para com `PROXY_MORTA` e nada sai pelo IP da VPS (não existe fallback).

## Excluir

A lixeira na aba (ou `node agente.mjs excluir N`) confere o nome, desliga, apaga container, sidecar, volume, props e retrato, apaga os volumes com o label do Scale Master que não pertencem a nenhum retrato (nem à base) e tira a linha de `vps_devices`. Com a VPS offline o Remover é recusado (o comando expiraria e o container ficaria órfão).

## E2E real (checklist)

1. `golden.sh` termina com `RESUMO: base pronta…`.
2. `node agente.mjs instancias` lista vazio; `capacidade` mostra os APKs.
3. Na aba: Enviar lote de 1 com uma proxy boa → as 16 etapas ficam verdes e a conta termina "Conta criada"; `ls /opt/scalemaster/sessoes`.
4. Enviar lote de 1 com proxy morta → para em **geo** com `PROXY_MORTA`, badge "Pausada (proxy)"; Editar com proxy boa → volta para a fila e segue.
5. Com o container ligado em **abrir**, `docker exec ig-N-proxy curl -m 5 http://ip-api.com/` falha (kill switch).
6. Lote de 10 → 10 linhas em `vps_devices` com serial/MAC/android_id distintos e 10 containers `ig-N`.
7. Remover uma conta criada → `docker ps -a | grep ig-N` vazio, `docker volume ls | grep ig-N` vazio.
