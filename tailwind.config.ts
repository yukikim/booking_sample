import type { Config } from "tailwindcss";

// Extend the default Tailwind theme; loaded by Tailwind v4 via @config.
export default {
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        card: { DEFAULT: "var(--card)", foreground: "var(--foreground)" },
        border: "var(--border)",
        input: "var(--border)",
        ring: "var(--ring)",
        destructive: "var(--destructive)",
      },
      borderRadius: { lg: "var(--radius)", xl: "calc(var(--radius) + 4px)", "2xl": "calc(var(--radius) + 12px)" },
      boxShadow: { soft: "0 12px 40px -20px rgb(24 65 100 / 20%)" },
      fontFamily: { sans: ["var(--font-geist-sans)", "Arial", '"Hiragino Kaku Gothic ProN"', '"Noto Sans JP"', "sans-serif"] },
    },
  },
} satisfies Config;
