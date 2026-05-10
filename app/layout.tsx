import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoScale — Automação Inteligente para Instagram",
  description:
    "Gerencie múltiplas contas, faça scraping de Reels e automatize postagens com IA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased bg-gray-950 text-white">{children}</body>
    </html>
  );
}
