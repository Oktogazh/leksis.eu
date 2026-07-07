import { useSession } from "./auth/SessionProvider";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { LoadingScreen } from "./components/LoadingScreen";
import { LandingPage } from "./pages/LandingPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  const { status } = useSession();

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
