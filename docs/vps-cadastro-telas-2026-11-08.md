# Cadastro no Instagram 454.0.0.54.77 (x86_64, redroid 13, pt-BR) — mapa de telas visto em 2026-11-08 (ig-2)

Ordem observada a partir do app zerado (`pm clear`), com a proxy BR ligada:

| # | Tela (texto-chave) | O que o agente faz (`fluxos/cadastro.mjs`) |
| --- | --- | --- |
| 1 | boas-vindas / login com "Criar conta nova" | toca "Criar conta nova" (`login`) |
| 1b | login puro: "Nome de usuário, email ou celular", "Entrar", "Esqueceu a senha?" (sem criar conta) — aparece ao religar o container | BACK (`login-sem-criar`) |
| 2 | telefone: botão "Cadastrar-se com o email" | toca (`telefone`) |
| 3 | "Qual é seu email?" · campo "Email" · "Avançar" · "Cadastrar-se com o número do celular" · "Já tenho uma conta" | abre a sessão do portal aqui, digita o endereço, Avançar, espera 4 s (`email`) |
| 4 | "Insira o código de confirmação" · "Para confirmar seu perfil, insira o código de 6 dígitos que enviamos para x@gmail.com." · "Campo de entrada de código" · "Não recebi o código" · "Avançar" | OTP do portal (`/status` → `mails[].otp`), senão pergunta na aba (`codigo`) |
| 5 | senha: "Crie uma senha" | digita (`senha`) |
| 6 | "Qual é sua data de nascimento?" · botão "Data de nascimento (0 anos),8 de novembro de 2026" (abre `android:id/datePicker` com 3 `numberpicker_input`: dia "08", mês "nov.", ano "2026"; botões CANCELAR/DEFINIR) | gira as rodas tocando acima/abaixo até bater, DEFINIR, Avançar (`nascimento` / `picker-data`) |
| 7+ | nome, usuário, termos, boas-vindas… | ainda não vistos nesta build (próxima conta) |

Observações:
- `monkey` não abre o app no redroid 13 (rc 251); `abrirApp` usa `cmd package resolve-activity` + `am start -W -n`.
- Erro "Parece que você inseriu informações incorretas. Use sua data de nascimento verdadeira." = a data ficou em "hoje" (digitar na roda não fixa o valor).
- O Instagram nem sempre reenvia o e-mail do código quando o cadastro recomeça: o código anterior continua valendo (regra do `esperarOtp`: novo por 60 s, depois o último não digitado).
