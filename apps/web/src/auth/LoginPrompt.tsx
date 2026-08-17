import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { SignInForm } from "../components/SignInForm";

/*
 * "You need an account for that" — asked, not enforced by absence (ADR-0017).
 *
 * Now that a reader can use the dictionary without logging in, every
 * contribution affordance had two possible treatments: hide it, or show it and
 * explain. Hiding is the smaller change and the worse product — the affordances
 * ARE the explanation of what Leksis is, and a reader who never sees that a
 * word can be corrected, a language named or a book described has been shown a
 * read-only dictionary rather than a project they could join.
 *
 * So contribution affordances stay visible while logged out and raise this
 * prompt, carrying the reason they were asked for. Account-scoped controls —
 * your profile, log out, delete your records — do the opposite and stay hidden:
 * they are meaningless without an account rather than an invitation to get one.
 */

interface LoginPromptValue {
  /**
   * Ask the reader to connect, saying why. `reason` is already-translated
   * prose, so the caller keeps its own copy rather than this module owning a
   * catalogue of every action that might need an account.
   */
  requestLogin: (reason?: string) => void;
}

const LoginPromptContext = createContext<LoginPromptValue | null>(null);

export function LoginPromptProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<string | null>(null);
  const open = reason !== null;
  /** What had focus when the prompt opened, so it can be given back. */
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const requestLogin = useCallback((why?: string) => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    // "" is a legitimate reason (the generic prompt); null is the closed state,
    // so the empty string must not collapse into it.
    setReason(why ?? "");
  }, []);

  const close = useCallback(() => {
    setReason(null);
    // Back to the button that raised the prompt — a keyboard reader dismissing
    // a dialog and landing at the top of the document has lost their place.
    returnFocusTo.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const value = useMemo<LoginPromptValue>(() => ({ requestLogin }), [requestLogin]);

  return (
    <LoginPromptContext.Provider value={value}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-prompt-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="w-full rounded-t-xl border bg-surface p-5 shadow-lg sm:max-w-md sm:rounded-xl sm:p-6">
            <h2 id="login-prompt-title" className="text-lg font-semibold text-content">
              {t("auth.promptTitle")}
            </h2>
            <p className="mt-1 text-sm text-content-muted">
              {reason !== "" ? reason : t("auth.promptDefault")}
            </p>

            <SignInForm autoFocus />

            <p className="mt-3 text-xs text-content-subtle">{t("auth.promptReassurance")}</p>

            <button
              type="button"
              onClick={close}
              className="mt-4 text-sm text-content-subtle underline-offset-2 hover:text-content hover:underline"
            >
              {t("auth.promptDismiss")}
            </button>
          </div>
        </div>
      )}
    </LoginPromptContext.Provider>
  );
}

export function useLoginPrompt(): LoginPromptValue {
  const ctx = useContext(LoginPromptContext);
  if (!ctx) throw new Error("useLoginPrompt must be used within <LoginPromptProvider>");
  return ctx;
}
