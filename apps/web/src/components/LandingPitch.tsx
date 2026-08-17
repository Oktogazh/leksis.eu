import { useTranslation } from "react-i18next";
import { SignInForm } from "./SignInForm";

/**
 * What Leksis is, shown *below* the search bar to a reader who has not logged
 * in and has not searched yet.
 *
 * This is the whole shape of ADR-0017 in one component. It used to be
 * `LandingPage` — a wall in front of the dictionary, with a login form where
 * the search box should have been, which meant the answer to "what is this
 * site?" was a password prompt. Now the dictionary is the landing page and the
 * pitch is what sits under it: the fastest way to explain a dictionary is to
 * let someone look a word up in it.
 *
 * It disappears the moment a search is submitted — an explanation of the
 * product should not outrank the product's answer — and never renders for a
 * connected user, who has already been convinced.
 */
export function LandingPitch() {
  const { t } = useTranslation();

  return (
    <section className="mt-10 border-t pt-8 sm:mt-12">
      <h2 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
        {t("landing.hero.title")}
      </h2>
      <p className="mt-2 text-base text-content-muted">{t("landing.hero.subtitle")}</p>

      <ul className="mt-8 flex flex-col gap-4">
        {(["own", "universal", "depth"] as const).map((key) => (
          <li key={key} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span className="text-sm text-content-muted sm:text-base">
              {t(`landing.points.${key}`)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-2xl border bg-surface p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-content">{t("landing.cta.title")}</h3>
        <p className="mt-1 text-sm text-content-muted">{t("landing.cta.subtitle")}</p>
        <SignInForm />
      </div>
    </section>
  );
}
