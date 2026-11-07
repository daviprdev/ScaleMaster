/**
 * Prova que o caminho inteiro funciona: o agente liga o container (se estiver
 * desligado), espera o Android, conecta o adb e lê três dados do aparelho.
 */
export default {
  nome: "teste-adb",
  rotulo: "Testar automação",
  descricao: "Liga o container, conecta e lê a versão do Android, o modelo e a tela.",

  async rodar({ dispositivo }) {
    const [android, modelo, serial, tela] = await Promise.all([
      dispositivo.prop("ro.build.version.release"),
      dispositivo.prop("ro.product.model"),
      dispositivo.prop("ro.serialno"),
      dispositivo.shell("wm", "size"),
    ]);
    return { android, modelo, serial, tela: /(\d+x\d+)/.exec(tela)?.[1] ?? tela.trim() };
  },
};
