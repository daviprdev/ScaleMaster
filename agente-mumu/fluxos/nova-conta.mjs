import { limparAlerta, marcarAlerta } from "../lib/alertas.mjs";
import { gerarAndroidId, gerarImei, gerarMac } from "../lib/ids.mjs";
import { INSTAGRAM, instalarInstagram } from "./aurora.mjs";
import { ContaTravadaTelefone, cadastrarInstagram } from "./cadastro.mjs";
import { configurarProxy } from "./nekobox.mjs";

/**
 * Criar instância (aba Emulador). Cada etapa recebe
 * ctx = { mumu, job, input, estado, log, dispositivo(), perguntar(tipo, texto) }
 * e devolve uma mensagem curta para a tela. estado.instanceIndex é a cópia
 * criada; numa retomada (botão Continuar) ele já vem preenchido e as etapas
 * concluídas são puladas. As chaves batem com NOVA_CONTA_FLUXO em
 * lib/emulador/jobs.ts.
 *
 * Ordem pedida pelo dono: o Instagram baixa ANTES da proxy (os 275 MB não
 * passam por ela); depois a proxy no NekoBox; aí o cadastro com o Gmail.
 */

/** Aviso que a aba mostra em vermelho na linha da instância (igual a ALERTA_TELEFONE em lib/emulador/jobs.ts). */
export const ALERTA_TELEFONE = "Conta ERRO CRIAÇÃO, verificar com numero telefone";

function copia(estado) {
  if (estado.instanceIndex === null || estado.instanceIndex === undefined) {
    throw new Error("A cópia da instância ainda não foi criada.");
  }
  return estado.instanceIndex;
}

/** Nome no MuMu: o @ pedido, senão a parte do Gmail antes do @. */
export function nomeDaInstancia(job, input) {
  const conta = input?.conta ?? {};
  const base = conta.usuario || String(conta.email ?? "").split("@")[0];
  const nome = String(base).replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
  return nome || `conta-${job.id.slice(0, 8)}`;
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
    chave: "ids",
    rotulo: "Trocar IMEI, Android ID e MAC",
    async rodar({ mumu, estado }) {
      const index = copia(estado);
      const imei = gerarImei();
      await mumu.simular(index, "imei", imei);
      await mumu.simular(index, "android_id", gerarAndroidId());
      await mumu.simular(index, "mac_address", gerarMac());
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
  {
    chave: "instagram",
    rotulo: "Instalar o Instagram pelo Aurora",
    async rodar({ dispositivo, log }) {
      return instalarInstagram(await dispositivo(), log);
    },
  },
  {
    chave: "proxy",
    rotulo: "Proxy no NekoBox",
    async rodar({ dispositivo, job, input, log }) {
      if (!input?.proxy) throw new Error("Essa conta veio sem proxy.");
      return configurarProxy(await dispositivo(), input.proxy, `proxy-${nomeDaInstancia(job, input)}`.slice(0, 40), log);
    },
  },
  {
    // Instagram zerado antes do cadastro. Só roda de novo quando o dono edita os
    // dados (o servidor tira esta etapa e o cadastro das concluídas); no Continuar
    // comum fica pulada e o que já foi feito na tela não se perde.
    chave: "limpar",
    rotulo: "Preparar o Instagram para o cadastro",
    async rodar({ dispositivo }) {
      const d = await dispositivo();
      await d.fecharApp(INSTAGRAM);
      await d.shell("pm", "clear", INSTAGRAM);
      return "dados do Instagram zerados";
    },
  },
  {
    chave: "cadastro",
    rotulo: "Criar a conta no Instagram",
    async rodar({ mumu, estado, dispositivo, input, perguntar, log }) {
      const conta = input?.conta;
      if (!conta?.email || !conta?.senha) throw new Error("Essa conta veio sem Gmail ou senha.");
      // Cadastro novo nesta instância: o aviso de uma conta anterior sai da linha.
      const { criada } = await mumu.instancia(copia(estado));
      limparAlerta(criada);
      try {
        return await cadastrarInstagram({ d: await dispositivo(), conta, perguntar, log });
      } catch (e) {
        if (!(e instanceof ContaTravadaTelefone)) throw e;
        // Pedido do dono: fecha tudo e marca a instância com o aviso (fica até ela ser usada de novo).
        log("Instagram pediu telefone: desligando a instância");
        marcarAlerta(criada, ALERTA_TELEFONE);
        await mumu.fechar(copia(estado)).catch(() => {});
        const aviso = new Error(ALERTA_TELEFONE);
        aviso.semPrefixo = true;
        throw aviso;
      }
    },
  },
];

export const FLUXOS = { "nova-conta": NOVA_CONTA };
