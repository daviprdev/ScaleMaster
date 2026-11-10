import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { esperar, rodar, trecho } from "./processo.mjs";

/**
 * Rede de cada container: bridge vpsnet (10.77.0.0/24), IP e MAC fixos, e um
 * sidecar redsocks no MESMO netns (--network container:ig-N) que redireciona
 * todo TCP para a proxy HTTP da conta e descarta o resto (kill switch).
 *
 * Dois modos do sidecar:
 *   bloqueado — só DROP: o container liga sem internet nenhuma (instalar o
 *               APK é pelo adb, não precisa de rede);
 *   proxy     — redsocks + REDIRECT; DNS pelo proxy (dnsu2t: UDP 53 vira DNS
 *               sobre TCP, que também passa pelo redsocks).
 * Sem o sidecar as regras de nat ficam no netns apontando para uma porta sem
 * ninguém: continua sem internet. Nunca cai para o IP da VPS. As respostas às
 * conexões que entram (o adb pela porta publicada) passam pelo conntrack
 * ESTABLISHED; conexão nova para fora é o que o DROP segura.
 *
 * Como todo processo do Android roda no próprio netns, o tráfego é "local":
 * as regras vão na chain OUTPUT (PREROUTING só vê o que entra pela interface).
 */

export const REDE = "vpsnet";
export const SUBREDE = "10.77.0.0/24";
export const IMAGEM_SIDECAR = "scalemaster-redsocks:1";
const PORTA_REDSOCKS = 12345;
// decisão: o unbound escuta na 53 do IP do container e o Android aponta o dns1 para esse IP: o REDIRECT de UDP para loopback não fecha a volta no netns do redroid (testado), então o DNS não passa por NAT.
const PORTA_DNS = 53;
const DNS_REMOTO = "1.1.1.1";
export const PASTA_REDE = "/opt/scalemaster/vps/rede";

export const nomeSidecar = (container) => `${container}-proxy`;

/** IP fixo do container de índice n na bridge (1 é o gateway; 2..254 para contas). */
export function ipDe(index) {
  if (!Number.isInteger(index) || index < 1 || index > 252) throw new Error(`Índice ${index} fora da faixa da bridge (1–252).`);
  return `10.77.0.${index + 2}`;
}

/**
 * Rede do lote: 0 (ou ausente, contas antigas) = a bridge de sempre; n de 1 a
 * 254 = um /24 só daquele lote (10.77.n.0/24, bridge vpsnet-n). Lotes
 * diferentes não se enxergam: o Docker isola uma bridge da outra.
 */
export function redeDoLote(n) {
  const i = Number.isInteger(n) && n >= 1 && n <= 254 ? n : 0;
  if (i === 0) return { indice: 0, nome: REDE, subrede: SUBREDE, gateway: "10.77.0.1", bridge: "vpsnet" };
  return { indice: i, nome: `${REDE}-${i}`, subrede: `10.77.${i}.0/24`, gateway: `10.77.${i}.1`, bridge: `vpsnet${i}` };
}

/** IP do container de índice `index` na rede do lote n (mesma conta de lib/vps/device.ts). */
export function ipNaRede(n, index) {
  const rede = redeDoLote(n);
  if (rede.indice === 0) return ipDe(index);
  if (!Number.isInteger(index) || index < 1) throw new Error(`Índice ${index} inválido para a rede do lote.`);
  return `10.77.${rede.indice}.${2 + (index % 250)}`;
}

const IP_RE = /^10\.77\.(\d{1,3})\.(\d{1,3})$/;

/** Rede e IP de um container: os que o servidor gravou na identidade (device.rede / device.ip) ou, nas contas antigas, os de sempre. */
export function enderecoDe(device, index) {
  const rede = redeDoLote(device?.rede);
  const m = IP_RE.exec(String(device?.ip ?? ""));
  const valido = m && Number(m[1]) === rede.indice && Number(m[2]) >= 2 && Number(m[2]) <= 254;
  return { rede, ip: valido ? device.ip : ipNaRede(rede.indice, index) };
}

/**
 * IP ou MAC do container novo já usados por outro (containers vivos e
 * retratos): devolve o motivo, ou null. O job que bate aqui é abortado.
 */
