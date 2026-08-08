import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageView, LeksisProfileRecord } from "@leksis/types";
import { useSession } from "../auth/SessionProvider";
import { ActivityGrid } from "../components/ActivityGrid";
import { Avatar } from "../components/Avatar";
import { endonym } from "../components/LanguageSelector";
import { ProfileDialog } from "../components/ProfileDialog";
import { RepoFeed } from "../components/RepoFeed";
import { fetchActorProfile, type ActorProfile } from "../lib/actor-profile";
import { fetchPublicProfile } from "../lib/profile";
import { DeleteRecordsDialog } from "../components/DeleteRecordsDialog";
import {
  activityFromRecords,
  deletableRecords,
  listLeksisRecords,
  type RepoRecord,
  type RepoRecords,
} from "../lib/pds-repo";

interface UserPageProps {
  /** The AT identifier from /user/<id>: a DID, or a handle to resolve. */
  id: string;
  /** All known languages, for naming the languages of interest. */
  languages: LanguageView[];
  onOpenEntry: (key: string) => void;
  onOpenLanguage: (tag: string) => void;
  /** Bubbled up so a language registered from the preferences dialog is known app-wide. */
  onLanguageCreated: (created: LanguageView) => void;
}

type LoadState = "loading" | "ready" | "not-found" | "failed";

/**
 * A contributor's page (/user/<did-or-handle>), rendered under the persistent
 * search bar like the other resource pages.
 *
 * **Nothing here comes from the AppView.** The identity and picture come from
 * the actor's `app.bsky.actor.profile` record and their PDS's blob store, the
 * languages of interest from their `eu.leksis.profile` — all read straight from
 * their repo, which is where they live (ADR-0005: the AppView does not index
 * profiles). So this page works for any user of any PDS, including one who has
 * never been seen by Leksis's firehose.
 */
