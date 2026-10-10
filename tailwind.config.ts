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
        // Scale Master — Navy / Blue / Silver palette
        "brand-navy": "#001244",
        "brand-blue": "#00498D",
        "brand-silver": "#BEB8BC",
        background: "#061427",
        surface: "#0B203A",
        "surface-elevated": "#102D4D",
        "surface-hover": "#153859",
        border: "#28415F",
        "primary-hover": "#075BA6",
        focus: "#85B9E9",
        "text-primary": "#F2F5F9",
        "text-secondary": "#AFBDD0",
        "text-muted": "#889DB7",
        // Semantic (balanced, not neon)
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        // Legacy aliases kept for backward compat during migration
        matrix: "#00498D",
        electric: "#85B9E9",
        obsidian: "#061427",
        brand: {
          navy: "#001244",
          blue: "#00498D",
          silver: "#BEB8BC",
          "blue-dark": "#00346D",
          "blue-light": "#075BA6",
          // Legacy keys mapped to new palette
          purple: "#00498D",
          cyan: "#85B9E9",
          "purple-dark": "#00346D",
          "purple-light": "#075BA6",
          "cyan-dark": "#00498D",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "hero-gradient": "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,73,141,0.12) 0%, transparent 100%)",
        "spotlight": "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(0,73,141,0.1) 0%, transparent 100%)",
        "brand-gradient": "linear-gradient(90deg, #001244 0%, #00346D 50%, #00498D 100%)",
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
          "0%": { boxShadow: "0 0 5px rgba(0, 73, 141, 0.3)" },
          "100%": { boxShadow: "0 0 16px rgba(0, 73, 141, 0.5), 0 0 32px rgba(133, 185, 233, 0.15)" },
        },
        "border-spin": {
          "to": { "--angle": "360deg" } as Record<string, string>,
        },
        "particle-twinkle": {
          "0%, 100%": { opacity: "0.02" },
          "50%": { opacity: "0.08" },
        },
        "aurora-shift": {
          "0%": { opacity: "0.03", transform: "scale(1) translate(0, 0)" },
          "50%": { opacity: "0.05", transform: "scale(1.04) translate(-1%, 0.5%)" },
          "100%": { opacity: "0.03", transform: "scale(1) translate(0, 0)" },
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