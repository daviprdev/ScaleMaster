# Agente MuMu

Liga o PC onde está o MuMu Player à aba **Emulador** do Scale Master. Precisa só do Node 18+ (sem `npm install`).

## Conectar o PC

1. No Scale Master, aba Emulador → **Conectar um PC** → **Gerar código**.
2. Nesta pasta, rode o comando que aparece:

   ```
   node agente.mjs conectar smag_...
   ```

3. Para subir sozinho com o Windows (sem janela):

   ```
   powershell -ExecutionPolicy Bypass -File instalar-inicializacao.ps1
   ```

   Desfazer: `powershell -ExecutionPolicy Bypass -File remover-inicializacao.ps1`.

O código fica em `config.json` (fora do git). O log fica em `agente.log`.

## Testar sem o SaaS

```
node agente.mjs instancias
node agente.mjs abrir-mumu
node agente.mjs abrir 0
node agente.mjs fechar 0
node agente.mjs tarefa teste-adb 0
```

## Criar instância

A aba Emulador → **Criar instância** põe uma conta na fila. O agente roda uma por vez (`fluxos/nova-conta.mjs`):

1. copia a instância padrão e troca IMEI (válido), Android ID e MAC;
2. dá à cópia o @ (ou o Gmail) como nome e liga;
3. instala o Instagram pelo Aurora (`fluxos/aurora.mjs`), antes da proxy;
4. põe a proxy HTTP no NekoBox e testa (`fluxos/nekobox.mjs`);
5. cria a conta com o Gmail (`fluxos/cadastro.mjs`): reconhece cada tela pelo título; o código do Gmail e qualquer tela desconhecida são pedidos ao dono na aba. Telas desconhecidas ficam salvas em `telas/`.

Se uma etapa falha, a conta para e o botão **Continuar** retoma da etapa que falhou. Teste local: `node agente.mjs nova-conta 0 dados.json` (com `{ "proxy": "http://u:s@host:porta", "conta": { ... } }`).

## Atividade

O botão **Atividade** na linha de uma instância (fora a #0) põe na mesma fila, uma coisa por vez (`fluxos/atividade.mjs`): liga a instância, conecta a proxy que já está no NekoBox **antes** de abrir o Instagram, faz o que foi marcado e desliga.

- **Aquecer:** segue 2 ou 3 perfis sorteados de `fluxos/verificados.mjs` (confere o selo azul; 20–60 s entre um e outro) e rola de 3 a 5 min de Reels, sem curtir.
- **Trocar a foto de perfil** e **story com link e destaque:** a mídia escolhida na aba é baixada e posta em `/sdcard/DCIM/ScaleMaster` (só ela, para ser a 1ª da galeria); o story leva o sticker de link com o texto pedido e vira destaque no perfil.

As telas do Instagram logado ficam em `fluxos/instagram.mjs`. Tela desconhecida vai para `telas/` e vira pergunta na aba; se travar na foto, no story ou no destaque, o agente pede para terminar à mão (não arrisca postar o story duas vezes). No Continuar, ligar, proxy e Instagram rodam de novo.

## Automações

Cada automação é um arquivo em `tarefas/`, registrado em `tarefas/index.mjs`. Antes de rodar uma automação, o agente abre a instância, espera o Android e conecta o adb. A função `rodar(ctx)` recebe o aparelho pronto em `ctx.dispositivo` (ver `lib/adb.mjs`):

- `tocar(x, y)`, `arrastar(...)`, `digitar(texto)`, `tecla("KEYCODE_BACK")`
- `abrirApp(pacote)`, `fecharApp(pacote)`
- `tela()`, `acharTexto(t)`, `esperarTexto(t)`, `tocarTexto(t)`
- `print()` (PNG)

Uma automação nova aparece na aba Emulador no próximo sync depois que o agente reinicia (`node agente.mjs parar` e abrir de novo).

O servidor só escolhe entre abrir, fechar e uma automação desta pasta, sempre pelo número da instância. Nada que vem dele roda como comando de terminal.
