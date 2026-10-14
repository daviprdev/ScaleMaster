import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

const APP_URL = getAppUrl();

/**
 * Rota do magic link: /add/{token}
 * Redireciona para /add/oauth/{token} que inicia o fluxo OAuth do Instagram.
 * Esta rota existe porque o MagicLinkModal e o python-server geram links
 * no formato /add/{token} (sem o segmento "oauth").
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/add/error?reason=invalid_token`);
  }

  return NextResponse.redirect(`${APP_URL}/add/oauth/${token}`);
}