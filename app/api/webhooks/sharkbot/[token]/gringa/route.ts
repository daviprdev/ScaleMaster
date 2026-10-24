import { NextRequest } from "next/server";
import { receiveSharkBotSale } from "@/lib/sharkbot-webhook";

export const dynamic = "force-dynamic";

// Conta da SharkBot dos bots que vendem para a gringa. As vendas somam junto
// com as da conta principal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return receiveSharkBotSale(req, token, "gringa");
}
