# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# AutoScale — Next.js 15 (App Router)
# Multi-stage: build com node:22 (LTS), runtime enxuto com deps de produção.
# Node 22 é exigido pelo undici v8 (util.markAsUncloneable) e alinha com o
# runtime de produção da Vercel.
# Usa os scripts "build"/"start" do package.json (next build / next start).
# ─────────────────────────────────────────────────────────────

# ---------- deps: instala TODAS as dependências (inclui dev p/ o build) ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: gera o .next ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Variáveis NEXT_PUBLIC_* são inlinadas no bundle do cliente em tempo de build.
# Passadas como build args pelo docker-compose (que as lê do .env).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_REDIRECT_BASE_URL
ARG NEXT_PUBLIC_META_CLIENT_ID
ARG NEXT_PUBLIC_INSTAGRAM_APP_ID
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_REDIRECT_BASE_URL=$NEXT_PUBLIC_REDIRECT_BASE_URL \
    NEXT_PUBLIC_META_CLIENT_ID=$NEXT_PUBLIC_META_CLIENT_ID \
    NEXT_PUBLIC_INSTAGRAM_APP_ID=$NEXT_PUBLIC_INSTAGRAM_APP_ID

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runtime: só dependências de produção + artefato do build ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Só as deps de produção (next start + runtime). @ffmpeg-installer traz o
# binário ffmpeg linux-x64 via optional dependency — não precisa de apt.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Artefatos necessários para "next start"
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
