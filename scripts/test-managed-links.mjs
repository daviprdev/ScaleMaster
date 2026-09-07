/**
 * Links Gerenciáveis — testes de regressão.
 *
 * Três camadas:
 *
 *   1. COMPORTAMENTAL (lib) — compila `lib/managed-links.ts` e executa as
 *      funções de verdade: validação de destino, slug, categorias e merge.
 *   2. COMPORTAMENTAL (banco, seção 17) — semeia links reais e chama a RPC,
 *      provando a regra de contagem e o acordo entre as duas implementações da
 *      validação de destino (TypeScript e SQL). Só roda quando há credencial em
 *      `.env.local`; sem ela a seção é pulada com aviso.
 *   3. ESTRUTURAL — guardas sobre a rota pública, as rotas privadas e a
 *      migration, para que uma refatoração futura não reintroduza redirect
 *      controlado por parâmetro, cloaking, cache do destino antigo, coleta de
 *      dado pessoal ou credencial serializada para o browser.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * Remove comentários antes das checagens de PUREZA (as que afirmam "esta
 * palavra não aparece no código"). Sem isso, um comentário explicando por que
 * NÃO se usa `Math.random()` faria a checagem de `Math.random()` falhar — o
 * teste estaria lendo a documentação em vez do código.
 */
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
let failed = 0;
const check = (nome, ok) => {
  if (ok) { passed++; console.log(`  PASS  ${nome}`); }
  else { failed++; console.log(`  FAIL  ${nome}`); }
};

function compilarLib(relPath) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "mlinks-"));
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsc", path.join(ROOT, relPath), "--outDir", out, "--target", "es2022",
     "--module", "es2022", "--moduleResolution", "bundler"],
    { stdio: "pipe", shell: process.platform === "win32" }
  );
  return path.join(out, path.basename(relPath).replace(/\.ts$/, ".js"));
}

/**
 * Lê .env.local se existir. Os testes de comportamento do banco (secao 14) só
 * rodam quando ha credencial disponivel; sem ela sao pulados com aviso, para
 * que `npm test` continue funcionando em qualquer maquina.
 */