export function colisao(novo, outros) {
  const mac = String(novo.mac ?? "").toLowerCase();
  for (const o of outros) {
    if (!o || o.nome === novo.nome) continue;
    if (novo.ip && (o.ips ?? []).includes(novo.ip)) return `o IP ${novo.ip} já é do container ${o.nome}`;
    if (mac && (o.macs ?? []).some((m) => String(m).toLowerCase() === mac)) return `o MAC ${novo.mac} já é do container ${o.nome}`;
  }
  return null;
}

/** IP e MAC de todos os containers do Scale Master que existem no Docker (ligados ou não). */
export async function enderecosVivos() {
  const lista = await rodar("docker", ["ps", "-a", "--filter", "label=scalemaster.vps=1", "--format", "{{.Names}}"], { timeoutMs: 20_000 });
  const nomes = String(lista.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const nome of nomes) {
    const r = await rodar(
      "docker",
      ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{if .IPAMConfig}}{{.IPAMConfig.IPv4Address}}{{end}},{{.IPAddress}},{{.MacAddress}};{{end}}", nome],
      { timeoutMs: 20_000 }
    );
    if (r.codigo !== 0) continue;
    const ips = [];
    const macs = [];
    for (const parte of trecho(r.stdout, 1000).split(";")) {
      const [fixo, atual, mac] = parte.split(",");
      for (const ip of [fixo, atual]) if (ip && !ips.includes(ip)) ips.push(ip);
      if (mac) macs.push(mac);
    }
    out.push({ nome, ips, macs });
  }
  return out;
}

/** http://usuario:senha@host:porta → partes. */
export function lerProxy(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !u.hostname || !u.port) throw new Error("Proxy sem host ou porta.");
  return { host: u.hostname, porta: Number(u.port), usuario: decodeURIComponent(u.username), senha: decodeURIComponent(u.password) };
}

/** Argumentos do docker network create da rede de um lote. */
export function argsDaRede(rede) {
  return ["network", "create", "--driver", "bridge", "--subnet", rede.subrede, "--gateway", rede.gateway, "-o", `com.docker.network.bridge.name=${rede.bridge}`, rede.nome];
}

/** Cria a bridge do lote se ainda não existe. */
export async function garantirRede(rede) {
  const ins = await rodar("docker", ["network", "inspect", rede.nome], { timeoutMs: 20_000 });
  if (ins.codigo === 0) return;
  const r = await rodar("docker", argsDaRede(rede), { timeoutMs: 60_000 });
  if (r.codigo !== 0) throw new Error(`docker network create ${rede.nome}: ${trecho(r.stderr)}`);
}

/** Apaga a bridge de um lote quando o último container dele sai (com container dentro o Docker recusa: fica). */
export async function soltarRede(rede) {
  if (rede.indice === 0) return;
  await rodar("docker", ["network", "rm", rede.nome], { timeoutMs: 30_000 });
}

/** Cria a bridge de sempre (instalar.sh também faz; aqui garante no boot do agente). */
export async function garantirBridge() {
  await garantirRede(redeDoLote(0));
}

/**
 * Script que roda dentro do sidecar (sh + iptables + redsocks, imagem montada
 * por scripts/vps/instalar.sh). Em modo bloqueado só aplica o DROP; em modo
 * proxy escreve o redsocks.conf e abre as exceções da proxy.
 */
/**
 * Uid fixo do redsocks (criado na imagem do sidecar, scripts/vps/instalar.sh).
 * O match por owner vale para o netns inteiro, e o netns é o do Android: os
 * uids 1000 (system) e 2000 (shell) são do Android, 10000–19999 são os apps e
 * 50000–59999 os gids compartilhados. 60000 não colide com nenhum deles; com
 * 1000/2000 o tráfego do próprio Android passaria como se fosse do redsocks.
 */
export const UID_REDSOCKS = 60000;

