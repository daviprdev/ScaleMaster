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

`dados.json`: `{ "proxy": "http://u:s@host:porta", "pais": "BR", "versaoIg": "309.0.0.40.113", "provedorEmail": "portal|mailtm|imap|manual", "conta": { "email", "senha", "nome", "usuario", "nascimento" }, "imap": { "host", "porta", "usuario", "senha" } }`. Sem `device`, a identidade é gerada na hora.

## Provedor de e-mail (`fluxos/caixa.mjs`)

Os campos são sempre os mesmos (`conta.email` + `imap.senha`); o provedor muda o significado:

| Provedor | `conta.email` | `imap.senha` | Como lê o código |
| --- | --- | --- | --- |
| `portal` (padrão da aba) | link do painel (`https://hridoyhub.shop/OTP/`) | código de resgate do hstock (6–12 letras/números) | `lib/portal.mjs`: `POST <link> code=…` → `/OTP/<CÓDIGO>` (endereço em `#email`), `/OTP/<CÓDIGO>/status` a cada 3 s (`mails[].otp`); sessão vencida sem OTP é renovada (`/reactivate`) |
| `mailtm` | endereço no mail.tm | senha da conta | `lib/mailtm.mjs` (API pública, token + `/messages`) |
| `imap` | endereço | senha (de app) | `lib/imap.mjs` (`imap.host`/`imap.porta`) |
| `manual` | endereço | — | nada: o código é pedido na aba |

A linha do hstock (`link | código`) pode ser colada inteira no campo do link (aba e API separam). A sessão do portal dura 20 min: ela só abre na tela "Qual é o teu e-mail" do Instagram, nunca no início do job; a etapa `email` apenas confere que o link mostra o form de resgate. Qualquer falha do portal (fora do ar, timup, markup, Cloudflare) vira pergunta `codigo` na aba, sem derrubar o job; o código de resgate aparece mascarado no log (`SU****AY`).

`PORTAL_MODO=http` (padrão, `node:https` com cookie jar e User-Agent de Chrome) ou `PORTAL_MODO=browser` no `.env` do agente: `playwright-core` de `/opt/scalemaster/portal` (instalado pelo `instalar.sh`) ligado por CDP ao Chromium isolado no container `scalemaster-portal-chrome` (`zenika/alpine-chrome`, só em `127.0.0.1:9222`). Nos dois caminhos a sessão é fechada sempre, inclusive em erro.

## Como uma conta é criada (`fluxos/nova-conta.mjs`)

Mesmas chaves de `VPS_FLUXO` em `lib/vps/jobs.ts`; o Continuar retoma da etapa que falhou.

