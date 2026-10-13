import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: "400",
  style: "italic",
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
  themeColor: "#05070c",
};

/**
 * Inline script that applies the saved theme before hydration to prevent flash.
 * Reads `sm-theme` from localStorage; falls back to system preference; defaults to dark.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('sm-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored
      : stored === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`antialiased ${geist.className}`}
        style={{ background: "var(--bg)", color: "var(--ink)" }}
      >
        {children}
      </body>
    </html>
  );
}