/**
 * Regras, nesta ordem (tudo em OUTPUT: os apps rodam no netns, o tráfego é local):
 *   nat OUTPUT: lo RETURN → owner redsocks RETURN → udp/53 REDIRECT unbound → tcp/53 REDIRECT
 *               redsocks → tcp REDIRECT redsocks
 *   filter OUTPUT: lo ACCEPT → ESTABLISHED/RELATED ACCEPT (respostas do adb que entrou)
 *                  → owner redsocks ACCEPT → udp/53 ACCEPT → udp/443 REJECT (derruba o QUIC
 *                  para o app cair em TCP sem esperar timeout) → tcp ACCEPT → DROP final.
 * O DNS nunca sai pelo resolver da VPS: o Android usa como dns1 o IP do
 * próprio container, onde o unbound do sidecar atende na 53 (encaminhador,
 * tcp-upstream: DNS sobre TCP direto em 1.1.1.1, com o uid do redsocks); udp/53
 * para outro IP cai no REDIRECT e tcp/53 no redsocks, antes de qualquer ACCEPT;
 * 127.0.0.11 (DNS embutido do Docker, que sai pelo host) é DROP. Em modo bloqueado só ficam lo, ESTABLISHED, o
 * REJECT do QUIC e o DROP: nem DNS sai. O redsocks roda com o uid dedicado
 * (base.user): é o owner, pelo número, que o libera. A política de OUTPUT vira
 * DROP antes de qualquer regra: falha no meio do script fecha, nunca abre.
 */
// decisão: o redsocks 0.5 do Alpine não tem dnsu2t e, com libevent 2.1, aceita o cliente e nunca completa o CONNECT (trava sem log);
// o redirecionador é o gost (modo red, imagem gogost/gost já usada nesta VPS) e o unbound faz o UDP→TCP, os dois com o uid 60000,
// então as regras de iptables são as mesmas. Os nomes (redsocks, *-proxy, scalemaster-redsocks:1) ficam.
// decisão: tcp/53 vai para a porta do redsocks, não para a do unbound, porque o unbound só serve o Android em UDP; pelo redsocks o DNS sobre TCP sai por CONNECT pela proxy.
export function scriptSidecar() {
  return `set -e
id redsocks >/dev/null 2>&1 || adduser -D -H -s /sbin/nologin -u ${UID_REDSOCKS} redsocks
# Política DROP ANTES de mexer nas regras: se qualquer comando daqui para baixo falhar
# (módulo xt_* ausente, redsocks morto), o netns fica fechado, nunca aberto.
iptables -P OUTPUT DROP
iptables -t nat -F OUTPUT 2>/dev/null || true
iptables -F OUTPUT 2>/dev/null || true
# IP do container na vpsnet: é nele (porta 53) que o unbound atende o Android e o próprio sidecar.
IP_NETNS="$(ip -4 -o addr show eth0 | sed -n 's/.*inet \\([0-9.]*\\).*/\\1/p' | head -1)"
[ -n "$IP_NETNS" ] || { echo "sem IP em eth0" >&2; exit 1; }
printf 'nameserver %s\\n' "$IP_NETNS" > /etc/resolv.conf
if [ "$MODO" = "proxy" ]; then
  [ -n "$PROXY_URL" ] || { echo "PROXY_URL vazia" >&2; exit 1; }
  # DNS UDP → TCP: unbound em $IP_NETNS:${PORTA_DNS}, só encaminhador (tcp-upstream), rodando como o uid do redsocks.
  mkdir -p /etc/unbound
  cat > /etc/unbound/sidecar.conf <<CONF
server:
  interface: $IP_NETNS@${PORTA_DNS}
  interface: 127.0.0.1@${PORTA_DNS}
  port: ${PORTA_DNS}
  do-udp: yes
  do-tcp: yes
  tcp-upstream: yes
  username: "redsocks"
  directory: "/etc/unbound"
  chroot: ""
  pidfile: ""
  use-syslog: no
  logfile: ""
  verbosity: 0
  access-control: 0.0.0.0/0 allow
  module-config: "iterator"
  hide-identity: yes
  hide-version: yes
  qname-minimisation: no
forward-zone:
  name: "."
  forward-addr: ${DNS_REMOTO}
CONF
  unbound-checkconf /etc/unbound/sidecar.conf >/dev/null
  unbound -c /etc/unbound/sidecar.conf
  iptables -t nat -A OUTPUT -o lo -j RETURN
  iptables -t nat -A OUTPUT -m owner --uid-owner ${UID_REDSOCKS} -j RETURN
  # Resolver fixo em outro IP (8.8.8.8 etc.) cai no unbound; se a volta do NAT não fechar, falha fechado.
  iptables -t nat -A OUTPUT -p udp --dport 53 -j REDIRECT --to-ports ${PORTA_DNS}
  iptables -t nat -A OUTPUT -p tcp --dport 53 -j REDIRECT --to-ports ${PORTA_REDSOCKS}
  iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports ${PORTA_REDSOCKS}
fi
# DNS embutido do Docker (127.0.0.11) encaminha pelo dockerd do host: nunca.
iptables -A OUTPUT -d 127.0.0.11 -j DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
if [ "$MODO" = "proxy" ]; then
  iptables -A OUTPUT -m owner --uid-owner ${UID_REDSOCKS} -j ACCEPT
  iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
fi
iptables -A OUTPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable
if [ "$MODO" = "proxy" ]; then
  iptables -A OUTPUT -p tcp -j ACCEPT
fi
iptables -A OUTPUT -j DROP
echo "sidecar pronto: modo $MODO"
# Redirecionador transparente: gost em modo red (SO_ORIGINAL_DST), com o uid do redsocks (é o owner que o libera das regras).
if [ "$MODO" = "proxy" ]; then exec su-exec redsocks gost -L "red://:${PORTA_REDSOCKS}" -F "$PROXY_URL"; fi
exec sleep infinity
`;
}

