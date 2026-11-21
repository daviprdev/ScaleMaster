import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Página da Meta com os convites de testador (aba "Convites de testador"), aberta pela conta logada. */
const PAGINA_DE_CONVITES = "https://www.instagram.com/accounts/manage_access/";

/**
 * Botão "Aceitar convites de testador" da página /add/{token}/apps: redireciona
 * (em vez de link direto) para a página da Meta abrir no mesmo navegador do
 * Instagram em que o link do destaque abriu, com a sessão da conta — o mesmo
 * caminho do OAuth, que também chega lá por redirecionamento. Destino fixo.
 */
export async function GET() {
  return NextResponse.redirect(PAGINA_DE_CONVITES, 307);
}
