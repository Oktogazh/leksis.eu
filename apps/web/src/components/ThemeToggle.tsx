import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Light/dark switch, in the header where it is reachable without an account —
 * appearance is a property of this browser, not of a contributor (ADR-0017).
 *
 * A two-state toggle rather than a picker, while there are exactly two themes.
 * The icon shows the theme you would GET, and the label says so out loud, which
 * is the one thing these controls routinely get wrong: an icon alone leaves the
 * reader guessing whether the sun means "you are in light" or "go to light".
 * When a third theme lands (high-contrast, colour-blind-safe), this becomes a
 * menu over THEMES and the tokens do not move.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = t(next === "dark" ? "themes.toDark" : "themes.toLight");

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-content-muted hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2"
    >
      {next === "dark" ? (
        // Moon — pressing this gets you the dark theme.
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      ) : (
        // Sun — pressing this gets you the light theme.
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
