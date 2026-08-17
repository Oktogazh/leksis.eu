// Theme registry.
//
// A theme is just an id that maps to a `[data-theme="<id>"]` token block in
// src/index.css, plus a human label (an i18n key, ready for a future theme
// switcher). Adding a theme is two steps and touches no components:
//   1. add the token block in src/index.css
//   2. add an entry here
// Every component already paints with the semantic tokens, so it inherits the
// new palette automatically.

export interface ThemeDef {
  /** Value written to `<html data-theme="…">`; matches a block in index.css. */
  id: string;
  /** i18n key for the display label (e.g. for a future theme switcher). */
  labelKey: string;
}

export const THEMES = [
  { id: "light", labelKey: "themes.light" },
  { id: "dark", labelKey: "themes.dark" },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * The theme used when this browser has never chosen one *and* states no
 * preference of its own. `prefers-color-scheme` is consulted first (see
 * ThemeProvider) — a reader whose whole system is dark should not be handed a
 * white page before they can object to it.
 */
export const DEFAULT_THEME: ThemeId = "light";
export const THEME_STORAGE_KEY = "leksis.theme";
