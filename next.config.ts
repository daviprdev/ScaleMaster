import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Required for Docker deployment — generates .next/standalone with minimal deps
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
  // Não anuncia "X-Powered-By: Next.js" (ajuda a mapear a stack).
  poweredByHeader: false,
  // next/image não é usado no app. Com hostname "**" o /_next/image virava um
  // proxy aberto de imagens de qualquer site, servido pelo nosso domínio.
  images: {
    remotePatterns: [],
  },
  // Não empacotar ffmpeg — usa o binário nativo do Node.js diretamente
  serverExternalPackages: ["fluent-ffmpeg", "@ffmpeg-installer/ffmpeg"],
  async headers() {
    return [
      {
        // Cabeçalhos de segurança em todas as respostas.
        source: "/:path*",
        headers: [
          // Só HTTPS por 2 anos (o Nginx já redireciona HTTP → HTTPS).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Navegador não "adivinha" tipo de arquivo (upload servido como script).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Impede o app de ser embutido em iframe de outro site (clickjacking).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;