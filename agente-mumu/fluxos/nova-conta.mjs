import { gerarImei } from "../lib/imei.mjs";

/**
 * Nova conta (aba Emulador → Contas). Cada etapa recebe
 * ctx = { mumu, job, input, estado, log } e devolve uma mensagem curta para a
 * tela. estado.instanceIndex é a cópia criada; numa retomada (botão
 * Continuar) ele já vem preenchido e as etapas concluídas são puladas.
 * As chaves batem com NOVA_CONTA_FLUXO em lib/emulador/jobs.ts. Ainda faltam:
 * proxy no NekoBox, instalar o Instagram e o cadastro.
 */

function copia(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) {
    throw new Error("A cópia da instância ainda não foi criada.");
  }
  return estado.instanceIndex;
}

/** Nome da instância no MuMu: o @ da conta, ou conta-<id> sem @. */
function nomeDaInstancia(job, input) {
  const usuario = String(input?.conta?.usuario ?? "").replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
  return usuario || `conta-${job.id.slice(0, 8)}`;
}

export const NOVA_CONTA = [
  {
    chave: "copiar",
    rotulo: "Copiar a instância padrão",
    async rodar({ mumu, job, estado }) {
      estado.instanceIndex = await mumu.clonar(job.templateIndex);
      return `instância #${estado.instanceIndex}`;
    },
  },
  {
    chave: "imei",
    rotulo: "Trocar o IMEI",
    async rodar({ mumu, estado }) {
      const imei = gerarImei();
      await mumu.definirImei(copia(estado), imei);
      return `IMEI ${imei}`;
    },
  },
  {
    chave: "nome",
    rotulo: "Dar o nome da conta à instância",
    async rodar({ mumu, job, input, estado }) {
      const nome = nomeDaInstancia(job, input);
      await mumu.renomear(copia(estado), nome);
      return nome;
    },
  },
  {
    chave: "abrir",
    rotulo: "Ligar a instância",
    async rodar({ mumu, estado, log }) {
      await mumu.prepararInstancia(copia(estado), { log });
      return "Android pronto";
    },
  },
];

export const FLUXOS = { "nova-conta": NOVA_CONTA };