1. **copiar** — volume novo a partir de `scalemaster-base` (4 GB de cota; `lib/disco.mjs`), retrato em `/opt/scalemaster/vps/instancias/ig-N.json`, container `ig-N` criado parado.
2. **ids** / **fingerprint** — Android ID, serial, MAC, modelo, fabricante, fingerprint, fuso e idioma do perfil que o servidor gerou (`lib/fingerprint.mjs`). Modelo/fingerprint entram por `build.prop` montados por cima dos da imagem; serial pela cmdline (`androidboot.serialno`); MAC pelo Docker; Android ID/fuso/idioma por adb no boot. Divergência no `getprop` depois do boot = falha.
3. **geo** — `curl -x proxy` no endpoint de geo: exige HTTP 200 e o país da conta, em 15 s. Falha → `PROXY_MORTA`, a conta fica pausada na aba até trocar a proxy (sem fallback ao IP da VPS).
4. **nome**, **abrir** — liga o container com o sidecar em modo **bloqueado** (nada sai) e prova o kill switch.
5. **instagram** — `adb install` do APK pinado (sem Aurora, sem internet).
6. **rede** — sidecar `ig-N-proxy` no netns do container: gost em modo `red` (redirecionador transparente para a proxy HTTP; o redsocks 0.5 do Alpine trava no CONNECT, por isso o gost) com o uid fixo 60000 (usuário `redsocks` — 1000/2000 são system/shell do Android, 10000+ os apps) + `iptables -t nat OUTPUT REDIRECT` (todo TCP → gost; o DNS do Android aponta para o IP do próprio container, onde o unbound do sidecar atende na 53 e encaminha por TCP com o uid do redsocks; udp/53 para outro IP cai no REDIRECT, 127.0.0.11 do Docker é DROP: o DNS nunca sai pelo resolver da VPS) + `udp/443 REJECT` (derruba o QUIC) + `OUTPUT DROP` no fim; confere de dentro do netns que a saída é a proxy. As regras são aplicadas pelo próprio sidecar (`--cap-add NET_ADMIN`, `sidecar.sh`) a cada boot dele — o script zera e recria as chains, então um restart do sidecar (`--restart unless-stopped`) reaplica tudo — e o agente só trata o container como ligado depois de o sidecar estar de pé: se ele não sobe, `abrir()` desliga o container na hora (nunca fica ligado sem regra). O redroid exige `--privileged`: `cap-drop` não se aplica ao container da conta, por isso o kill switch fica no netns, não nas capabilities.
7. **limpar**, **email** (prova a caixa: login IMAP/mail.tm, ou só o link do portal), **cadastro** — telas pelo texto (`fluxos/cadastro.mjs`); o endereço e o código de confirmação vêm da caixa do provedor (`fluxos/caixa.mjs`: portal, mail.tm ou IMAP, até 2 tentativas) antes de perguntar na aba; captcha de imagem vai para o Capsolver (`lib/captcha.mjs`) até 3 vezes; telefone ou captcha sem solução encerram com o aviso em vermelho, igual ao MuMu.
8. **perfil** — foto sorteada de `/opt/scalemaster/midias/perfil` (ou da pasta toda), nome de exibição e bio.
9. **seguir**, **reels** — aquecimento (2–3 verificados, até 2 min de Reels).
10. **sessao** — `adb root` (ou `su 0`) + `tar` de `/data/data/com.instagram.android` puxado para `/opt/scalemaster/sessoes/<jobId>.tgz` (chmod 600, pasta 0700); falha aqui não derruba a conta.
11. **fechar** — Instagram parado e `docker stop`; roda de novo em todo Continuar.

Supervisor (`lib/supervisor.mjs`): semáforos de ligadas e de cadastro, watchdog de 1 h sem progresso (desliga o container e a conta para), e no boot do agente todo container de conta ligado sem conta em andamento é desligado.

## Teclado, sessão, navegador e órfãos (10/11)

- **Teclado ADB** (`lib/teclado.mjs`): `/opt/scalemaster/apks/adbkeyboard.apk` (ADBKeyboard 2.0 de github.com/senzhk/ADBKeyBoard, `adbkeyboard.apk.sha256` ao lado) é instalado na etapa **instagram** quando o container não tem, e definido como padrão (`ime set com.android.adbkeyboard/.AdbIME`). `d.digitar()` manda o texto por `am broadcast -a ADB_INPUT_TEXT --es msg '<texto>'` — aceita acento e emoji — e cai no `input text` se o broadcast falhar; texto não ASCII nesse caso para a etapa com `TECLADO_INDISPONIVEL`.
- **Sessão** (`conferirSessao`): a etapa **sessao** do Estruturar roda antes da foto e exige a barra de navegação ou o @ da conta no dump. Tela de login, ou 90 s sem nenhum dos dois, = `SESSAO_PERDIDA`: o job para e o container é desligado; a conta não é descartada.
- **Navegador**: Chrome x86_64 pinado em `/opt/scalemaster/apks/browser/chrome-<versão>/` (base + splits tirados do Aurora com `pm path` + `adb pull`) e `browser/SHA256SUMS`. O `scripts/vps/golden.sh` confere o sha256 e instala na base; containers criados antes do Rebuild imagem não têm. Página do link sem sessão e container sem `com.android.chrome` = `SEM_NAVEGADOR`.
- **Esperas**: foto, bio, story e destaque não têm pausa fixa — cada toque espera o dump mudar (`tocarAteMudar`, 6 s, toca de novo uma vez; publicar e salvar não repetem) e cada campo espera o foco e o texto aparecer (`preencherEsperando`).
- **Órfãos**: no primeiro sync depois do boot o SaaS manda os containers que conhece (`vps_devices` e contas da fila); `ig-N` fora dessa lista, sem job ativo e parado há mais de 24 h leva `docker rm` (o sidecar junto), com log. O volume e o retrato ficam.

