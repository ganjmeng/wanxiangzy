import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const cssVarColor = (name: string) => `hsl(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: cssVarColor("--border"),
        input: cssVarColor("--input"),
        ring: cssVarColor("--ring"),
        background: cssVarColor("--background"),
        foreground: cssVarColor("--foreground"),
        primary: {
          DEFAULT: cssVarColor("--primary"),
          foreground: cssVarColor("--primary-foreground"),
        },
        secondary: {
          DEFAULT: cssVarColor("--secondary"),
          foreground: cssVarColor("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: cssVarColor("--destructive"),
          foreground: cssVarColor("--destructive-foreground"),
        },
        muted: {
          DEFAULT: cssVarColor("--muted"),
          foreground: cssVarColor("--muted-foreground"),
        },
        accent: {
          DEFAULT: cssVarColor("--accent"),
          foreground: cssVarColor("--accent-foreground"),
        },
        popover: {
          DEFAULT: cssVarColor("--popover"),
          foreground: cssVarColor("--popover-foreground"),
        },
        card: {
          DEFAULT: cssVarColor("--card"),
          foreground: cssVarColor("--card-foreground"),
        },
        sidebar: {
          DEFAULT: cssVarColor("--sidebar"),
          foreground: cssVarColor("--sidebar-foreground"),
          primary: cssVarColor("--sidebar-primary"),
          "primary-foreground": cssVarColor("--sidebar-primary-foreground"),
          accent: cssVarColor("--sidebar-accent"),
          "accent-foreground": cssVarColor("--sidebar-accent-foreground"),
          border: cssVarColor("--sidebar-border"),
          ring: cssVarColor("--sidebar-ring"),
        },
        chart: {
          1: cssVarColor("--chart-1"),
          2: cssVarColor("--chart-2"),
          3: cssVarColor("--chart-3"),
          4: cssVarColor("--chart-4"),
          5: cssVarColor("--chart-5"),
        },
        codex: {
          ink: "var(--codex-ink)",
          muted: "var(--codex-muted)",
          faint: "var(--codex-faint)",
          surface: "var(--codex-surface)",
          accent: "var(--codex-accent)",
          "accent-soft": "var(--codex-accent-soft)",
          ice: "var(--codex-ice)",
          dark: "var(--codex-dark)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        heading: ["var(--font-heading)", ...defaultTheme.fontFamily.sans],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
