import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EntryExample, EntryExampleSource, SourceCitation } from "@leksis/types";
import { fetchSource } from "../lib/source-record";
import { navigateTo, sourcePath } from "../lib/routes";

// Example sentences as a reader sees them: the sentence, then the work it was
// taken from. The entry record carries an OCLC number and a locator and nothing
// else, so everything printed about the work is resolved here, from the
// eu.leksis.source record for that number — which is what makes a citation
// correctable in one place instead of in everybody's entries.

/**
 * What resolving one OCLC number found. The two failure states are kept apart
 * on purpose: **"nobody has described this work"** is an ordinary, expected
 * state of a perfectly valid citation and the one that invites a reader to
 * describe it, while "described but unreadable" (or an unreachable AppView) is
 * a fault, and offering to describe a work somebody has already described would
 * invite a stranger's record to be overwritten on the strength of a network
 * error.
 */
export type SourceCitationState =
  | { status: "loading" }
  | { status: "resolved"; citation: SourceCitation }
  | { status: "undescribed" }
  | { status: "unreadable" };

/**
 * Resolve one OCLC number to its citation forms, through the per-number session
 * cache — so an entry quoting the same dictionary a dozen times resolves it
 * once.
 */
export function useSourceCitation(oclc: string): SourceCitationState {
  const [state, setState] = useState<SourceCitationState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSource(oclc)
      .then((found) => {
        if (cancelled) return;
        if (found === null) return setState({ status: "undescribed" });
        if (found.record === null) return setState({ status: "unreadable" });
        setState({ status: "resolved", citation: found.record.citation });
      })
      .catch((error: unknown) => {
        // Never "undescribed" on a failure: that would be a false statement
        // about somebody else's contribution whenever the API is down.
        console.warn(`could not resolve OCLC ${oclc}:`, error);
        if (!cancelled) setState({ status: "unreadable" });
      });
    return () => {
      cancelled = true;
    };
  }, [oclc]);

  return state;
}

/**
 * The citation after one example sentence.
 *
 * Resolved → the source's short form, with the full one on hover, linking to
 * the work's page. Unresolved → the bare number, visibly styled as such: the
 * unbound-tag posture, since a reference to a work nobody has described yet is
 * exactly as valid as one to a described work, and hiding it would lose the
 * attestation the sentence was quoted for.
 */
export function ExampleCitation({
  source,
  onDescribeSource,
}: {
  source: EntryExampleSource;
  /** Offered on an undescribed number; omit for a reader who cannot publish. */
  onDescribeSource?: (oclc: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const state = useSourceCitation(source.oclc);
  const locator = source.locator !== undefined && source.locator !== "" ? source.locator : null;

  const open = (
    <button
      type="button"
      onClick={() => navigateTo(sourcePath(source.oclc))}
      title={t("examples.openSource")}
      className={
        state.status === "resolved"
          ? "text-primary hover:text-primary-hover"
          : state.status === "loading"
            ? // Not yet unresolved — only not yet resolved. Styling it as
              // unresolved would flash a warning at every reader on every load.
              "text-content-subtle hover:underline"
            : "text-warning hover:underline "
      }
    >
      {state.status === "resolved" ? (
        <abbr title={state.citation.long} className="no-underline">
          {state.citation.short}
        </abbr>
      ) : (
        <span className="font-mono">
          {t("examples.oclcLabel")} {source.oclc}
        </span>
      )}
    </button>
  );

  return (
    <p className="mt-1 text-xs text-content-subtle">
      — {open}
      {locator !== null && <span className="ml-1">{locator}</span>}
      {state.status === "undescribed" && (
        <>
          <span className="ml-2" title={t("examples.undescribedHint")}>
            {t("examples.undescribed")}
          </span>
          {onDescribeSource !== undefined && (
            <button
              type="button"
              onClick={() => onDescribeSource(source.oclc)}
              className="ml-2 text-primary hover:text-primary-hover"
            >
              {t("examples.describeSource")}
            </button>
          )}
        </>
      )}
      {state.status === "unreadable" && (
        <span className="ml-2" title={t("examples.unreadableHint")}>
          {t("examples.unreadable")}
        </span>
      )}
    </p>
  );
}

/**
 * A definition leaf's example sentences, as quoted content under its text.
 *
 * Leaves only — a group node is a heading with no sense of its own to
 * exemplify — which the caller enforces by only rendering this under a node
 * that carries text.
 */
export function ExampleSentences({
  examples,
  onDescribeSource,
}: {
  examples: readonly EntryExample[];
  onDescribeSource?: (oclc: string) => void;
}): ReactNode {
  if (examples.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2 border-l-2 border-primary/30 pl-3">
      {examples.map((example, i) => (
        <li key={i}>
          <p className="text-sm italic text-content-muted">{example.text}</p>
          {example.source !== undefined && (
            <ExampleCitation
              source={example.source}
              {...(onDescribeSource !== undefined ? { onDescribeSource } : {})}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
