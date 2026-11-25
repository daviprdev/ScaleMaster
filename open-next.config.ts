// Configuração do OpenNext para o Cloudflare Workers.
// decisão: sem cache incremental (R2) — as páginas do SaaS são dinâmicas.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
