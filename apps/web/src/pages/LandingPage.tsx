import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../auth/SessionProvider";

export function LandingPage() {
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
      // On success the browser redirects to the PDS and never returns here.
      await signIn(handle);
    } catch (err) {
      console.error(err);
      setError(t("auth.errors.signInFailed"));
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-content sm:text-4xl">
          {t("landing.hero.title")}
        </h1>
        <p className="text-base text-content-muted sm:text-lg">{t("landing.hero.subtitle")}</p>
      </section>

      <ul className="mt-8 flex flex-col gap-4 sm:mt-10">
        {(["own", "universal", "depth"] as const).map((key) => (
          <li key={key} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span className="text-sm text-content-muted sm:text-base">
              {t(`landing.points.${key}`)}
            </span>
          </li>
        ))}
      </ul>

      <section className="mt-10 rounded-2xl border bg-surface p-5 shadow-sm sm:mt-12 sm:p-6">
        <h2 className="text-lg font-semibold text-content">{t("landing.cta.title")}</h2>
        <p className="mt-1 text-sm text-content-muted">{t("landing.cta.subtitle")}</p>

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
            autoFocus
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

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </section>
    </main>
  );
}
