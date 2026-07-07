/** @type {import('tailwindcss').Config} */

// Map a semantic token (a CSS variable holding space-separated RGB channels)
// to a Tailwind colour that still supports opacity modifiers (`bg-primary/50`).
const token = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("--color-canvas"),
        surface: {
          DEFAULT: token("--color-surface"),
          muted: token("--color-surface-muted"),
        },
        content: {
          DEFAULT: token("--color-content"),
          muted: token("--color-content-muted"),
          subtle: token("--color-content-subtle"),
        },
        primary: {
          DEFAULT: token("--color-primary"),
          hover: token("--color-primary-hover"),
          fg: token("--color-primary-fg"),
        },
        danger: token("--color-danger"),
      },
      // Make the bare `border` and `ring` utilities themed by default, so
      // components rarely need an explicit colour.
      borderColor: { DEFAULT: token("--color-border") },
      ringColor: { DEFAULT: token("--color-ring") },
    },
  },
  plugins: [],
};
