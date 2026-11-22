// Gera os ícones da extensão Scale Master Story a partir do logo do SaaS.
// Uso: node scripts/extensao-story-icones.mjs
import sharp from "sharp";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const logo = path.join(raiz, "public/brand/scale-master-logo.jpg");
const destino = path.join(raiz, "extensao-story/icones");
await mkdir(destino, { recursive: true });

for (const lado of [16, 32, 48, 128]) {
  const raio = Math.round(lado * 0.22);
  const mascara = Buffer.from(
    `<svg width="${lado}" height="${lado}"><rect width="${lado}" height="${lado}" rx="${raio}" ry="${raio}" fill="#fff"/></svg>`,
  );
  await sharp(logo)
    .resize(lado, lado, { kernel: "lanczos3" })
    .composite([{ input: mascara, blend: "dest-in" }])
    .png()
    .toFile(path.join(destino, `${lado}.png`));
  console.log(`icones/${lado}.png`);
}

await mkdir(path.join(raiz, "extensao-story/fontes"), { recursive: true });
await copyFile(path.join(raiz, "public/fonts/geist-latin.woff2"), path.join(raiz, "extensao-story/fontes/geist-latin.woff2"));
console.log("fontes/geist-latin.woff2");
