import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Space Grotesk", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Fira Code", "monospace"],
      },
      colors: {
        // Cyber-Military palette
        matrix: "#00FF41",
        electric: "#00E5FF",
        obsidian: "#000000",
        brand: {
          purple: "#7C3AED",
          cyan: "#06B6D4",
          "purple-dark": "#6D28D9",
          "purple-light": "#8B5CF6",
          "cyan-dark": "#0891B2",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "hero-gradient": "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.12) 0%, transparent 100%)",
        "spotlight": "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(124,58,237,0.1) 0%, transparent 100%)",
      },
      animation: {
        "float": "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
        "border-spin": "border-spin 5s linear infinite",
        "particle-twinkle": "particle-twinkle 4s ease-in-out infinite",
        "aurora-shift": "aurora-shift 14s ease-in-out infinite alternate",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(124, 58, 237, 0.5)" },
          "100%": { boxShadow: "0 0 20px rgba(124, 58, 237, 0.8), 0 0 40px rgba(6, 182, 212, 0.3)" },
        },
        "border-spin": {
          "to": { "--angle": "360deg" } as Record<string, string>,
        },
        "particle-twinkle": {
          "0%, 100%": { opacity: "0.02" },
          "50%": { opacity: "0.1" },
        },
        "aurora-shift": {
          "0%": { opacity: "0.06", transform: "scale(1) translate(0, 0)" },
          "50%": { opacity: "0.09", transform: "scale(1.06) translate(-2%, 1%)" },
          "100%": { opacity: "0.06", transform: "scale(1) translate(0, 0)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
