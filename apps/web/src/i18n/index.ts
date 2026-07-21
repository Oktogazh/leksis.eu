import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

// Single source of truth for which languages the UI offers. Today it's English
// only; adding a locale is: drop a `<code>.json` next to en.json, import it into
// `resources`, and add an entry here. Every string already flows through `t()`,
// so no component changes are needed.
export const SUPPORTED_LANGUAGES = [{ code: "en", labelKey: "languages.en" }] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: LanguageCode = "en";
const LANGUAGE_STORAGE_KEY = "leksis.lang";

export const resources = { en: { translation: en } } as const;

function isLanguageCode(value: string | null): value is LanguageCode {
  return value != null && SUPPORTED_LANGUAGES.some((l) => l.code === value);
}

function readInitialLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
  } catch {
    // localStorage may be unavailable; fall back to the default.
  }
  return DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: readInitialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

document.documentElement.lang = i18n.language;

/** Switch UI language, persist the choice, and keep <html lang> in sync. */
export function setLanguage(code: LanguageCode): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // ignore persistence failures
  }
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

/** The supported code for a BCP 47 tag, or the default when unsupported. */
export function resolveLanguageCode(tag: string): LanguageCode {
  const primary = tag.toLowerCase().split("-")[0] ?? "";
  return isLanguageCode(primary) ? primary : DEFAULT_LANGUAGE;
}

/**
 * Apply the interface language from the user's profile (the source of truth
 * for connected users), without writing localStorage — the profile record, not
 * the browser store, owns the choice once a user is connected. Unsupported
 * tags fall back to the default.
 */
export function applyInterfaceLanguage(tag: string): void {
  const code = resolveLanguageCode(tag);
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

export default i18n;
