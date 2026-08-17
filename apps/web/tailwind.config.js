/** @type {import('tailwindcss').Config} */

// Map a semantic token (a CSS variable holding space-separated RGB channels)
// to a Tailwind colour that still supports opacity modifiers (`bg-primary/50`).
const token = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `dark:` follows the app's OWN switch, not the operating system's.
  //
  // Left unset, Tailwind defaults to `media`, i.e. `prefers-color-scheme` — so
  // before v0.26 every `dark:` variant fired on a reader's OS setting while the
  // palette itself came from `data-theme`. With only a light theme that was
  // invisible; the moment a dark one shipped it meant a reader on a light OS
  // who chose dark got dark-theme surfaces with light-theme `dark:` overrides
  // painted on top. One authority for one question.
  darkMode: ["selector", '[data-theme="dark"]'],
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
        // Not an error: a state a contributor should notice and may well
        // choose to leave alone — an unbound tag, a coarse translation, a
        // parked assertion. It had been amber-700 with a `dark:` override at
        // every call site, which is exactly the duplication tokens exist to
        // end.
        warning: token("--color-warning"),
      },
      // Make the bare `border` and `ring` utilities themed by default, so
      // components rarely need an explicit colour.
      borderColor: { DEFAULT: token("--color-border") },
      ringColor: { DEFAULT: token("--color-ring") },
    },
  },
  plugins: [],
};
