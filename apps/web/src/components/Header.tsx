import { useTranslation } from "react-i18next";
import { useSession } from "../auth/SessionProvider";
import { useLoginPrompt } from "../auth/LoginPrompt";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The header is the same for a reader and a contributor except for its last
 * control: the account menu once connected, the invitation to connect before
 * (ADR-0017). The theme switch sits on both sides of that line, because how the
 * page looks is a property of the browser rather than of an account.
 */
export function Header() {
  const { t } = useTranslation();
  const { status } = useSession();
  const { requestLogin } = useLoginPrompt();

  return (
    <header className="border-b bg-surface">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Brand className="text-base sm:text-lg" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {status === "connected" ? (
            <AccountMenu />
          ) : (
            // Rendered only once the session is known: offering "Log in" while
            // a stored session is still restoring makes the header flicker
            // between the two states on every load.
            status === "disconnected" && (
              <button
                type="button"
                onClick={() => requestLogin()}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium text-content hover:border-primary hover:text-primary focus:outline-none focus:ring-2"
              >
                {t("auth.logIn")}
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
