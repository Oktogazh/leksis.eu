import { useTranslation } from "react-i18next";
import { useSession } from "../auth/SessionProvider";
import { Brand } from "./Brand";

export function Header() {
  const { t } = useTranslation();
  const { status, handle, signOut } = useSession();

  return (
    <header className="border-b bg-surface">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Brand className="text-base sm:text-lg" />
        {status === "connected" && (
          <div className="flex items-center gap-2 sm:gap-3">
            {handle && (
              <span className="hidden text-sm text-content-muted sm:inline">
                {t("auth.connectedAs", { handle })}
              </span>
            )}
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
    </header>
  );
}