## Concorrência

Os dois limites saem das vCPUs do host e vão no sync, em `capacity`:

| vCPU | `maxLigadas` = clamp(vCPU ÷ 2, 1, 8) | `maxCadastro` = clamp(vCPU ÷ 2, 1, 4) |
| ---- | ------------------------------------ | ------------------------------------- |
| 1–3  | 1                                    | 1                                     |
| 4    | 2                                    | 2                                     |
| 8    | 4                                    | 4                                     |
| 16+  | 8                                    | 4                                     |

- `maxCadastro` nunca passa de `maxLigadas`. O servidor entrega no máximo `maxCadastro` jobs por vez (`syncJobs`); o que passar disso fica `queued`, sem container. Os semáforos do agente são a segunda trava.
- O container sobe uma vez por job, na etapa **abrir**, e fica de pé até a **fechar**: nenhuma etapa do meio dá stop/start (a troca de proxy reinicia só o sidecar).
- Host com menos de 4 vCPU roda um por vez e o card do agente mostra "host pequeno, 1 por vez".

## Host de teste e teto de 1 container

Este host (2 vCPU / 8 GB) liga **um container de conta por vez** (`maxLigadas = maxCadastro = 1`, aviso "host pequeno, 1 por vez" no card). Cada container tem teto de `--cpus 2` e `--memory 2048m`, e o lote só é aceito com `maxLigadas × 1600 MB` livres no host (lidos pelo app na hora do envio).

Num host de teste, onde a RAM livre fica abaixo disso por causa de outras coisas (o `teste-ig`, o build do app), o bloqueio vira aviso com `HOST_TESTE=1` no `.env` do agente:

```
echo HOST_TESTE=1 >> /opt/scalemaster/agente-vps/.env
systemctl restart scalemaster-vps-agent
```

O agente manda `hostTeste: true` na capacidade; o envio passa e o card mostra em amarelo "RAM insuficiente: X MB livres para 1 conta · host de teste: envio liberado". Sem a linha (ou com qualquer outro valor) volta a bloquear. O teto de 1 container continua valendo: o lote entra na fila e roda uma conta de cada vez.

## Migrar para outro host

Ver [MIGRACAO.md](MIGRACAO.md): `scripts/vps/exportar.sh` no host antigo, `scripts/vps/importar.sh` no novo.

## Firewall (ufw) e Docker

Com o ufw ativo e as políticas padrão (`INPUT` e `FORWARD` em `DROP`), os containers não falam com o host nem são encaminhados pelas bridges criadas depois: em 10/11 o `teste-ig` não alcançava o gost do host (`172.17.0.1:18080`) e ficou sem internet. O que está aplicado na VPS (e o `scripts/vps/instalar.sh` repete, de forma idempotente):

```
# /etc/default/ufw
DEFAULT_FORWARD_POLICY="ACCEPT"

ufw allow from 10.77.0.0/16        # bridges dos lotes (10.77.<n>.0/24) → host
ufw allow from 172.17.0.0/16       # bridge padrão do Docker (teste-ig → gost do host)
ufw route allow in on vpsnet+      # saída das bridges vpsnet, vpsnet1 … vpsnet254
ufw route allow out on vpsnet+     # volta para elas
ufw reload
```