export function escreverScript() {
  mkdirSync(PASTA_REDE, { recursive: true });
  const arquivo = path.join(PASTA_REDE, "sidecar.sh");
  // Reescreve quando o script desta versão do agente mudou (regra nova de iptables chega à VPS no git pull).
  const conteudo = scriptSidecar();
  if (!existsSync(arquivo) || readFileSync(arquivo, "utf8") !== conteudo) writeFileSync(arquivo, conteudo, { mode: 0o755 });
  return arquivo;
}

export async function pararSidecar(container) {
  await rodar("docker", ["rm", "-f", nomeSidecar(container)], { timeoutMs: 60_000 });
}

/**
 * Sobe o sidecar no netns do container. `proxy` = URL da conta ou null (modo
 * bloqueado). O host da proxy é resolvido aqui (fora do netns bloqueado) e o
 * IP vai para as regras.
 */
export async function subirSidecar(container, proxy) {
  await pararSidecar(container);
  const script = escreverScript();
  const env = ["-e", `MODO=${proxy ? "proxy" : "bloqueado"}`];
  if (proxy) {
    const p = lerProxy(proxy);
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(p.host) ? p.host : (await lookup(p.host, { family: 4 })).address;
    // URL da proxy já com o IP (o netns não resolve nada fora do unbound) e credenciais escapadas para o gost.
    const auth = p.usuario ? `${encodeURIComponent(p.usuario)}:${encodeURIComponent(p.senha)}@` : "";
    env.push("-e", `PROXY_IP=${ip}`, "-e", `PROXY_PORT=${p.porta}`, "-e", `PROXY_URL=http://${auth}${ip}:${p.porta}`);
  }
  const r = await rodar(
    "docker",
    [
      "run", "-d", "--name", nomeSidecar(container),
      "--label", "scalemaster.vps=1", "--label", `scalemaster.sidecar=${container}`, "--label", `scalemaster.modo=${proxy ? "proxy" : "bloqueado"}`,
      "--network", `container:${container}`, "--cap-add", "NET_ADMIN", "--restart", "unless-stopped",
      "-v", `${script}:/sidecar.sh:ro`, ...env,
      IMAGEM_SIDECAR, "sh", "/sidecar.sh",
    ],
    { timeoutMs: 120_000 }
  );
  if (r.codigo !== 0) throw new Error(`sidecar de ${container} não subiu: ${trecho(r.stderr)}`);
  // Pronto = container rodando, sem nenhum restart (o --restart esconderia um crash em loop) e "sidecar pronto" no log.
  const limite = Date.now() + 15_000;
  for (;;) {
    await esperar(1000);
    const st = await rodar("docker", ["inspect", "--format", "{{.State.Running}} {{.RestartCount}} {{.State.ExitCode}}", nomeSidecar(container)], { timeoutMs: 20_000 });
    const [running, restarts, exitCode] = trecho(st.stdout).split(" ");
    const logs = await rodar("docker", ["logs", "--tail", "20", nomeSidecar(container)], { timeoutMs: 20_000 });
    const saida = `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`;
    if (running !== "true" || Number(restarts) > 0) {
      await pararSidecar(container);
      throw new Error(`sidecar de ${container} morreu (exit ${exitCode}, ${restarts} restart(s)): ${trecho(saida.replace(/\/\/[^/@\s]+@/g, "//***@"), 300)}`);
    }
    if (/sidecar pronto/.test(saida)) return;
    if (Date.now() > limite) {
      await pararSidecar(container);
      throw new Error(`sidecar de ${container} não ficou pronto em 15 s: ${trecho(saida, 300)}`);
    }
  }
}

