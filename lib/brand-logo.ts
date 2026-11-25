/**
 * Logo da marca em base64 para os ícones gerados (next/og).
 *
 * No Cloudflare Workers o public/ não está no disco do Worker: vem do binding
 * ASSETS. Fora dele (Docker/dev/build), lê do disco como antes.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import fs from "fs";
import path from "path";

const LOGO = "/brand/scale-master-logo.jpg";

type AssetsBinding = { fetch(input: Request): Promise<Response> };

export async function brandLogoBase64(): Promise<string> {
  let assets: AssetsBinding | undefined;
  try {
    assets = (getCloudflareContext().env as unknown as { ASSETS?: AssetsBinding }).ASSETS;
  } catch {
    assets = undefined; // fora do Workers
  }
  if (assets) {
    const res = await assets.fetch(new Request(new URL(LOGO, "https://assets.local")));
    if (!res.ok) throw new Error(`logo da marca: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
  return fs.readFileSync(path.join(process.cwd(), "public", LOGO)).toString("base64");
}
