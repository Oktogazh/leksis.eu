// Shared shapes for the testset fixture set (`.claude/skills/leksis-testset`).
//
// Every fixture carries the two things a browsing agent needs and a URL cannot
// give it: `covers`, which keys the coverage matrix, and `expect`, one sentence
// of what a correct page looks like. They are written here beside the record
// rather than in the manifest, because the manifest is regenerated from the live
// API after every run and would otherwise have to be hand-edited to stay true.

import type {
  LeksisEntryRecord,
  LeksisLanguageRecord,
  LeksisParadigmRecord,
  LeksisSourceRecord,
} from "@leksis/types";

/** What a fixture is for, and what asserting against it looks like. */
export interface FixtureNote {
  /** Coverage-matrix row ids this fixture answers (`["P-12", "E-27"]`). */
  covers: string[];
  /** One sentence describing a correct page. Copied verbatim into the manifest. */
  expect: string;
}

export interface LanguageFixture extends FixtureNote {
  /** Which of the three quarantined roles this language plays. */
  role: "full" | "bare" | "defective";
  record: Omit<LeksisLanguageRecord, "$type" | "createdAt">;
  /**
   * A second version published after the first has indexed. Only `qto` has one:
   * it is published coherent, then rewritten defective, and the rewrite must be
   * REFUSED — which is the property the fixture exists to prove.
   */
  rewrite?: Omit<LeksisLanguageRecord, "$type" | "createdAt">;
}

export interface SourceFixture extends FixtureNote {
  record: Omit<LeksisSourceRecord, "$type" | "createdAt">;
}

export interface EntryFixture extends FixtureNote {
  /** The `lxt-NN` handle, carried as a non-canonical orthography. */
  handle: string;
  record: Omit<LeksisEntryRecord, "$type" | "createdAt" | "redirectTo">;
  /**
   * Further versions of the same entry, published in order and chained by
   * `subject` — how E-21 gets its version history without the caller tracking
   * record URIs.
   */
  versions?: Omit<LeksisEntryRecord, "$type" | "createdAt" | "subject" | "redirectTo">[];
  /**
   * Redirect this withdrawal at another fixture, by handle. An `entryKey` is
   * minted by the AppView from the creating record's URI, so it cannot be known
   * before publishing — the publisher resolves this after the target lands.
   */
  redirectToHandle?: string;
}

export interface ParadigmFixture extends FixtureNote {
  /** The `lxp-NN` handle. A paradigm has no searchable field, so this is manifest-only. */
  handle: string;
  record: Omit<LeksisParadigmRecord, "$type" | "createdAt">;
}