function carregarEnv() {
  const arq = path.join(ROOT, ".env.local");
  if (!fs.existsSync(arq)) return {};
  const out = {};
  for (const linha of fs.readFileSync(arq, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Cliente PostgREST minimo com a service_role — sem dependencia nova. */
function criarClienteDb(url, key) {
  const base = url.replace(/\/+$/, "");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    async rpc(nome, args) {
      const res = await fetch(`${base}/rest/v1/rpc/${nome}`, {
        method: "POST", headers, body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`rpc ${nome}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async insert(tabela, linhas) {
      const res = await fetch(`${base}/rest/v1/${tabela}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(linhas),
      });
      if (!res.ok) throw new Error(`insert ${tabela}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async select(tabela, query) {
      const res = await fetch(`${base}/rest/v1/${tabela}?${query}`, { headers });
      if (!res.ok) throw new Error(`select ${tabela}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async remove(tabela, query) {
      const res = await fetch(`${base}/rest/v1/${tabela}?${query}`, {
        method: "DELETE", headers,
      });
      if (!res.ok) throw new Error(`delete ${tabela}: ${res.status} ${await res.text()}`);
    },
  };
}

async function main() {
  const libPath = compilarLib("lib/managed-links.ts");
  const lib = await import(pathToFileURL(libPath).href);
  const {
    generateSlug, normalizeCustomSlug, isWellFormedSlug, validateDestinationUrl,
    buildRedirectUrl, deviceTypeFromUserAgent, browserFamilyFromUserAgent,
    referrerHost, publicLinkUrl, isUuid, RESERVED_SLUGS,
  } = lib;

  const redirectRoute = src("app/r/[slug]/route.ts");
  const listRoute = src("app/api/links/route.ts");
  const itemRoute = src("app/api/links/[id]/route.ts");
  const analyticsRoute = src("app/api/links/[id]/analytics/route.ts");
  const migration = src("supabase/managed_links.sql");
  const postNow = src("app/api/posts/stories/post-now/route.ts");
  const middleware = src("middleware.ts");

  // Versões sem comentário, para as checagens de pureza.
  const libCodigo = semComentarios(src("lib/managed-links.ts"));
  const redirectCodigo = semComentarios(redirectRoute);
  const analyticsCodigo = semComentarios(analyticsRoute);
  const postNowCodigo = semComentarios(postNow);

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 1. Slug ==\n");

  const slug = generateSlug();
  check("TESTE 1: slug automático tem 7 caracteres", slug.length === 7);
  check("TESTE 1: slug automático é base62", /^[A-Za-z0-9]{7}$/.test(slug));
  check("TESTE 1: slug automático passa na validação de formato", isWellFormedSlug(slug));

  const amostra = new Set(Array.from({ length: 500 }, () => generateSlug()));
  check("TESTE 1: 500 slugs gerados sem colisão", amostra.size === 500);

  check("slug é gerado com crypto, nunca Math.random()",
    libCodigo.includes("randomBytes") &&
    !/Math\.random/.test(libCodigo));
  check("amostragem por rejeição elimina viés de módulo",
    src("lib/managed-links.ts").includes("256 - (256 % SLUG_ALPHABET.length)"));

  // Slug customizado
  check("slug customizado é normalizado para minúsculas",
    normalizeCustomSlug("Oferta-Setembro").slug === "oferta-setembro");
  check("slug com menos de 3 caracteres é rejeitado", normalizeCustomSlug("ab").ok === false);
  check("slug com mais de 50 caracteres é rejeitado",
    normalizeCustomSlug("a".repeat(51)).ok === false);
  check("slug com caractere inválido é rejeitado", normalizeCustomSlug("ofer ta!").ok === false);
  check("slug aceita letras, números, hífen e underscore",
    normalizeCustomSlug("oferta_2026-b").ok === true);

  for (const reservada of ["admin", "api", "dashboard", "login", "auth", "settings",
                           "favicon", "robots", "health"]) {
    check(`palavra reservada bloqueada: ${reservada}`,
      RESERVED_SLUGS.has(reservada) && normalizeCustomSlug(reservada).ok === false);
  }

  check("colisão de slug é tratada (retenta candidatos, não assume impossível)",
    listRoute.includes('error.code !== "23505"') && listRoute.includes("length: 6"));
  check("slug customizado em uso devolve 409, sem retentativa silenciosa",
    listRoute.includes("status: 409"));
  check("UNIQUE do slug existe na migration",
    migration.includes("CONSTRAINT managed_links_slug_key UNIQUE (slug)"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 2. Validação do destino ==\n");

  check("TESTE 6: javascript:alert() é rejeitado",
    validateDestinationUrl("javascript:alert(1)").ok === false);
  check("TESTE 7: file:// é rejeitado",
    validateDestinationUrl("file:///etc/passwd").ok === false);
  for (const esquema of ["data:text/html,<script>", "ftp://x.com/a", "chrome://settings",
                         "about:blank", "gopher://x.com", "vbscript:msgbox"]) {
    check(`scheme bloqueado: ${esquema.split(":")[0]}:`,
      validateDestinationUrl(esquema).ok === false);
  }

  check("https:// é aceito", validateDestinationUrl("https://exemplo.com/a").ok === true);
  check("http:// é aceito", validateDestinationUrl("http://exemplo.com/a").ok === true);

  check("credencial embutida (user:senha@host) é rejeitada",
    validateDestinationUrl("https://usuario:senha@site.com").ok === false);
  check("só usuário embutido também é rejeitado",
    validateDestinationUrl("https://usuario@site.com").ok === false);

  check("localhost é rejeitado", validateDestinationUrl("http://localhost/x").ok === false);
  check("127.0.0.1 é rejeitado", validateDestinationUrl("http://127.0.0.1/x").ok === false);
  check("::1 é rejeitado", validateDestinationUrl("http://[::1]/x").ok === false);
  check("metadata de nuvem (169.254.169.254) é rejeitada",
    validateDestinationUrl("http://169.254.169.254/latest/meta-data/").ok === false);
  check("rede privada 10.x é rejeitada", validateDestinationUrl("http://10.0.0.5/x").ok === false);
  check("rede privada 192.168.x é rejeitada", validateDestinationUrl("http://192.168.1.1/x").ok === false);
  check("rede privada 172.16-31.x é rejeitada", validateDestinationUrl("http://172.20.0.1/x").ok === false);
  check(".internal é rejeitado", validateDestinationUrl("http://db.internal/x").ok === false);

  check("URL com CR/LF (header splitting) é rejeitada",
    validateDestinationUrl("https://site.com/a\r\nLocation: https://mau.com").ok === false);
  check("URL acima de 2048 caracteres é rejeitada",
    validateDestinationUrl("https://site.com/" + "a".repeat(2100)).ok === false);
  check("texto que não é URL é rejeitado", validateDestinationUrl("nao-e-url").ok === false);
  check("string vazia é rejeitada", validateDestinationUrl("   ").ok === false);

  check("banco tem CHECK de scheme como última linha de defesa",
    migration.includes("managed_links_destination_scheme") &&
    migration.includes("'^https?://'"));
  check("banco tem CHECK de tamanho do destino",
    migration.includes("managed_links_destination_len"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 3. Rota pública de redirect ==\n");

  check("TESTE 2: usa 302, nunca 301",
    redirectRoute.includes("const REDIRECT_STATUS = 302") &&
    !/\b301\b/.test(redirectCodigo));
  check("TESTE 2: redireciona com NextResponse.redirect",
    redirectRoute.includes("NextResponse.redirect(finalUrl"));

  check("TESTE 4: link pausado devolve 410 e NÃO redireciona",
    /out_status === "paused"[\s\S]{0,400}htmlResponse\(410/.test(redirectRoute));
  check("TESTE 4: destino nunca é revelado na página de pausado",
    !/htmlResponse\(410[^)]*out_destination/.test(redirectRoute));
  check("TESTE 5: slug inexistente devolve 404",
    /if \(!row\)[\s\S]{0,300}htmlResponse\(404/.test(redirectRoute));
  check("slug malformado devolve 404 sem ir ao banco",
    /isWellFormedSlug\(slug\)[\s\S]{0,200}htmlResponse\(404/.test(redirectRoute));
  check("link arquivado devolve 404 (exclusão suave)",
    /out_status === "archived"[\s\S]{0,300}htmlResponse\(404/.test(redirectRoute));
  check("destino inválido no banco não vira redirect",
    /if \(!row\.out_destination_valid \|\| !check\.ok\)[\s\S]{0,400}htmlResponse\(410/.test(redirectRoute));

  // Open redirect
  check("SEM OPEN REDIRECT: a rota não lê nenhum parâmetro de URL de destino",
    !/searchParams\.get\(["'](url|to|dest|destination|next|redirect|r)["']\)/.test(redirectRoute));
  check("SEM OPEN REDIRECT: o destino vem só da RPC do banco",
    redirectRoute.includes("row.out_destination") &&
    redirectRoute.includes("resolve_managed_link"));

  // Cloaking
  check("SEM CLOAKING: User-Agent só alimenta analytics, nunca o destino",
    !/user-agent[\s\S]{0,400}(destination|finalUrl\s*=)/i.test(
      redirectRoute.replace(/deviceTypeFromUserAgent|browserFamilyFromUserAgent/g, "")));
  check("SEM CLOAKING: nenhuma ramificação por bot/crawler",
    // \b evita casar com "robots" do X-Robots-Tag, que é SEO e não cloaking.
    !/\b(bot|bots|crawler|spider|facebookexternalhit)\b/i.test(redirectCodigo));
  check("SEM CLOAKING: nenhuma ramificação por país no cálculo do destino",
    !/country[\s\S]{0,120}(finalUrl|out_destination)\s*=/.test(redirectRoute));

  // Cache e SEO
  check("Cache-Control impede cache do destino antigo",
    redirectRoute.includes('"Cache-Control": "private, no-store, max-age=0, must-revalidate"'));
  check("X-Robots-Tag: noindex, nofollow",
    redirectRoute.includes('"X-Robots-Tag": "noindex, nofollow"'));
  check("os headers valem também nas páginas de erro (404/410)",
    redirectRoute.includes("...BASE_HEADERS"));

  // Performance
  check("PERF: uma única ida ao banco resolve destino + clique",
    (redirectRoute.match(/await getSupabaseAdmin\(\)/g) ?? []).length === 1);
  check("PERF: sem chamada à Meta API na rota de redirect",
    !/meta-publish|graph\.instagram|graph\.facebook/.test(redirectRoute));
  check("PERF: sem FFmpeg na rota de redirect",
    !/ffmpeg|video-effects|video-processing/.test(redirectRoute));
  check("PERF: middleware não intercepta /r/* (sem custo de sessão)",
    !middleware.includes('"/r/') && !/matcher[\s\S]{0,300}"\/r/.test(middleware));
  check("log de observabilidade traz elapsed_ms",
    redirectRoute.includes("elapsed_ms="));
  check("log não expõe destino completo nem token",
    !/console\.log\([^)]*out_destination/.test(redirectRoute) &&
    !/access_token|service_role/.test(redirectRoute));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 4. Registro de clique e concorrência ==\n");

  check("TESTE 9: incremento é atômico no banco (um único UPDATE)",
    migration.includes("SET click_count = ml.click_count + 1"));
  check("TESTE 9: nenhum ler-somar-gravar no código TypeScript",
    !/click_count:\s*\w+\.click_count\s*\+\s*1/.test(redirectRoute + listRoute + itemRoute));
  check("TESTE 10: analytics isolado por bloco EXCEPTION na RPC",
    /BEGIN[\s\S]{0,900}EXCEPTION WHEN OTHERS THEN[\s\S]{0,200}v_logged := false/.test(migration));
  check("TESTE 10: a RPC devolve o destino mesmo com o clique falhando",
    /EXCEPTION WHEN OTHERS[\s\S]{0,300}out_destination\s*:=\s*v_dest/.test(migration));
  check("sem `void promise` de analytics (serverless mataria depois da resposta)",
    !/void\s+\w*\.?(from|insert|rpc)/.test(redirectCodigo));
  check("clique só é registrado quando o link de fato redireciona",
    migration.includes("IF v_status = 'active' AND v_valid THEN"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 5. UTM e repasse de parâmetros ==\n");

  const incoming = new URLSearchParams("utm_source=instagram&utm_campaign=storyA");

  // TESTE 12
  check("TESTE 12: forward=false — query pública não altera o destino",
    buildRedirectUrl("https://site.com/oferta", incoming, false) === "https://site.com/oferta");

  // TESTE 11
  const merged = buildRedirectUrl("https://site.com/oferta", incoming, true);
  check("TESTE 11: forward=true anexa os parâmetros",
    merged === "https://site.com/oferta?utm_source=instagram&utm_campaign=storyA");

  const mergedComQuery = new URL(
    buildRedirectUrl("https://site.com/oferta?plano=pro", incoming, true));
  check("TESTE 11: merge preserva a query já existente no destino",
    mergedComQuery.searchParams.get("plano") === "pro" &&
    mergedComQuery.searchParams.get("utm_source") === "instagram" &&
    mergedComQuery.searchParams.get("utm_campaign") === "storyA");

  const conflito = new URL(buildRedirectUrl(
    "https://site.com/x?ref=dono", new URLSearchParams("ref=invasor"), true));
  check("TESTE 11: parâmetro do destino tem precedência sobre o do visitante",
    conflito.searchParams.get("ref") === "dono" &&
    conflito.searchParams.getAll("ref").length === 1);

  const muitos = new URLSearchParams();
  for (let i = 0; i < 60; i++) muitos.set(`p${i}`, "v");
  const limitado = new URL(buildRedirectUrl("https://site.com/x", muitos, true));
  check("merge tem teto de parâmetros repassados",
    [...limitado.searchParams.keys()].length <= 25);

  check("merge usa URLSearchParams, não concatenação de string",
    src("lib/managed-links.ts").includes("target.searchParams.append") &&
    !/destination\s*\+\s*["'`]\?/.test(libCodigo));

  check("UTM da URL pública é registrado no analytics",
    redirectRoute.includes('p_utm_source: q.get("utm_source")') &&
    redirectRoute.includes('p_utm_medium: q.get("utm_medium")') &&
    redirectRoute.includes('p_utm_campaign: q.get("utm_campaign")'));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 6. Privacidade ==\n");

  // TESTE 13
  check("TESTE 13: do referer sobra só o hostname",
    referrerHost("https://www.instagram.com/stories/perfil/123?token=SEGREDO") === "www.instagram.com");
  check("TESTE 13: referer ausente vira null", referrerHost(null) === null);
  check("TESTE 13: referer malformado vira null", referrerHost("nao-e-url") === null);

  // TESTE 14
  const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const UA_WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
  const UA_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1";
  const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0";

  check("TESTE 14: iPhone → mobile", deviceTypeFromUserAgent(UA_IPHONE) === "mobile");
  check("TESTE 14: Windows → desktop", deviceTypeFromUserAgent(UA_WIN_CHROME) === "desktop");
  check("TESTE 14: iPad → tablet", deviceTypeFromUserAgent(UA_IPAD) === "tablet");
  check("TESTE 14: UA ausente → other", deviceTypeFromUserAgent(null) === "other");
  check("TESTE 14: navegador vira família (Safari)",
    browserFamilyFromUserAgent(UA_IPHONE) === "Safari");
  check("TESTE 14: Chrome detectado", browserFamilyFromUserAgent(UA_WIN_CHROME) === "Chrome");
  check("TESTE 14: Edge não é confundido com Chrome",
    browserFamilyFromUserAgent(UA_EDGE) === "Edge");
  check("TESTE 14: a categoria nunca é o User-Agent inteiro",
    !String(deviceTypeFromUserAgent(UA_WIN_CHROME)).includes("Mozilla") &&
    ["desktop", "mobile", "tablet", "other"].includes(deviceTypeFromUserAgent(UA_WIN_CHROME)));

  check("a tabela de cliques não tem coluna de IP",
    !/\bip\b|ip_address|ip_hash/.test(
      migration.slice(migration.indexOf("managed_link_clicks ("),
                      migration.indexOf("managed_link_clicks (") + 900)));
  check("a tabela de cliques não guarda User-Agent bruto",
    !/user_agent/.test(migration));
  check("a rota nunca lê o IP do visitante",
    !/x-forwarded-for|x-real-ip|req\.ip\b/.test(redirectRoute));
  check("sem hash de fingerprint do visitante (unique clicks fora do MVP)",
    !/createHash|fingerprint|visitor_hash/.test(redirectRoute));
  check("só o código de país (2 letras) é lido do edge",
    redirectRoute.includes("x-vercel-ip-country") &&
    migration.includes("char_length(country) <= 2"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 7. Autorização e IDOR ==\n");

  check("GET /api/links exige sessão", listRoute.includes('"Não autenticado."'));
  check("POST /api/links exige sessão",
    (listRoute.match(/Não autenticado/g) ?? []).length >= 2);
  check("user_id vem SEMPRE da sessão, nunca do corpo da requisição",
    listRoute.includes("user_id: user.id") &&
    !/body\.user_id|body\["user_id"\]/.test(listRoute + itemRoute));

  const chamadasPorId = (itemRoute.match(/\.eq\("id", id\)/g) ?? []).length;
  const donoPorId = (itemRoute.match(/\.eq\("user_id", user\.id\)/g) ?? []).length;
  check("TESTE 8: toda query por id traz também o filtro de dono",
    chamadasPorId > 0 && donoPorId >= chamadasPorId);
  check("TESTE 8: o UPDATE também filtra por dono (não só a leitura)",
    /\.update\(patch\)[\s\S]{0,200}\.eq\("user_id", user\.id\)/.test(itemRoute));
  check("TESTE 8: o DELETE também filtra por dono",
    /\.delete\(\)[\s\S]{0,200}\.eq\("user_id", user\.id\)/.test(itemRoute));
  check("TESTE 8: link de outro usuário devolve 404 (não confirma existência)",
    itemRoute.includes('{ error: "Link não encontrado." }, { status: 404 }'));
  check("TESTE 8: analytics valida o dono dentro da própria RPC",
    migration.includes("WHERE id = p_link_id AND user_id = p_user_id"));
  check("TESTE 8: analytics de link alheio devolve NULL → 404",
    analyticsRoute.includes("if (!data) return NextResponse.json({ error"));

  check("id malformado não chega ao Postgres (evita 500 por 22P02)",
    itemRoute.includes("isUuid(id)") && analyticsRoute.includes("isUuid(id)"));
  check("isUuid rejeita id inválido", isUuid("nao-e-uuid") === false &&
    isUuid("123e4567-e89b-12d3-a456-426614174000") === true);

  check("vínculo com conta é validado contra o dono",
    listRoute.includes("userOwnsAccount") && itemRoute.includes("userOwnsAccount"));
  check("vínculo com campanha é validado contra o dono",
    listRoute.includes("userOwnsCampaign") && itemRoute.includes("userOwnsCampaign"));

  check("rate limit de criação por hora",
    listRoute.includes("CREATE_RATE_LIMIT_PER_HOUR") && listRoute.includes("status: 429"));
  check("teto absoluto de links por usuário",
    listRoute.includes("MAX_LINKS_PER_USER"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 8. Edição de destino e histórico ==\n");

  check("TESTE 3: o PATCH nunca altera o slug",
    !/patch\.slug|slug:\s*(body|check)/.test(itemRoute));
  check("TESTE 3: trocar o destino gera evento no histórico",
    itemRoute.includes('change_type: "destination_changed"'));
  check("old_destination_url vem do banco, não do frontend",
    /\.select\(SELECT_FIELDS\)[\s\S]{0,400}const prev = current/.test(itemRoute) &&
    !/body\.old_destination_url/.test(itemRoute));
  check("criação também entra no histórico",
    listRoute.includes('change_type: "created"'));
  check("pausar/ativar/arquivar entram no histórico",
    itemRoute.includes('"activated"') && itemRoute.includes('"deactivated"') &&
    itemRoute.includes('"archived"'));
  check("histórico não guarda segredo (só URLs de destino e tipo do evento)",
    !/token|secret|password|senha/i.test(
      migration.slice(migration.indexOf("managed_link_history ("),
                      migration.indexOf("managed_link_history (") + 600)));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 9. Banco: RLS, índices e agregação ==\n");

  check("RLS ligada nas três tabelas",
    (migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length === 3);
  check("policy de links: só o dono",
    migration.includes('CREATE POLICY "users_manage_own_links"') &&
    migration.includes("auth.uid() = user_id"));
  check("policy de histórico: só o dono", migration.includes("users_read_own_link_history"));
  check("policy de cliques: só o dono do link",
    /users_read_own_link_clicks[\s\S]{0,400}l\.user_id = auth\.uid\(\)/.test(migration));
  check("cliques não têm policy de INSERT para usuário (só a RPC grava)",
    !/managed_link_clicks[\s\S]{0,200}FOR INSERT/.test(migration));

  check("RPC do redirect é SECURITY DEFINER e só do service_role",
    /resolve_managed_link[\s\S]{0,3000}SECURITY DEFINER/.test(migration) &&
    /REVOKE ALL ON FUNCTION public\.resolve_managed_link[\s\S]{0,200}FROM public, anon, authenticated/.test(migration));
  check("RPCs de agregação também são revogadas de anon/authenticated",
    /REVOKE ALL ON FUNCTION public\.get_managed_link_overview/.test(migration) &&
    /REVOKE ALL ON FUNCTION public\.get_managed_link_analytics/.test(migration));
  check("search_path fixo nas funções SECURITY DEFINER",
    (migration.match(/SET search_path = public/g) ?? []).length >= 3);

  check("índice de cliques por link e tempo",
    migration.includes("managed_link_clicks_link_time_idx"));
  check("índice de histórico por link e tempo",
    migration.includes("managed_link_history_link_idx"));
  check("índices de listagem por usuário",
    migration.includes("managed_links_user_created_idx") &&
    migration.includes("managed_links_user_status_idx"));
  check("índice preparado para retenção futura de cliques",
    migration.includes("managed_link_clicks_time_idx"));

  check("PAGINAÇÃO: a listagem usa range, não limit gigante",
    listRoute.includes(".range(page * PAGE_SIZE") &&
    !/\.limit\(\s*\d{5,}\s*\)/.test(listRoute));
  check("PAGINAÇÃO: analytics é agregado por RPC, sem trazer clique para o browser",
    analyticsRoute.includes("get_managed_link_analytics") &&
    !analyticsCodigo.includes("managed_link_clicks"));
  check("resumo da lista também vem de RPC agregada",
    listRoute.includes("get_managed_link_overview"));
  check("amostra de cliques recentes tem teto fixo",
    /ORDER BY clicked_at DESC LIMIT 50/.test(migration));

  check("CASCADE apaga histórico e cliques junto com o link",
    (migration.match(/REFERENCES public\.managed_links\(id\) ON DELETE CASCADE/g) ?? []).length === 2);
  check("conta vinculada usa ON DELETE SET NULL",
    migration.includes("REFERENCES public.instagram_accounts(id) ON DELETE SET NULL"));
  check("status substitui is_active e cobre archived",
    migration.includes("CHECK (status IN ('active', 'paused', 'archived'))"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 10. Domínio público ==\n");

  check("domínio nunca é hardcodado na lib",
    !/go\.(autoscale|exemplo|meudominio)\.com/.test(src("lib/link-base-url.ts")));
  check("usa NEXT_PUBLIC_REDIRECT_BASE_URL",
    src("lib/link-base-url.ts").includes("NEXT_PUBLIC_REDIRECT_BASE_URL") &&
    src("lib/managed-links.ts").includes("NEXT_PUBLIC_REDIRECT_BASE_URL"));
  check("TESTE 1: URL pública é {base}/r/{slug}",
    publicLinkUrl("x8K2pA", "https://go.exemplo.com") === "https://go.exemplo.com/r/x8K2pA");
  check("barra final da base é normalizada",
    publicLinkUrl("abc", "https://go.exemplo.com/") === "https://go.exemplo.com/r/abc");
  check("UI avisa quando o domínio não está configurado",
    src("app/dashboard/links/page.tsx").includes("hasConfiguredDomain") &&
    src("app/dashboard/links/page.tsx").includes("NEXT_PUBLIC_REDIRECT_BASE_URL"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 11. Integração com Stories ==\n");

  check("TESTE 15: o Story recebe a URL PÚBLICA derivada do slug",
    postNow.includes("storyLinkUrl = publicLinkUrl(row.slug"));
  check("TESTE 15: o destination_url nunca é lido para o Story",
    !postNowCodigo.includes("destination_url"));
  check("TESTE 15: URL mandada pelo frontend é ignorada quando há link gerenciado",
    /if \(body\.managed_link_id\)[\s\S]{0,900}\} else if \(body\.story_link_url\)/.test(postNow));
  check("TESTE 15: link gerenciado precisa pertencer ao usuário",
    /managed_links[\s\S]{0,300}\.eq\("user_id", user\.id\)/.test(postNow));
  check("TESTE 15: link pausado/arquivado não pode ser usado no Story",
    postNow.includes('row.status !== "active"'));
  check("link direto do Story passa pela mesma validação de scheme",
    postNow.includes("validateDestinationUrl(body.story_link_url)"));
  check("nada de link é criado automaticamente sem confirmação",
    !/\.from\("managed_links"\)[\s\S]{0,200}\.insert\(/.test(postNow));

  check("a integração não tocou em OAuth, token, proxy ou Meta App",
    !/oauth|access_token|proxy|meta_app/i.test(postNowCodigo));
  check("video_processing_mode do Story permanece intacto",
    postNow.includes("normalizeProcessingMode") &&
    postNow.includes("video_processing_mode: processingMode"));
  check("a UI diz a verdade sobre o sticker de link não existir na API",
    src("components/dashboard/StoryLinkSelector.tsx").includes("não permite anexar o sticker de link"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 12. UI ==\n");

  const page = src("app/dashboard/links/page.tsx");
  const detail = src("app/dashboard/links/[id]/page.tsx");

  check("cópia dá feedback ao usuário",
    page.includes("navigator.clipboard.writeText") && page.includes("Link copiado"));
  check("exclusão definitiva exige dois cliques",
    page.includes("confirmDeleteId") && page.includes("Confirmar?"));
  check("arquivar é oferecido como alternativa à exclusão",
    page.includes("Arquivar") || page.includes("archived"));
  check("state só é atualizado depois da confirmação do servidor",
    /if \(!res\.ok \|\| !data\.link\)[\s\S]{0,200}return;[\s\S]{0,200}setLinks/.test(page));
  check("Design System: glass-card e paleta matrix/electric",
    page.includes("glass-card") && page.includes("#00FF41") && page.includes("#00E5FF"));
  check("detalhe mostra cliques hoje / 7 / 30 dias",
    detail.includes("clicks_today") && detail.includes("clicks_7d") && detail.includes("clicks_30d"));
  check("detalhe mostra histórico de alterações",
    detail.includes("Histórico de alterações"));
  check("detalhe explica que não há IP nem User-Agent completo",
    detail.includes("Sem IP e sem User-Agent completo"));
  check("link externo do destino usa noopener/nofollow",
    page.includes('rel="noopener noreferrer nofollow"'));
  check("Sidebar tem a entrada de Links",
    src("components/dashboard/Sidebar.tsx").includes('href: "/dashboard/links"'));


  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 13. Credenciais nunca chegam ao browser ==\n");

  // /api/accounts/list e consumido direto por seis telas do dashboard. Tudo que
  // entra no SELECT vira JSON no browser.
  const accountsList = src("app/api/accounts/list/route.ts");
  const selectAccountsList = (accountsList.match(/\.select\(([\s\S]*?)\)/) ?? ["", ""])[1];

  check("/api/accounts/list NAO seleciona access_token",
    !/\baccess_token\b/.test(selectAccountsList));
  check("/api/accounts/list NAO seleciona meta_access_token",
    !/meta_access_token/.test(selectAccountsList));
  check("/api/accounts/list NAO seleciona proxy_url",
    !/proxy_url/.test(selectAccountsList));
  check("/api/accounts/list NAO devolve credencial em lugar nenhum da resposta",
    !/access_token|proxy_url|app_secret|password/i.test(semComentarios(accountsList)));
  check("/api/accounts/list continua entregando o que a UI usa",
    ["id", "username", "display_name", "avatar_url", "is_active",
     "ig_business_account_id", "health_status", "folder_id"]
      .every((campo) => selectAccountsList.includes(campo)));

  // Rotas consumidas por Client Component nao podem serializar credencial.
  const rotasDeBrowser = [
    "app/api/accounts/list/route.ts",
    "app/api/apps/route.ts",
    "app/api/proxy-pool/route.ts",
    "app/api/links/route.ts",
    "app/api/links/[id]/route.ts",
    "app/api/links/[id]/analytics/route.ts",
  ];
  for (const rota of rotasDeBrowser) {
    const conteudo = semComentarios(src(rota));
    const selects = conteudo.match(/\.select\(([\s\S]*?)\)/g) ?? [];
    const temCredencial = selects.some((sel) =>
      /\baccess_token\b|meta_access_token|ig_app_secret|refresh_token/.test(sel));
    check(`${rota.replace("app/api/", "")}: nenhum SELECT traz credencial`, !temCredencial);
  }

  // O modulo Links nao toca em credencial nenhuma.
  const arquivosLinks = [
    "app/r/[slug]/route.ts", "app/api/links/route.ts",
    "app/api/links/[id]/route.ts", "app/api/links/[id]/analytics/route.ts",
    "lib/managed-links.ts", "lib/managed-links-db.ts", "lib/link-base-url.ts",
    "app/dashboard/links/page.tsx", "app/dashboard/links/[id]/page.tsx",
    "components/dashboard/StoryLinkSelector.tsx",
  ];
  for (const arq of arquivosLinks) {
    check(`${arq}: sem token/segredo`,
      !/\baccess_token\b|meta_access_token|ig_app_secret|refresh_token|proxy_url/
        .test(semComentarios(src(arq))));
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 14. Ordem: validar antes de contar ==\n");

  const posValida = migration.indexOf("is_valid_link_destination(v_dest)");
  const posConta = migration.indexOf("SET click_count = ml.click_count + 1");
  check("a RPC valida o destino ANTES de incrementar o contador",
    posValida > 0 && posConta > 0 && posValida < posConta);
  check("o incremento so acontece com status active E destino valido",
    migration.includes("IF v_status = 'active' AND v_valid THEN"));
  check("existe a funcao de validade no banco",
    migration.includes("CREATE OR REPLACE FUNCTION public.is_valid_link_destination"));
  check("is_valid_link_destination tambem e revogada de anon/authenticated",
    /REVOKE ALL ON FUNCTION public\.is_valid_link_destination/.test(migration));

  // Savepoints separados: contador e linha de detalhe sao coisas diferentes.
  const trechoAtivo = migration.slice(
    migration.indexOf("IF v_status = 'active' AND v_valid THEN"),
    migration.indexOf("out_link_id           := v_id"));
  check("contador e detalhe tem blocos EXCEPTION separados",
    (trechoAtivo.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length === 2);
  check("falha no contador nao derruba a funcao", trechoAtivo.includes("v_counted := false"));
  check("falha no detalhe nao derruba a funcao", trechoAtivo.includes("v_logged := false"));

  check("a rota usa o veredito do banco para decidir o 410",
    redirectRoute.includes("!row.out_destination_valid"));
  check("a rota loga se o clique foi contado",
    redirectRoute.includes("click_counted="));
  check("a RPC devolve destination_valid, click_counted e click_logged",
    migration.includes("out_destination_valid  boolean") &&
    migration.includes("out_click_counted      boolean") &&
    migration.includes("out_click_logged       boolean"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 15. country e best-effort de analytics ==\n");

  // As UNICAS linhas de codigo que mencionam country devem ser a leitura do
  // header e a passagem para o analytics. Qualquer terceira linha e sinal de
  // que o pais comecou a influenciar alguma decisao.
  const linhasCountry = semComentarios(redirectRoute)
    .split("\n")
    .filter((l) => l.includes("country"));
  check("country e lido uma vez e passado so para o analytics",
    linhasCountry.length === 2 &&
    linhasCountry[0].includes('req.headers.get("x-vercel-ip-country")') &&
    linhasCountry[1].trim() === "p_country: country,");
  check("country nao participa de nenhuma decisao (sem if/ternario)",
    !/if\s*\([^)]*country|country\s*(===|!==|==|!=)|country\s*\?/.test(semComentarios(redirectRoute)));
  check("country nao entra no calculo do destino",
    !/country[\s\S]{0,150}(finalUrl|out_destination|buildRedirectUrl)/
      .test(semComentarios(redirectRoute)));
  check("o banco so aceita codigo de 2 letras",
    migration.includes("char_length(country) <= 2"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 16. Redacao precisa sobre redirect por parametro ==\n");

  const claude = src("CLAUDE.md");
  check("a rota descreve o mecanismo em vez de afirmar impossibilidade",
    redirectRoute.includes("não existe redirect controlado") &&
    redirectRoute.includes("resolvido exclusivamente pelo slug"));
  check("CLAUDE.md descreve o mecanismo",
    claude.includes("Nenhum redirect é controlado por parâmetro de URL") &&
    claude.includes("previamente persistido por usuário autenticado"));
  check("nenhuma doc do modulo afirma 'open redirect impossível'",
    !/open redirect[^.\n]{0,20}impossível/i.test(claude + src("docs/MEMORIA.md")));
  check("CLAUDE.md documenta que click_count so conta redirect bem-sucedido",
    claude.includes("`click_count` conta redirect bem-sucedido"));
  check("CLAUDE.md documenta country como best-effort",
    claude.includes("`country` é analytics best-effort"));
  check("CLAUDE.md proibe credencial serializada para o browser",
    claude.includes("Credencial nunca é serializada para o browser"));

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n== 17. Comportamento real do banco ==\n");

  const env = carregarEnv();
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!dbUrl || !dbKey) {
    console.log("  SKIP  sem credencial de banco (.env.local ausente) — secao pulada");
  } else {
    const db = criarClienteDb(dbUrl, dbKey);
    const marca = "zt" + Math.random().toString(36).slice(2, 7);
    let semeou = false;

    try {
      const donos = await db.select("managed_links", "select=user_id&limit=1");
      // Precisa de um user_id valido; usa o primeiro usuario existente.
      const usuarios = donos.length
        ? [{ id: donos[0].user_id }]
        : await db.select("user_roles", "select=user_id&limit=1")
            .then((r) => r.map((x) => ({ id: x.user_id })));

      if (!usuarios.length) {
        console.log("  SKIP  nenhum usuario no banco para semear os testes");
      } else {
        const dono = usuarios[0].id;

        const semeados = await db.insert("managed_links", [
          { user_id: dono, slug: marca + "AT", destination_url: "https://exemplo-teste.com/ok", status: "active" },
          { user_id: dono, slug: marca + "PA", destination_url: "https://exemplo-teste.com/ok", status: "paused" },
          { user_id: dono, slug: marca + "AR", destination_url: "https://exemplo-teste.com/ok", status: "archived" },
          // Passa no CHECK do banco (^https?://) mas reprova em
          // is_valid_link_destination — e exatamente o caso "destino invalido".
          { user_id: dono, slug: marca + "IN", destination_url: "https://127.0.0.1/interno", status: "active" },
        ]);
        semeou = semeados.length === 4;

        const contador = async (slug) => {
          const [linha] = await db.select("managed_links", `slug=eq.${slug}&select=click_count,id`);
          return linha;
        };
        const linhasDeClique = async (id) =>
          (await db.select("managed_link_clicks", `link_id=eq.${id}&select=id`)).length;

        // active valido → +1
        const rAtivo = (await db.rpc("resolve_managed_link", {
          p_slug: marca + "AT", p_device_type: "mobile", p_browser_family: "Chrome",
        }))[0];
        const cAtivo = await contador(marca + "AT");
        check("TESTE: active valido → click_count +1",
          cAtivo.click_count === 1 && rAtivo.out_click_counted === true);
        check("TESTE: active valido → 1 linha em managed_link_clicks",
          (await linhasDeClique(cAtivo.id)) === 1 && rAtivo.out_click_logged === true);
        check("TESTE: active valido devolve o destino",
          rAtivo.out_destination === "https://exemplo-teste.com/ok" &&
          rAtivo.out_destination_valid === true);

        // paused → +0
        const rPausado = (await db.rpc("resolve_managed_link", { p_slug: marca + "PA" }))[0];
        const cPausado = await contador(marca + "PA");
        check("TESTE: paused → click_count +0",
          cPausado.click_count === 0 && rPausado.out_click_counted === false);
        check("TESTE: paused → nenhuma linha de clique",
          (await linhasDeClique(cPausado.id)) === 0);

        // archived → +0
        const rArquivado = (await db.rpc("resolve_managed_link", { p_slug: marca + "AR" }))[0];
        const cArquivado = await contador(marca + "AR");
        check("TESTE: archived → click_count +0",
          cArquivado.click_count === 0 && rArquivado.out_click_counted === false);
        check("TESTE: archived → nenhuma linha de clique",
          (await linhasDeClique(cArquivado.id)) === 0);

        // destino invalido → +0
        const rInvalido = (await db.rpc("resolve_managed_link", { p_slug: marca + "IN" }))[0];
        const cInvalido = await contador(marca + "IN");
        check("TESTE: destino invalido → click_count +0",
          cInvalido.click_count === 0 && rInvalido.out_click_counted === false);
        check("TESTE: destino invalido → nenhuma linha de clique",
          (await linhasDeClique(cInvalido.id)) === 0);
        check("TESTE: destino invalido e sinalizado para a rota",
          rInvalido.out_destination_valid === false && rInvalido.out_status === "active");

        // inexistente → nenhuma linha
        const rNada = await db.rpc("resolve_managed_link", { p_slug: "naoexiste" + marca });
        check("TESTE: slug inexistente → RPC devolve zero linhas", rNada.length === 0);

        // falha SO no INSERT de analytics → contador soma e destino volta
        const rFalha = (await db.rpc("resolve_managed_link", {
          p_slug: marca + "AT", p_device_type: "categoria-invalida",
        }))[0];
        const cFalha = await contador(marca + "AT");
        check("TESTE: falha so no INSERT de analytics → destino ainda e devolvido",
          rFalha.out_destination === "https://exemplo-teste.com/ok");
        check("TESTE: falha so no INSERT de analytics → click_logged=false",
          rFalha.out_click_logged === false);
        check("TESTE: falha so no INSERT de analytics → contador continua somando",
          rFalha.out_click_counted === true && cFalha.click_count === 2);
        check("TESTE: falha so no INSERT de analytics → nenhuma linha nova de detalhe",
          (await linhasDeClique(cFalha.id)) === 1);

        // Acordo entre as duas implementacoes de validacao.
        const corpus = [
          "https://exemplo.com/a", "http://exemplo.com/a", "https://sub.exemplo.com:8443/a?b=1#c",
          "https://fcbarcelona.com/loja", "https://fdny.org/x", "https://exemplo.com/a?u=x@y.com",
          "javascript:alert(1)", "file:///etc/passwd", "data:text/html,<script>",
          "ftp://exemplo.com/a", "chrome://settings", "about:blank",
          "https://usuario:senha@site.com/a", "https://usuario@site.com/a",
          "http://localhost/x", "http://app.localhost/x", "http://127.0.0.1/x",
          "http://0.0.0.0/x", "http://[::1]/x", "http://[fd00::1]/x",
          "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/x",
          "http://192.168.1.1/x", "http://172.20.0.1/x", "http://172.32.0.1/x",
          "http://100.64.0.1/x", "http://100.128.0.1/x", "http://db.internal/x",
          "http://impressora.local/x", "nao-e-url", "https://",
          "https://exemplo.com/" + "a".repeat(2100),
        ];
        let divergencias = 0;
        for (const url of corpus) {
          const ts = validateDestinationUrl(url).ok;
          const sql = await db.rpc("is_valid_link_destination", { p_url: url });
          if (ts !== sql) {
            divergencias++;
            console.log(`        divergencia: ${url.slice(0, 60)} — ts=${ts} sql=${sql}`);
          }
        }
        check(`TS e SQL concordam em ${corpus.length} URLs do corpus`, divergencias === 0);
      }
    } finally {
      if (semeou) await db.remove("managed_links", `slug=like.${marca}*`);
      const sobrou = await db.select("managed_links", `slug=like.${marca}*&select=id`);
      check("dados de teste removidos do banco", sobrou.length === 0);
    }
  }

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
