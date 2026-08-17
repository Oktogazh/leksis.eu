import { useTranslation } from "react-i18next";
import { useSession } from "./auth/SessionProvider";
import { LoginPromptProvider } from "./auth/LoginPrompt";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { LoadingScreen } from "./components/LoadingScreen";
import { HomePage } from "./pages/HomePage";

/**
 * One surface for everyone (ADR-0017).
 *
 * Until v0.26 this branched: a connected user got the dictionary, everyone else
 * got a landing page, and any resource URL a logged-out visitor arrived on was
 * rewritten to "/" because there was no page behind it. That made every link
 * anyone shared — an entry, a language, a cited work — land a stranger on a
 * login form having silently thrown away what they clicked. A dictionary whose
 * links only work for people who already have accounts is not a dictionary that
 * can be cited, and citation is the whole point of publishing one.
 *
 * So `HomePage` now renders in both states and decides per affordance what a
 * reader without an account can do. What is *not* open is unchanged and is
 * enforced where it always was: every write goes browser → the author's own
 * PDS, so having no session is not a permission check that could be bypassed —
 * there is simply no repository to write to.
 */
export default function App() {
  const { t } = useTranslation();
  const { status } = useSession();

  // Hold the chrome back until we know whether a session was restored, so a
  // connected user never sees the logged-out header flash past.
  if (status === "loading") return <LoadingScreen />;

  return (
    <LoginPromptProvider>
      <div className="flex min-h-screen flex-col bg-canvas">
        {/* Visible only once focused. Every page here begins with the same
            search controls, so a keyboard or screen-reader user otherwise tabs
            through the language picker, the term box, the target picker and the
            kind tabs before reaching the entry they opened — on every entry. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-fg"
        >
          {t("common.skipToContent")}
        </a>
        <Header />
        <HomePage />
        <Footer />
      </div>
    </LoginPromptProvider>
  );
}
