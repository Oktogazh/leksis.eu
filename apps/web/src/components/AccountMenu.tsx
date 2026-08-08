import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../auth/SessionProvider";
import { fetchActorProfile, type ActorProfile } from "../lib/actor-profile";
import { navigateTo, userPath } from "../lib/routes";
import { Avatar } from "./Avatar";

/**
 * The navbar's account control: the reader's own picture and name, opening a
 * menu with the two things one does with an account here — go to one's page,
 * or leave.
 *
 * It replaced a bare handle and a Log out button. The handle carried the DID
 * on wide screens and *nothing at all* below `sm`, so on a phone the only sign
 * of who was logged in was a button offering to log them out; a picture reads
 * at any width. Preferences moved to the profile page with it, next to the
 * setting they change.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const { did, handle, signOut } = useSession();
  const [actor, setActor] = useState<ActorProfile | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (did === null) return;
    let cancelled = false;
    // Decoration: a reader whose PDS is slow, or who has no Bluesky profile
    // record, gets their initial instead — never a missing navbar.
    fetchActorProfile(did)
      .then((found) => {
        if (!cancelled) setActor(found);
      })
      .catch((err: unknown) => console.error("could not load your own profile:", err));
    return () => {
      cancelled = true;
    };
  }, [did]);

  // Dismissal, the two ways a menu is dismissed. Escape returns focus to the
  // trigger, so a keyboard user is not dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (did === null) return null;

  const name = actor?.displayName ?? handle ?? did;
  const itemClass =
    "block w-full px-4 py-2.5 text-left text-sm hover:bg-surface-muted focus:bg-surface-muted focus:outline-none";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("accountMenu.open")}
        className="flex max-w-[12rem] items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 hover:bg-surface-muted focus:outline-none focus:ring-2"
      >
        <Avatar src={actor?.avatarUrl} name={handle ?? did} />
        {/* The name is the first thing to go when space is short — the picture
            identifies the account on its own, which the handle never did. */}
        <span className="hidden truncate text-sm font-medium text-content sm:inline">{name}</span>
        <span aria-hidden="true" className="text-xs text-content-subtle">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("accountMenu.label")}
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border bg-surface shadow-lg"
        >
          {/* Who you are, restated inside the menu: below `sm` the trigger
              shows only a picture, so this is the one place the handle of the
              account about to be logged out is actually written. */}
          <div className="border-b px-4 py-3">
            <p className="truncate text-sm font-medium text-content">{name}</p>
            {handle !== null && (
              <p className="truncate text-xs text-content-muted">@{handle}</p>
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // In-app navigation, not a link: a full load would re-run the
              // OAuth restore for a page the reader is already logged in for.
              navigateTo(userPath(did));
            }}
            className={`${itemClass} text-content`}
          >
            {t("accountMenu.profile")}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={`${itemClass} text-danger`}
          >
            {t("auth.disconnect")}
          </button>
        </div>
      )}
    </div>
  );
}
