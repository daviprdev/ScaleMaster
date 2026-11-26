import type { Config } from "tailwindcss";

// decisão: color-mix deixa os tokens aceitarem opacidade (bg-danger/20); com var() puro o Tailwind não gera a classe.
const token = (name: string) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    colors: {
      bg: token("--bg"),
      surface: {
        DEFAULT: "var(--surface)",
        raised: "var(--surface-raised)",
        hover: "var(--surface-hover)",
      },
      line: {
        DEFAULT: "var(--line)",
        control: "var(--line-control)",
      },
      ink: {
        DEFAULT: token("--ink"),
        2: "var(--ink-2)",
        3: "var(--ink-3)",
      },
      primary: {
        DEFAULT: token("--primary"),
        hover: token("--primary-hover"),
        fg: token("--on-primary"),
      },
      "primary-2": token("--primary-2"),
      link: token("--link"),
      accent: token("--accent"),
      focus: token("--focus"),
      wordmark: token("--wordmark"),
      brand: {
        navy: token("--brand-navy"),
        blue: token("--brand-blue"),
        silver: token("--brand-silver"),
      },
      success: {
        DEFAULT: token("--success"),
        soft: "var(--success-soft)",
      },
      warning: {
        DEFAULT: token("--warning"),
        soft: "var(--warning-soft)",
      },
      danger: {
        DEFAULT: token("--danger"),
        soft: "var(--danger-soft)",
      },
      info: {
        soft: "var(--info-soft)",
      },
      overlay: "var(--overlay)",
      transparent: "transparent",
      current: "currentColor",
      white: "#fff",
      black: "#000",
    },
    borderRadius: {
      none: "0",
      sm: "var(--radius-sm)",
      DEFAULT: "var(--radius-md)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      "2xl": "var(--radius-2xl)",
      full: "var(--radius-full)",
    },
    boxShadow: {
      none: "none",
      pop: "var(--shadow-pop)",
      frame: "var(--shadow-frame)",
      glow: "0 12px 30px var(--glow)",
    },
    fontFamily: {
      sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      serif: ["var(--font-serif)", "Georgia", "serif"],
    },
    extend: {
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
      },
    },
  },
  plugins: [],
};

export default config;