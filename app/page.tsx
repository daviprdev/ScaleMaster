import { redirect } from "next/navigation";

// Sem landing page: a raiz vai direto para o login. Quem já tem sessão é
// mandado do login para o /dashboard pelo middleware.
export default function HomePage() {
  redirect("/auth/login");
}
