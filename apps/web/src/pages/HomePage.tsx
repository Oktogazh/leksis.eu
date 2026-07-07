import { type FormEvent } from "react";
import { useTranslation } from "react-i18next";

// Connected landing surface. The search experience itself is a later milestone;
// this is the shell where it will live — a language scope + a term box.
export function HomePage() {
  const { t } = useTranslation();

  function onSubmit(event: FormEvent) {
    event.preventDefault(); // wired up in a later milestone
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
        {t("search.title")}
      </h1>

      <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
        <label htmlFor="search-language" className="sr-only">
          {t("search.languageLabel")}
        </label>
        <select
          id="search-language"
          defaultValue=""
          className="rounded-lg border bg-surface px-3 py-2.5 text-sm text-content outline-none focus:ring-2 sm:w-44"
        >
          <option value="">{t("search.languageAny")}</option>
        </select>

        <label htmlFor="search-term" className="sr-only">
          {t("search.placeholder")}
        </label>
        <input
          id="search-term"
          type="search"
          placeholder={t("search.placeholder")}
          autoCapitalize="none"
          className="w-full flex-1 rounded-lg border bg-surface px-3 py-2.5 text-sm text-content outline-none placeholder:text-content-subtle focus:ring-2"
        />

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg hover:bg-primary-hover focus:outline-none focus:ring-2"
        >
          {t("search.submit")}
        </button>
      </form>

      <p className="mt-3 text-sm text-content-subtle">{t("search.comingSoon")}</p>
    </main>
  );
}
