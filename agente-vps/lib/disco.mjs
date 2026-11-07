import { rodar, trecho } from "./processo.mjs";

/**
 * Disco dos containers: cada conta tem um volume Docker (/data do redroid) com
 * cota de 4 GB. O Docker não impõe cota em volume local, então a cota é
 * conferida aqui: antes de copiar a base precisa haver 4 GB livres, e um
 * volume que passar de 4 GB faz a etapa parar. Ao excluir, o volume vai junto
 * e o prune tira o que ficou órfão.
 */

export const QUOTA_BYTES = 4 * 1024 ** 3;
export const LABEL = "scalemaster.vps=1";

/** Bytes livres onde o Docker guarda os volumes. */
export async function livre() {
  const r = await rodar("docker", ["info", "--format", "{{.DockerRootDir}}"], { timeoutMs: 20_000 });
  const raiz = trecho(r.stdout) || "/var/lib/docker";
  const df = await rodar("df", ["-B1", "--output=avail", raiz], { timeoutMs: 20_000 });
  const linhas = String(df.stdout).trim().split(/\r?\n/);
  const n = Number(linhas[linhas.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

/** Tamanho em bytes de um volume (du no caminho de montagem do Docker). */
export async function tamanhoVolume(nome) {
  const ins = await rodar("docker", ["volume", "inspect", "--format", "{{.Mountpoint}}", nome], { timeoutMs: 20_000 });
  const ponto = trecho(ins.stdout);
  if (ins.codigo !== 0 || !ponto) throw new Error(`volume ${nome} não existe`);
  const du = await rodar("du", ["-sb", ponto], { timeoutMs: 120_000 });
  const n = Number(String(du.stdout).trim().split(/\s+/)[0]);
  return Number.isFinite(n) ? n : 0;
}

export async function conferirEspacoParaNovo() {
  const disponivel = await livre();
  if (disponivel < QUOTA_BYTES) {
    throw new Error(`Sem espaço para outro container: ${(disponivel / 1024 ** 3).toFixed(1)} GB livres, precisa de 4 GB.`);
  }
}

export async function conferirQuota(nome) {
  const usado = await tamanhoVolume(nome);
  if (usado > QUOTA_BYTES) {
    throw new Error(`O volume ${nome} passou da cota de 4 GB (${(usado / 1024 ** 3).toFixed(1)} GB).`);
  }
  return usado;
}

/** Cria o volume da conta copiando os dados do volume base (cp -a dentro de um container descartável). */
export async function copiarVolume(base, novo) {
  await conferirEspacoParaNovo();
  const cria = await rodar("docker", ["volume", "create", "--label", LABEL, novo], { timeoutMs: 60_000 });
  if (cria.codigo !== 0) throw new Error(`docker volume create ${novo}: ${trecho(cria.stderr)}`);
  const cp = await rodar(
    "docker",
    ["run", "--rm", "-v", `${base}:/de:ro`, "-v", `${novo}:/para`, "alpine:3.20", "sh", "-c", "cp -a /de/. /para/"],
    { timeoutMs: 15 * 60_000 }
  );
  if (cp.codigo !== 0) {
    await rodar("docker", ["volume", "rm", "-f", novo], { timeoutMs: 60_000 });
    throw new Error(`cópia da base falhou: ${trecho(cp.stderr || cp.stdout)}`);
  }
}

export async function apagarVolume(nome) {
  const r = await rodar("docker", ["volume", "rm", "-f", nome], { timeoutMs: 120_000 });
  if (r.codigo !== 0 && !/no such volume/i.test(String(r.stderr))) throw new Error(`docker volume rm ${nome}: ${trecho(r.stderr)}`);
}

/**
 * Apaga os volumes com o label do Scale Master que não estão em `vivos`
 * (a base e os volumes das contas do retrato). Sem `docker volume prune`:
 * dependendo da versão do Docker ele apagaria volume nomeado de conta
 * desligada e a própria base; e sem `container prune`, que removeria os
 * containers parados das outras contas.
 */
export async function prune(vivos = []) {
  const manter = new Set(vivos);
  const r = await rodar("docker", ["volume", "ls", "-q", "--filter", `label=${LABEL}`], { timeoutMs: 60_000 });
  const orfaos = String(r.stdout ?? "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v && !manter.has(v));
  for (const nome of orfaos) await rodar("docker", ["volume", "rm", "-f", nome], { timeoutMs: 120_000 });
  return orfaos;
}
