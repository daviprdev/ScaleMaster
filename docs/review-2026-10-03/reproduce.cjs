// Reproduções de revisão: executam os handlers reais com banco, sessão e rede
// simulados. Não acessam Supabase, Instagram, VPS ou dados de produção.
// Estes checks confirmam o comportamento defeituoso atual; não são testes de
// regressão aprovando esse comportamento. Após corrigir, devem deixar de passar.
// Executar: node docs/review-2026-10-03/reproduce.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const quiet = { log() {}, warn() {}, error() {} };
const json = (body, init = {}) => ({ status: init.status || 200, body });
const userClient = (id) => ({ auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) } });

function load(file, mocks = {}, extra = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  const context = vm.createContext({
    exports: mod.exports, module: mod, console: quiet, AbortSignal,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', RPA_WORKER_SECRET: 'fake-test-secret' } },
    fetch: async () => { throw new Error('Rede proibida neste teste'); },
    require(name) {
      if (name === 'next/server') return { NextResponse: {
        json,
        next: () => ({ status: 200, next: true, cookies: { set() {} } }),
      } };
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      if (name.startsWith('@/')) return {};
      throw new Error(`Import não simulado: ${name}`);
    },
    ...extra,
  });
  new vm.Script(code, { filename: file }).runInContext(context);
  return mod.exports;
}

function memoryDb(initial, options = {}) {
  const tables = structuredClone(initial);
  const removed = [];
  let inserts = 0;
  return {
    tables, removed,
    storage: { from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: `https://test.invalid/${p}` } }),
      remove: async (paths) => { removed.push(...paths); return { error: null }; },
    }) },
    from(table) {
      let operation = 'select', payload, columns = '', single = false;
      const predicates = [];
      let executed;
      const execute = () => {
        if (executed) return executed;
        if (options.stopAtComplexSelect && operation === 'select' && columns.includes('instagram_accounts(')) {
          return executed = { data: null, error: { message: 'Fim controlado da simulação' } };
        }
        tables[table] ||= [];
        let rows = tables[table].filter(r => predicates.every(p => p(r)));
        if (operation === 'insert') {
          inserts++;
          if (inserts === options.failInsertNumber) return executed = { data: null, error: { message: 'Falha simulada no segundo lote' } };
          rows = (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({ id: `new-${inserts}-${i}`, ...r }));
          tables[table].push(...rows);
        } else if (operation === 'update') {
          rows.forEach(r => Object.assign(r, payload));
        } else if (operation === 'delete') {
          tables[table] = tables[table].filter(r => !rows.includes(r));
        }
        return executed = { data: single ? rows[0] ?? null : rows, error: null, count: rows.length };
      };
      const q = {
        select(c = '') { columns = c; return q; },
        insert(p) { operation = 'insert'; payload = p; return q; },
        update(p) { operation = 'update'; payload = p; return q; },
        delete() { operation = 'delete'; return q; },
        eq(k, v) { predicates.push(r => r[k] === v); return q; },
        neq(k, v) { predicates.push(r => r[k] !== v); return q; },
        in(k, vs) { predicates.push(r => vs.includes(r[k])); return q; },
        lte(k, v) { predicates.push(r => r[k] <= v); return q; },
        gte(k, v) { predicates.push(r => r[k] >= v); return q; },
        ilike() { return q; }, not() { return q; }, or() { return q; },
        order() { return q; }, limit() { return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return q;
    },
  };
}