/** O sidecar está de pé em modo proxy (redsocks vivo)? */
export async function proxyAtiva(container) {
  const r = await rodar("docker", ["inspect", "--format", '{{.State.Running}} {{index .Config.Labels "scalemaster.modo"}}', nomeSidecar(container)], { timeoutMs: 20_000 });
  return trecho(r.stdout) === "true proxy";
}

/** País e IP de saída de uma proxy, vista da VPS (curl -x), em até 15 s. */
export async function geoDaProxy(proxy, { timeoutMs = 15_000 } = {}) {
  const r = await rodar(
    "curl",
    ["-sS", "-m", String(Math.ceil(timeoutMs / 1000)), "-x", proxy, "-w", "\n%{http_code}", "http://ip-api.com/json/?fields=status,countryCode,timezone,query"],
    { timeoutMs: timeoutMs + 5000 }
  );
  const saida = String(r.stdout ?? "").trim();
  const linhas = saida.split("\n");
  const http = Number(linhas.pop());
  const corpo = linhas.join("\n");
  if (r.codigo !== 0 || http !== 200) throw new Error(`a proxy não respondeu (${trecho(r.stderr) || `HTTP ${http || 0}`})`);
  let dados;
  try {
    dados = JSON.parse(corpo);
  } catch {
    throw new Error(`resposta de geo ilegível: ${trecho(corpo)}`);
  }
  if (dados.status !== "success" || !dados.countryCode) throw new Error(`geo sem país: ${trecho(corpo)}`);
  return { pais: String(dados.countryCode).toUpperCase(), ip: String(dados.query ?? ""), timezone: String(dados.timezone ?? "") };
}

/**
 * Valida a proxy ANTES de qualquer cadastro: HTTP 200 no endpoint de geo e o
 * país igual ao esperado (quando informado). Falha = ProxyMorta (sem fallback).
 */
export class ProxyMorta extends Error {
  constructor(motivo) {
    super(`PROXY_MORTA: ${motivo}`);
    this.name = "ProxyMorta";
    this.semPrefixo = true;
  }
}

export async function validar(proxy, paisEsperado) {
  let geo;
  try {
    geo = await geoDaProxy(proxy);
  } catch (e) {
    throw new ProxyMorta(e.message);
  }
  if (paisEsperado && geo.pais !== String(paisEsperado).toUpperCase()) {
    throw new ProxyMorta(`a proxy sai por ${geo.pais}, a conta é ${String(paisEsperado).toUpperCase()}`);
  }
  return geo;
}

/** Do lado de dentro do netns: a proxy funciona pelo redsocks (e só por ele). */
export async function validarNoNetns(container, paisEsperado) {
  const r = await rodar(
    "docker",
    ["exec", nomeSidecar(container), "curl", "-sS", "-m", "15", "-w", "\n%{http_code}", "http://ip-api.com/json/?fields=status,countryCode,query"],
    { timeoutMs: 25_000 }
  );
  const linhas = String(r.stdout ?? "").trim().split("\n");
  const http = Number(linhas.pop());
  if (r.codigo !== 0 || http !== 200) throw new ProxyMorta(`dentro do container a proxy não respondeu (${trecho(r.stderr) || `HTTP ${http || 0}`})`);
  let dados;
  try {
    dados = JSON.parse(linhas.join("\n"));
  } catch {
    throw new ProxyMorta("resposta de geo ilegível dentro do container");
  }
  const pais = String(dados.countryCode ?? "").toUpperCase();
  if (paisEsperado && pais !== String(paisEsperado).toUpperCase()) throw new ProxyMorta(`dentro do container a saída é ${pais}`);
  return { pais, ip: String(dados.query ?? "") };
}

/** Prova do kill switch: com o sidecar de pé em modo bloqueado, nada sai (o curl precisa falhar). */
export async function provarBloqueio(container) {
  const vivo = await rodar("docker", ["inspect", "--format", "{{.State.Running}}", nomeSidecar(container)], { timeoutMs: 20_000 });
  if (trecho(vivo.stdout) !== "true") return false;
  const r = await rodar("docker", ["exec", nomeSidecar(container), "curl", "-sS", "-m", "8", "-o", "/dev/null", "http://ip-api.com/"], { timeoutMs: 15_000 });
  return r.codigo !== 0;
}
