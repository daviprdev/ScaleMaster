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

## Automações

Cada automação é um arquivo em `tarefas/`, registrado em `tarefas/index.mjs`. Antes de rodar uma automação, o agente abre a instância, espera o Android e conecta o adb. A função `rodar(ctx)` recebe o aparelho pronto em `ctx.dispositivo` (ver `lib/adb.mjs`):

- `tocar(x, y)`, `arrastar(...)`, `digitar(texto)`, `tecla("KEYCODE_BACK")`
- `abrirApp(pacote)`, `fecharApp(pacote)`
- `tela()`, `acharTexto(t)`, `esperarTexto(t)`, `tocarTexto(t)`
- `print()` (PNG)

Uma automação nova aparece na aba Emulador no próximo sync depois que o agente reinicia (`node agente.mjs parar` e abrir de novo).

O servidor só escolhe entre abrir, fechar e uma automação desta pasta, sempre pelo número da instância. Nada que vem dele roda como comando de terminal.
