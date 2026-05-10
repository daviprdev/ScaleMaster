import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────
// Defina estas variáveis no seu .env.local:
//
//   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   ← nunca exponha no frontend
//
// Encontre os valores em: Supabase Dashboard → Settings → API
// ─────────────────────────────────────────────────────────────

// Inicialização lazy — evita erro durante o build quando as variáveis não estão definidas
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

// Client público (frontend / rotas que usam auth do usuário)
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// Client admin (server-side only — acessa Storage sem RLS)
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    _supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return _supabaseAdmin;
}
