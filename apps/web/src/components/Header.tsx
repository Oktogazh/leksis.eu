import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView } from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { fetchLanguages } from "../lib/api";
import { Brand } from "./Brand";
import { ProfileDialog } from "./ProfileDialog";

export function Header() {
  const { t, i18n } = useTranslation();
  const { status, handle, profile, signOut } = useSession();
  const [editing, setEditing] = useState(false);
  const [languages, setLanguages] = useState<LanguageView[]>([]);

  // The profile dialog needs the language list; load it lazily the first time
  // the dialog is opened (not on every page render).
  useEffect(() => {
    if (!editing || languages.length > 0) return;
    fetchLanguages(i18n.language)
      .then(setLanguages)
      .catch((err) => console.error("could not load languages:", err));
  }, [editing, languages.length, i18n.language]);

  // Only offer preferences once the profile has loaded — before that there's
  // nothing to edit, and during onboarding the same choices are on-screen.
  const canEditProfile = status === "connected" && profile != null;

  return (
    <header className="border-b bg-surface">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Brand className="text-base sm:text-lg" />
        {status === "connected" && (
          <div className="flex items-center gap-2 sm:gap-3">
            {handle &&
              (canEditProfile ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title={t("profile.open")}
                  className="hidden rounded-md px-2 py-1 text-sm text-content-muted hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 sm:inline"
                >
                  {t("auth.connectedAs", { handle })}
                </button>
              ) : (
                <span className="hidden text-sm text-content-muted sm:inline">
                  {t("auth.connectedAs", { handle })}
                </span>
              ))}
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border px-3 py-1.5 text-sm font-medium text-content hover:bg-surface-muted focus:outline-none focus:ring-2"
            >
              {t("auth.disconnect")}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <ProfileDialog
          languages={languages}
          onClose={() => setEditing(false)}
          onLanguageCreated={(created) =>
            setLanguages((prev) =>
              [...prev.filter((l) => l.tag !== created.tag), created].sort((a, b) =>
                a.tag.localeCompare(b.tag),
              ),
            )
          }
        />
      )}
    </header>
  );
}