- As regras de rota são `in on vpsnet+` e `out on vpsnet+`, **sem** `out on any` / `in on any`: nessa forma o ufw gera `-o any` / `-i any`, o nome de uma interface que não existe, e a regra não casa com nada.
- Persistência: a política fica em `/etc/default/ufw` e as regras em `/etc/ufw/user.rules`; valem depois de reboot. Conferir com `ufw status verbose` — tem que mostrar `allow (routed)`, as duas linhas `ALLOW IN` das sub-redes e as duas `ALLOW FWD` de `vpsnet+`.
- Cópia do arquivo de antes: `/etc/default/ufw.antes-2026-11-11`.
- Isso não abre nada para a internet: as portas publicadas pelo Docker continuam só em `127.0.0.1`, e a saída das contas continua presa ao sidecar (kill switch no netns).
- Prova de dentro do `teste-ig`: `nsenter -t $(docker inspect -f '{{.State.Pid}}' teste-ig) -n curl -x http://172.17.0.1:18080 https://ipinfo.io/json` (tem que sair pelo IP da proxy) e `adb -s 127.0.0.1:6000 shell ping -c 1 instagram.com` (tem que resolver o nome). O Android 13 não tem `getprop net.dns*`; o DNS em uso aparece em `dumpsys connectivity | grep DnsAddresses`.

## Base (golden) sem risco

`scripts/vps/golden.sh` monta a base nova no volume temporário `scalemaster-base-novo`, instala o Instagram e o Chrome pinados e só troca `scalemaster-base` depois da verificação obrigatória: `pm list packages` com `com.android.chrome` e `com.instagram.android`, e `primaryCpuAbi` dos dois igual à ABI da VPS (x86_64 aqui). Falha em qualquer ponto antes disso apaga só os temporários; a base em uso não é tocada. Na troca, a base anterior fica em `scalemaster-base-anterior` (uma geração) e volta sozinha se a cópia falhar. Os temporários não levam o label `scalemaster.vps`, para o prune do agente não apagá-los.

## Preenchimento de campo

`preencherEsperando` (`fluxos/tela.mjs`) usa duas leituras de tela no máximo: a de quem achou o campo e uma de verificação. No meio: um toque, a espera do teclado pelo `dumpsys input_method` (`mInputShown=true`, ~60 ms, sem uiautomator), o broadcast do texto. O dump de verificação fica guardado no `Dispositivo` (`telaAtual()`) e só é descartado por uma ação que muda a tela (toque, tecla, texto, abrir/fechar app). Se o campo aparece vazio na verificação, repete do toque uma vez, sem dump antes de digitar. Neste host um dump leva ~2,3 s; o campo fecha em menos de 6 s. O broadcast vai com `--receiver-foreground`: sem a flag, logo depois de o Instagram abrir, ele esperava 4–9 s na fila de segundo plano do Android.

## Isolamento

**Por que a proxy fica no netns e não num app de VPN.** Um app de VPN (NekoBox, como no MuMu) roda dentro do Android: o Instagram enxerga a interface `tun0`, o app instalado e o estado "VPN ativa" (`ConnectivityManager`), e se o app morre ou demora a subir o tráfego sai direto pelo IP da máquina. Aqui o redirecionamento é feito de fora, por um segundo container (o sidecar) que divide o network namespace com o Android: `iptables` manda todo TCP para o gost, o DNS para o unbound, derruba o QUIC e termina em `DROP`. Dentro do Android não existe interface, app nem permissão a mais — a rede parece uma conexão comum — e não há caminho sem proxy: sidecar fora do ar = nada sai.

**O que o container isola, por conta:**

- rede: namespace próprio, IP e MAC únicos e uma proxy fixa só dela (dedupe por `host:porta:usuário`: o mesmo usuário repetido bloqueia o envio; a mesma host:porta com outro usuário — gateway rotativo — só avisa);
- um /24 por lote (`10.77.<n>.0/24`, bridge `vpsnet-<n>`; as contas antigas ficam em `10.77.0.0/24`): contas de lotes diferentes não se enxergam na rede local;
- disco: volume `/data` próprio (apps, sessão, Android ID);
- identidade: `ro.serialno`, Android ID, MAC, IMEI e fingerprint sorteados por conta; fuso e idioma do país da proxy dela; `--hostname` com o modelo do aparelho;
- processos: PID namespace próprio; teto de `--cpus max(1, floor(vCPU ÷ maxLigadas))` (2 neste host) e `--memory`/`--memory-swap 2048m`, para um container não tomar a máquina do outro. A cota entra no `docker create` e, ao ligar, por `docker update` (vale para os containers criados antes dela).
- memória do host: o lote só é aceito com `MemAvailable` ≥ `maxLigadas × 1600` MB, lido pelo app do `/proc/meminfo` na hora do envio (app e agente na mesma VPS). O card do agente mostra a RAM livre (vermelho abaixo de 2000 MB), o motivo do bloqueio e os 5 processos com mais RSS (`ps` + cgroup, mandados pelo agente a cada 30 s).

