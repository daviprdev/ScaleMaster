import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { BackgroundProvider } from "@/components/BackgroundContext";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Scale Master — Automação Inteligente para Instagram",
  description:
    "Gerencie múltiplas contas, faça scraping de Reels e automatize postagens com IA.",
  applicationName: "Scale Master",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Scale Master",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#061427",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      style={{ background: "#000000" }}
    >
      <body
        className={`antialiased text-white ${inter.className}`}
        style={{ background: "transparent", position: "relative" }}
      >
        <BackgroundProvider>
          {/* Page content — renders above the canvas */}
          <div style={{ position: "relative", zIndex: 1 }}>
            {children}
          </div>
        </BackgroundProvider>
      </body>
    </html>
  );
}
