import type { ProvedorEmail } from "./types";

/** Rótulos dos campos de e-mail por provedor (os campos são os mesmos; só o significado muda). */
export const ROTULOS_EMAIL: Record<ProvedorEmail, { email: string; senha: string; placeholderEmail: string; dicaSenha: string; descricao: string }> = {
  portal: {
    email: "Link do portal",
    senha: "Código de resgate",
    placeholderEmail: "https://hridoyhub.shop/OTP/ | SUDXHRAY",
    dicaSenha: "O código do hstock. Colar \"link | código\" no campo do link separa sozinho.",
    descricao: "O painel abre uma sessão de 20 min com um @gmail.com e mostra o OTP; a VPS abre a sessão só na hora de digitar o e-mail no Instagram.",
  },
  mailtm: { email: "E-mail (mail.tm)", senha: "Senha do mail.tm", placeholderEmail: "nome@dominio-do-mail.tm", dicaSenha: "Senha da conta criada no mail.tm.", descricao: "A VPS lê o código pela API do mail.tm." },
  imap: { email: "E-mail", senha: "Senha do e-mail", placeholderEmail: "", dicaSenha: "Senha de app, se o provedor exigir (Gmail exige).", descricao: "A VPS lê o código por IMAP." },
  manual: { email: "E-mail", senha: "Senha do e-mail (opcional)", placeholderEmail: "", dicaSenha: "Só para guardar: o código é pedido na aba.", descricao: "Sem leitura automática: o código do Instagram é pedido a você na aba." },
};
