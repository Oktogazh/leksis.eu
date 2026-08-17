import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../auth/SessionProvider";

interface SignInFormProps {
  /** Focus the handle box on mount — true in a dialog, false on a scrolled page. */
  autoFocus?: boolean;
}

/**
 * The one place a handle is turned into a session.
 *
 * Extracted when search opened to logged-out readers (ADR-0017): login stopped
 * being a page and became something asked for in two places — the pitch at the
 * bottom of an empty search, and the prompt raised by a contribution a reader
 * is not signed in for. Two copies of an auth form is one copy too many.
 *
 * On success nothing after `signIn` runs: the browser has left for the PDS.
 */
export function SignInForm({ autoFocus = false }: SignInFormProps) {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [handle, setHandle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!handle.trim()) {
      setError(t("auth.errors.handleRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await signIn(handle);
    } catch (err) {
      console.error(err);
      setError(t("auth.errors.signInFailed"));
      setSubmitting(false);
    }
  }

  return (
    <>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit} noValidate>
        <label htmlFor="handle" className="sr-only">
          {t("auth.handleLabel")}
        </label>
        <input
          id="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder={t("auth.handlePlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          autoFocus={autoFocus}
          aria-describedby={error !== null ? "handle-error" : undefined}
          className="w-full flex-1 rounded-lg border bg-canvas px-3 py-2.5 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg hover:bg-primary-hover focus:outline-none focus:ring-2 disabled:opacity-60"
        >
          {submitting ? t("auth.connecting") : t("auth.logIn")}
        </button>
      </form>

      {error !== null && (
        <p id="handle-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
