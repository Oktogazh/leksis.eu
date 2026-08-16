// The works the fixture example sentences cite (`leksis-testset` §3.4).
//
// **Quarantine, for a lexicon whose identity is a global registry.** A fixture
// source must never claim a real work's OCLC number: a citation resolving to a
// fixture description of somebody's actual book is worse than an unresolved one.
// Two rules do it — 16-digit numbers, allocated from the very top of the range
// `normalizeOclc` accepts (real numbers are around ten digits, so the top is
// empty by construction), and `languages` drawn from the fixture tags alone, so
// the source is offered in no real language's entry editor and listed on no real
// dashboard.
//
// The handle convention carries over to `citation.short`, since that is what
// search matches and what every citing entry prints.

import type { SourceFixture } from "./types.ts";

/** The number E-30 cites and NOTHING describes — S-02, verified by absence. */
export const UNDESCRIBED_OCLC = "9000000000000002";

export const sourceFixtures: SourceFixture[] = [
  {
    covers: ["S-01"],
    expect:
      "Every field renders: author, year and a working url. Listed on both /language/qtl and /language/qtm, since it covers two languages, and offered in both entry editors.",
    record: {
      category: "bibliographic",
      oclc: "9000000000000001",
      title: "Geriadur ar yezh tesk",
      author: "Aozer, K.",
      year: "1904",
      url: "https://leksis.eu/language/qtl",
      // Two languages, so the "offered to both" rule is visible.
      languages: ["qtl", "qtm"],
      citation: {
        short: "lxs-01",
        long: "Leksis fixture lxs-01 — Aozer, K., Geriadur ar yezh tesk, 1904. A described work, every optional field present.",
      },
    },
  },
  {
    covers: ["S-03"],
    expect:
      "No author, no year, no url. Each absent field renders as NOTHING — never as an empty row or a dash.",
    record: {
      category: "bibliographic",
      oclc: "9000000000000003",
      title: "Notennoù displegañ",
      languages: ["qtl"],
      citation: {
        short: "lxs-03",
        long: "Leksis fixture lxs-03 — Notennoù displegañ. A described work whose optional fields are genuinely absent.",
      },
    },
  },
  {
    covers: ["S-04"],
    expect:
      "A work of the BARE language: it is listed on /language/qtm, which has declared no grammar at all, proving a source is independent of the grammar cascade.",
    record: {
      category: "bibliographic",
      oclc: "9000000000000004",
      title: "Levr ar yezh noaz",
      author: "Skrivagner, M.",
      languages: ["qtm"],
      citation: {
        short: "lxs-04",
        long: "Leksis fixture lxs-04 — Skrivagner, M., Levr ar yezh noaz. A work of the bare fixture language.",
      },
    },
  },
];
