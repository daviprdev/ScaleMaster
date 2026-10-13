import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    colors: {
      bg: "var(--bg)",
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
        DEFAULT: "var(--ink)",
        2: "var(--ink-2)",
        3: "var(--ink-3)",
      },
      primary: {
        DEFAULT: "var(--primary)",
        hover: "var(--primary-hover)",
        fg: "var(--on-primary)",
      },
      accent: "var(--accent)",
      focus: "var(--focus)",
      wordmark: "var(--wordmark)",
      brand: {
        navy: "var(--brand-navy)",
        blue: "var(--brand-blue)",
        silver: "var(--brand-silver)",
      },
      success: {
        DEFAULT: "var(--success)",
        soft: "var(--success-soft)",
      },
      warning: {
        DEFAULT: "var(--warning)",
        soft: "var(--warning-soft)",
      },
      danger: {
        DEFAULT: "var(--danger)",
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
      full: "var(--radius-full)",
    },
    boxShadow: {
      none: "none",
      pop: "var(--shadow-pop)",
      frame: "var(--shadow-frame)",
    },
    fontFamily: {
      sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      serif: ["var(--font-serif)", "Georgia", "serif"],
    },
    extend: {},
  },
  plugins: [],
};

export default config;