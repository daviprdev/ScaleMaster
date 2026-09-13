import { redirect } from "next/navigation";

/**
 * "Pesquisa" era uma cópia antiga das Inspirações, fora do menu. Ela esperava
 * os reels na resposta de POST /api/inspirations/scrape, mas a rota devolve só
 * o início da busca (runs da Apify) — a página mostrava "Nenhum Reel
 * encontrado" enquanto os runs pagos seguiam rodando sem salvar nada.
 *
 * Removida em 2026-09-13; a rota só redireciona para Inspirações, onde a busca
 * é durável (registrada no banco e finalizada pelo servidor).
 */
export default function SearchRemovidaPage() {
  redirect("/dashboard/inspirations");
}
