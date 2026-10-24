import { NextRequest } from "next/server";
import { receiveSharkBotSale } from "@/lib/sharkbot-webhook";

export const dynamic = "force-dynamic";

// Conta principal da SharkBot (bots do Brasil).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return receiveSharkBotSale(req, token, "principal");
}
