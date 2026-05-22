import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Georgia", "Cambria", '"Times New Roman"', "serif"],
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      colors: {
        parchment: {
          50: "#FDFCF8",
          100: "#FAF8F2",
          200: "#F2EDE3",
          300: "#E8E0D0",
        },
        ink: {
          900: "#1A1510",
          800: "#2D2419",
          700: "#3D3225",
          500: "#6B5744",
          300: "#A0897A",
          100: "#D4C4B8",
        },
        amber: {
          600: "#B45309",
          500: "#D97706",
          100: "#FEF3C7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
