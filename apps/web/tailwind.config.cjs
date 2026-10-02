/**
 * Identidade visual Unitel — mesma paleta do ARA (CLAUDE.md §18).
 * brand = laranja #FB8100 · navy = azul-marinho #08003C · ink = cinzentos neutros.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#fff6eb", 100: "#ffe8cc", 200: "#ffcf94", 300: "#ffb257", 400: "#fd9a2b",
          500: "#fb8100", 600: "#dc6f00", 700: "#b35700", 800: "#8f4508", 900: "#75390b",
        },
        navy: {
          50: "#f0effa", 100: "#dcdaf2", 200: "#b6b1e3", 300: "#8a82cf", 400: "#5f55b5",
          500: "#3d3296", 600: "#2a2078", 700: "#1c145e", 800: "#120b4b", 900: "#0c0642", 950: "#08003c",
        },
        ink: {
          50: "#f7f7f8", 100: "#eeeef0", 200: "#dcdce0", 300: "#b9b9c0", 400: "#8c8c96",
          500: "#676771", 600: "#4d4d56", 700: "#3a3a41", 800: "#26262b", 900: "#18181b", 950: "#0f0f11",
        },
      },
    },
  },
  plugins: [],
};
