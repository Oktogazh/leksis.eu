import { useEffect, useState } from "react";

// One user's picture, wherever their PDS serves it from — with an initial as
// the fallback, since a user on a PDS with no `app.bsky.actor.profile` record
// has no picture at all and that is an ordinary state, not a broken image.

type AvatarSize = "sm" | "lg";

interface AvatarProps {
  /** Image URL from the actor's PDS, or null when they have none. */
  src?: string | null;
  /** Handle or DID — its first letter is the fallback. */
  name: string;
  size?: AvatarSize;
  className?: string;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  lg: "h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl",
};

/** The first letter to stand in for a picture; "?" when there is none. */
function initial(name: string): string {
  // A DID carries no name, so skip its method prefix rather than showing "d".
  const source = name.startsWith("did:") ? name.slice(name.lastIndexOf(":") + 1) : name;
  const letter = /\p{L}|\p{N}/u.exec(source)?.[0];
  return letter ? letter.toUpperCase() : "?";
}

export function Avatar({ src, name, size = "sm", className = "" }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  // A new src is a new chance: without this, one broken image would keep the
  // fallback showing after the user's picture changed or another actor's
  // avatar replaced it in the same slot.
  useEffect(() => setFailed(false), [src]);

  const shared = `shrink-0 overflow-hidden rounded-full border bg-surface-muted object-cover ${SIZE_CLASS[size]} ${className}`;

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={`${shared} flex items-center justify-center font-semibold text-content-muted`}
      >
        {initial(name)}
      </span>
    );
  }

  return (
    // Not lazy: every avatar in the app sits at the top of its page or in the
    // navbar, so deferring it only delays the one image the reader is looking
    // at. `alt=""` because the name is always written beside it — announcing it
    // twice is noise to a screen reader.
    <img src={src} alt="" onError={() => setFailed(true)} className={shared} />
  );
}
