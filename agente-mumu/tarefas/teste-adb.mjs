/**
 * Prova que o caminho inteiro funciona: o agente abre a instância (se estiver
 * desligada), espera o Android, conecta o adb e lê três dados do aparelho.
 */
export default {
  nome: "teste-adb",
  rotulo: "Testar automação",
  descricao: "Abre a instância, conecta e lê a versão do Android, o modelo e a tela.",

  async rodar({ dispositivo }) {
    const [android, modelo, tela] = await Promise.all([
      dispositivo.prop("ro.build.version.release"),
      dispositivo.prop("ro.product.model"),
      dispositivo.shell("wm", "size"),
    ]);
    return {
      android,
      modelo,
      tela: /(\d+x\d+)/.exec(tela)?.[1] ?? tela.trim(),
    };
  },
};