export function UserPage({
  id,
  languages,
  onOpenEntry,
  onOpenLanguage,
  onLanguageCreated,
}: UserPageProps) {
  const { t } = useTranslation();
  const { agent, did: sessionDid, handle: sessionHandle, profile: ownProfile } = useSession();
  const [actor, setActor] = useState<ActorProfile | null>(null);
  const [profile, setProfile] = useState<LeksisProfileRecord | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  /** Everything this contributor has published, straight from their repo. */
  const [repo, setRepo] = useState<RepoRecords | null>(null);
  const [repoState, setRepoState] = useState<"loading" | "ready" | "failed">("loading");
  /** The preferences dialog — only ever reachable on one's own page. */
  const [editing, setEditing] = useState(false);
  /** The records a confirmation dialog is currently asking about, if any. */
  const [deleting, setDeleting] = useState<{ records: RepoRecord[]; all: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setActor(null);
    setProfile(null);
    setRepo(null);
    setRepoState("loading");
    setEditing(false);

    (async () => {
      // A handle is resolved by the viewer's own PDS, which does it for any
      // handle on the network — so no Bluesky-specific service is involved,
      // and the app's own links (which carry DIDs) skip the round trip.
      let did = id;
      if (!did.startsWith("did:")) {
        if (!agent) return setState("failed");
        try {
          // Handles are canonically lowercase, and a pasted "@alice.example"
          // is one a reader would expect to work.
          const res = await agent.com.atproto.identity.resolveHandle({
            handle: id.trim().replace(/^@/, "").toLowerCase(),
          });
          did = res.data.did;
        } catch {
          // Nobody answers to that handle: the one unambiguous "no such user"
          // signal this page gets.
          if (!cancelled) setState("not-found");
          return;
        }
      }

      // This doubles as the existence check: fetchActorProfile rejects only
      // when the DID resolves to no PDS at all. A user who has simply never
      // touched Bluesky resolves normally, with null fields — which is why an
      // absent picture must never be treated as an absent account.
      let found: ActorProfile;
      try {
        found = await fetchActorProfile(did);
      } catch (err) {
        // A DID nobody registered and a directory that is down fail
        // identically from here, so the message claims only what is true of
        // both.
        console.error("could not load the actor behind", did, err);
        if (!cancelled) setState("failed");
        return;
      }
      if (cancelled) return;
      setActor(found);
      setState("ready");

      // What they have published. Independent of the preferences read below,
      // and of the page rendering at all: both are side data on a page that is
      // already on screen.
      listLeksisRecords(did)
        .then((found) => {
          if (cancelled) return;
          setRepo(found);
          setRepoState("ready");
        })
        .catch((err: unknown) => {
          console.error("could not list the repo of", did, err);
          if (!cancelled) setRepoState("failed");
        });

      // Best-effort: a user with no Leksis profile still has a page. One's own
      // preferences are not fetched at all — the session already holds them,
      // and reading them from there is what makes a save show up immediately.
      if (did === sessionDid) return;
      fetchPublicProfile(did)
        .then((value) => {
          if (!cancelled) setProfile(value);
        })
        .catch((err: unknown) => console.error("could not load leksis profile:", err));
    })();

    return () => {
      cancelled = true;
    };
  }, [id, agent, sessionDid]);

  const isOwn = actor !== null && actor.did === sessionDid;
  // One's own preferences come from the session, so an edit made in the dialog
  // below is on screen before the PDS has even acknowledged it.
  const shown = isOwn ? (ownProfile ?? null) : profile;
  // describeRepo is best-effort; on one's own page the session already holds a
  // handle, so a PDS hiccup does not blank out one's own name.
  const handle = actor?.handle ?? (isOwn ? sessionHandle : null);
  const name = actor?.displayName ?? handle ?? actor?.did ?? id;
  // Tags the profile lists that Leksis knows about keep their name; one that
  // was removed, or that no record has registered, still shows as its tag
  // rather than vanishing from the user's own declaration.
  const interests = (shown?.languages ?? []).map((tag) => ({
    tag,
    name: endonym(languages.find((l) => l.tag === tag) ?? { tag, endonym: tag }),
  }));
  const activity = useMemo(
    () => (repo === null ? [] : activityFromRecords(repo.records)),
    [repo],
  );

  return (
    <div className="mt-6 flex flex-col">
      {state === "loading" && <p className="text-sm text-content-muted">{t("userPage.loading")}</p>}
      {state === "not-found" && (
        <p className="text-sm text-content-muted">{t("userPage.notFound")}</p>
      )}
      {state === "failed" && <p className="text-sm text-red-600">{t("userPage.loadFailed")}</p>}

      {state === "ready" && actor !== null && (
        <article>
          <header className="flex items-start gap-4">
            <Avatar src={actor.avatarUrl} name={handle ?? actor.did} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-semibold tracking-tight text-content sm:text-3xl">
                {name}
              </h1>
              {/* Only when it is not already the heading: with no display name
                  the handle *is* the name, and printing it twice reads as a
                  bug rather than as two facts. */}
              {handle !== null && handle !== name && (
                <p className="break-all text-sm text-content-muted">@{handle}</p>
              )}
              {/* The DID is the identity the records actually carry, so it is
                  shown plainly — it is what makes two same-named contributors
                  distinguishable. */}
              <p className="mt-1 break-all font-mono text-xs text-content-subtle">{actor.did}</p>
            </div>
          </header>

          {actor.description !== null && (
            <p className="mt-4 whitespace-pre-line text-sm text-content">{actor.description}</p>
          )}

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
                {t("userPage.interestsTitle")}
              </h2>
              {/* These are the reader's own preferences when the page is
                  theirs, so this is where they are edited — the navbar used to
                  hold the trigger, and a profile that shows the setting is a
                  better home for changing it than a menu two pages away. */}
              {isOwn && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs text-primary hover:text-primary-hover"
                >
                  {t("userPage.editPreferences")}
                </button>
              )}
            </div>
            {interests.length === 0 ? (
              <p className="mt-2 text-sm text-content-muted">
                {shown === null ? t("userPage.noProfile") : t("userPage.interestsEmpty")}
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {interests.map((language) => (
                  <li key={language.tag}>
                    <button
                      type="button"
                      onClick={() => onOpenLanguage(language.tag)}
                      title={t("userPage.openLanguage", { language: language.name })}
                      className="flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1.5 text-sm text-content hover:border-primary hover:text-primary"
                    >
                      {language.name}
                      {/* The code, unless it is already the whole label —
                          which is what an unindexed language falls back to,
                          and "br br" reads as a glitch rather than as a
                          language nobody has named yet. */}
                      {language.name !== language.tag && (
                        <span className="font-mono text-xs text-content-subtle">
                          {language.tag}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
              {t("userPage.activityTitle")}
            </h2>

            {repoState === "loading" && (
              <p className="mt-2 text-sm text-content-muted">{t("userPage.activityLoading")}</p>
            )}
            {/* Not an error banner: their records exist whatever we managed to
                read, and the rest of the page is still true. */}
            {repoState === "failed" && (
              <p className="mt-2 text-sm text-content-muted">{t("userPage.activityFailed")}</p>
            )}

            {repoState === "ready" &&
              repo !== null &&
              (repo.records.length === 0 ? (
                <p className="mt-2 text-sm text-content-muted">
                  {isOwn ? t("userPage.activityEmptyOwn") : t("userPage.activityEmpty")}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-content-muted">
                    {t("userPage.recordCount", { count: repo.records.length })}
                  </p>
                  <ActivityGrid activity={activity} />
                  {/* Said out loud rather than letting a capped year pass for a
                      whole one — a bot repo hits this, a person never will. */}
                  {repo.truncated && (
                    <p className="mt-2 text-xs text-content-subtle">
                      {t("userPage.activityTruncated")}
                    </p>
                  )}
                  {/* Withdrawal is offered only on one's own page, and only
                      for the records that are contributions — the preferences
                      record is settings, and emptying it as a side effect of
                      withdrawing dictionary work would drop the reader back
                      into onboarding. */}
                  {isOwn && deletableRecords(repo.records).length > 0 && (
                    <p className="mt-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setDeleting({ records: deletableRecords(repo.records), all: true })
                        }
                        className="text-xs text-danger hover:underline"
                      >
                        {t("deleteRecords.deleteAll")}
                      </button>
                    </p>
                  )}
                  <RepoFeed
                    records={repo.records}
                    languages={languages}
                    onOpenEntry={onOpenEntry}
                    onOpenLanguage={onOpenLanguage}
                    onDelete={
                      isOwn ? (record) => setDeleting({ records: [record], all: false }) : undefined
                    }
                  />
                </>
              ))}
          </section>
        </article>
      )}

      {editing && (
        <ProfileDialog
          languages={languages}
          onClose={() => setEditing(false)}
          onLanguageCreated={onLanguageCreated}
        />
      )}

      {deleting !== null && handle !== null && (
        <DeleteRecordsDialog
          records={deleting.records}
          all={deleting.all}
          handle={handle}
          onClose={() => setDeleting(null)}
          onDeleted={(uris) => {
            setDeleting(null);
            // Drop them from the listing straight away: the PDS is the source
            // of truth here and it has already answered, so unlike a write
            // there is nothing to wait for the AppView to catch up on. Filter
            // by what actually went, not by what was asked — a partial failure
            // must leave the survivors on screen.
            const gone = new Set(uris);
            setRepo((prev) =>
              prev === null
                ? prev
                : { ...prev, records: prev.records.filter((r) => !gone.has(r.uri)) },
            );
          }}
        />
      )}
    </div>
  );
}
