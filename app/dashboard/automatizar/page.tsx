import { redirect } from "next/navigation";

/**
 * O módulo "Automatizar" foi removido do produto ativo em 2026-09-06.
 *
 * A rota é mantida apenas como redirecionamento para não devolver 404 a quem
 * tiver a URL salva/favoritada. As tabelas `automations`,
 * `automation_account_folders` e `automation_video_folders` continuam no banco
 * (histórico/auditoria) e o cron `process-automations` foi desativado, então
 * nenhum post novo é gerado por esse motor.
 */
export default function AutomatizarRemovidoPage() {
  redirect("/dashboard/postar");
}