**O que ele não isola:**

- o kernel é o do host e é o mesmo para todos: versão do kernel, `/proc/cpuinfo` (modelo e quantidade de CPUs do servidor), `/proc/meminfo` e uptime são iguais em todas as contas;
- hardware: mesma GPU por software (SwiftShader), mesmo conjunto de sensores (nenhum), mesma lista de ABI (`x86_64` num aparelho que se diz ARM);
- relógio: é o do host (só o fuso muda);
- o container é `--privileged` (o redroid exige): não é barreira de segurança contra o que roda dentro dele — é separação entre contas, não sandbox;
- as contas de um mesmo lote dividem a bridge do lote (alcançam umas às outras em L2); a saída para a internet de cada uma continua sendo só a própria proxy.

IP e MAC são conferidos duas vezes antes de o container existir: no servidor, ao enviar o lote (MAC contra `vps_devices`, IP contra as identidades das outras contas), e no agente, antes do `docker create` (contra os containers que existem no Docker e os retratos). Colisão aborta o job com `ISOLAMENTO: …`.

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

## Aquecimento sem Explorar e código do portal vencido (08/11)

No redroid x86 a aba de pesquisa/Explorar do Instagram derruba o app (SIGSEGV na RenderThread, ANGLE+SwiftShader). Por isso o `seguir` abre cada perfil pelo deep link `am start -a VIEW -d instagram://user?username=<x> -p com.instagram.android -f 0x20000000`, espera o botão Seguir no dump (20 s), toca e confirma "Seguindo"; se o deep link não abrir, tenta a pesquisa uma vez e pula o verificado. O `reels` não entra mais no Explorar: alterna ~25 s rolando a grade de um perfil verificado e ~25 s rolando o feed inicial (enquanto o feed não derrubar o app). O QuickSearchBox do Android fica desativado (`pm disable-user com.android.quicksearchbox`).

Código do portal: o resgate acontece só na tela do e-mail; a hora do resgate e o fim da sessão (20 min) vão no andamento (`portal`) e o servidor grava em `input_enc` (`portalResgatadoEm`/`portalExpiraEm`). Se um Continuar chegar na etapa `email` com a sessão vencida ou com OTP já recebido, a conta para com `CODIGO_VENCIDO`, o container fica ligado e o card pede código novo (Editar); nunca se reusa o mesmo código. Código ainda não resgatado não é tocado (só o form do link é conferido).

## Captcha e @ recusado = conta descartada

Tela "Confirme que você é uma pessoa" (ou verificação/reCAPTCHA) na etapa `cadastro`: sem tentativa de resolução (`lib/captcha.mjs` fica dormente, `CAPSOLVER_KEY` é opcional). O fluxo lança `ContaTravada(ALERTA_ROBO)`, apaga container, sidecar e volume na hora e manda `descartada: true` no andamento; o servidor marca `vps_devices.status = 'descartada'` e a proxy fica livre para outro lote. O card mostra o badge vermelho "Captcha — conta descartada", sem Continuar; "Tentar de novo" cria uma conta nova do zero (device, proxy, código do portal e pessoa novos). O mesmo vale para `ALERTA_USUARIO`: @ recusado 5 vezes seguidas (cada tentativa põe mais dígitos, `lib/usuario.mjs`); o @ que o Instagram aceita vai no andamento (`usuario`) e o servidor grava em `input_enc`, no label e em `vps_devices.usuario`.

SQL manual depois desta versão (`supabase/vps_contas.sql`): status `descartada` no check de `vps_devices` e a coluna `usuario`.

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