async function main() {
  // 1. Middleware anônimo deixa a rota passar, que usa o segredo do servidor.
  let forwarded = false;
  const middleware = load('middleware.ts', {
    '@supabase/ssr': { createServerClient: () => userClient(null) },
  });
  const middlewareResult = await middleware.middleware({
    nextUrl: { pathname: '/api/admin/rpa/queue' },
    cookies: { getAll: () => [], set() {} },
  });
  assert.equal(middlewareResult.next, true);
  const queue = load('app/api/admin/rpa/queue/route.ts', {}, {
    fetch: async (_url, init) => {
      forwarded = init.headers.Authorization === 'Bearer fake-test-secret';
      return { ok: true, json: async () => ({ paused: false }) };
    },
  });
  const queueResult = await queue.GET();
  assert.equal(queueResult.status, 200);
  assert.equal(forwarded, true);
  console.log('REPRODUZIDO 1: handler administrativo responde e encaminha segredo sem validar sessão.');

  // 2. Caminho alheio pode ser registrado como próprio e removido via API.
  const db = memoryDb({
    library_folders: [{ id: 'own-folder', user_id: 'user-a' }],
    videos_library: [{ id: 'victim-video', user_id: 'user-b', storage_path: 'videos/victim.mp4' }],
  });
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => userClient('user-a') },
    '@/lib/supabase': { getSupabaseAdmin: () => db },
  };
  const record = load('app/api/library/record/route.ts', mocks);
  const created = await record.POST({ json: async () => ({
    storagePath: 'videos/victim.mp4', filename: 'copy.mp4', fileSize: 10, folderId: 'own-folder',
  }) });
  assert.equal(created.status, 200);
  const bulk = load('app/api/library/bulk/route.ts', mocks);
  const deleted = await bulk.DELETE({ json: async () => ({ items: [{ id: created.body.record.id }] }) });
  assert.equal(deleted.status, 200);
  assert.equal(db.removed.includes('videos/victim.mp4'), true);
  assert.equal(db.tables.videos_library.some(r => r.id === 'victim-video'), true);
  console.log('REPRODUZIDO 2: remoção de arquivo compartilhado/alheio enquanto o registro original permanece.');

  // 3. Horário agendado antigo faz auto-heal liberar uma execução recém-iniciada.
  const now = Date.now();
  const queueDb = memoryDb({ scheduled_posts: [{
    id: 'currently-running', status: 'publishing',
    scheduled_at: new Date(now - 30 * 60_000).toISOString(),
    started_at_for_test_only: new Date(now - 10_000).toISOString(),
  }] }, { stopAtComplexSelect: true });
  const scheduled = load('app/api/cron/publish-scheduled/route.ts', {
    '@/lib/supabase': { getSupabaseAdmin: () => queueDb },
    '@/lib/cron-auth': { requireCronAuth: () => ({ ok: true }) },
  });
  await scheduled.GET({});
  assert.equal(queueDb.tables.scheduled_posts[0].status, 'pending');
  console.log('REPRODUZIDO 3: post em processamento há 10 segundos volta a pending por estar agendado há 30 minutos.');

  // 4. Inserção parcial devolve erro mesmo depois de materializar 500 posts.
  const videos = Array.from({ length: 501 }, (_, i) => ({ id: `v-${i}`, public_url: `https://test.invalid/${i}.mp4`, caption: '' }));
  const campaignDb = memoryDb({ instagram_accounts: [{ id: 'a-1', user_id: 'user-a' }] }, { failInsertNumber: 2 });
  const distribute = load('app/api/posts/distribute/route.ts', {
    '@/lib/supabase/server': { createClient: async () => userClient('user-a') },
    '@/lib/supabase': { getSupabaseAdmin: () => campaignDb },
    '@/lib/video-history': { fetchAllRows: async () => videos, fetchVideoUsage: async () => new Map() },
    '@/lib/video-processing': { normalizeProcessingMode: () => 'original' },
    '@/lib/reel-captions': {
      normalizeCaptionMode: () => 'none',
      resolveCaption: () => ({ caption: '', validation: { valid: true }, missingOriginal: false }),
    },
  });
  const result = await distribute.POST({ json: async () => ({
    account_ids: ['a-1'], folder_id: 'folder', video_count: -1,
    posts_per_day: 24, start_at: new Date(now).toISOString(), captions: [],
  }) });
  assert.equal(result.status, 500);
  assert.equal(campaignDb.tables.scheduled_posts.length, 500);
  console.log('REPRODUZIDO 4: campanha com 501 posts retorna erro, mas deixa 500 posts ativos no banco.');
  console.log('4 reproduções confirmadas com handlers reais e dependências simuladas. Nenhum serviço externo acessado.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
