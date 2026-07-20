import { useEffect } from "react";
import { useSession } from "./auth/SessionProvider";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { LoadingScreen } from "./components/LoadingScreen";
import { LandingPage } from "./pages/LandingPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  const { status } = useSession();

  // A logged-out visitor only ever sees the landing page, so a resource URL
  // (/entry/<key>, /language/<tag>, /?q=…) has no page behind it — send them
  // to the homepage and keep the address bar honest. replaceState (not push)
  // so Back doesn't bounce them onto the URL we just left.
  useEffect(() => {
    if (status !== "disconnected") return;
    if (window.location.pathname !== "/" || window.location.search !== "") {
      window.history.replaceState(null, "", "/");
    }
  }, [status]);

  // Hold the chrome back until we know whether a session was restored, so the
  // landing page never flashes for an already-logged-in user.
  if (status === "loading") return <LoadingScreen />;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      {status === "connected" ? <HomePage /> : <LandingPage />}
      <Footer />
    </div>
  );
}
