import { useSession } from "../auth/SessionProvider";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";

export function Header() {
  const { status } = useSession();

  return (
    <header className="border-b bg-surface">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Brand className="text-base sm:text-lg" />
        {status === "connected" && <AccountMenu />}
      </div>
    </header>
  );
}
