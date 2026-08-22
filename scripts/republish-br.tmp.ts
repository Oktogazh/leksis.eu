/*
  Republish the Breton language record in the merged shape (ADR-0019).

  This is slice 2's deferred action item, run at slice 6 with the content the
  user supplied rather than with what the index happens to hold.

  WHAT IT IS BUILT FROM, and why it is two sources:

  - **Everything except the `Todo` scaffold** is written out below from the copy
    the user pasted (2026-08-21). That copy is richer than the currently
    accepted record: 14 parts of speech against 2, two more features (`Implij`,
    `Degree`) with their nine values, `Number=Dual`, and `Number=Coll` relabelled
    "hollek" where the accepted record still says "stroll".
  - **The 205 `Todo` rows** are lifted verbatim from the accepted record and
    filtered to the ids the pasted copy still carries. The scaffold's rows are
    byte-identical between the two — spot-checked on Todo3, Todo15, Todo121 and
    Todo231 — and the pasted copy is simply 25 rows shorter, because the user has
    been triaging them away. Copying 205 long Breton notes by hand would risk a
    transcription error in exactly the material that cannot be regenerated;
    filtering the ones already published cannot.

  WHAT IS DROPPED, and why:

  - `axes` and `layout` are **rejected at validation** by the merged lexicon, so
    they cannot be carried. Nor can they be translated: an axis now needs the
    value each headword flavour is *cited at*, and which value Breton cites a
    masculine noun at is a lexicographic judgement, not a mechanical one. It is
    one pass in the new Categories tab.
  - `bindings` becomes `categories`, losslessly: a named combination with no
    axis is a category with one annotation and no `default`. Both abbreviations
    survive; no new claim is made.

    npx tsx scripts/republish-br.tmp.ts            # validate and print, write nothing
    npx tsx scripts/republish-br.tmp.ts --publish  # putRecord as testaccount

  Credentials come from apps/web/.env.local, like publish-fixtures.ts. Never
  printed.
*/
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AtpAgent } from "@atproto/api";
import {
  LEKSIS_LANGUAGE_COLLECTION,
  grammarIssues,
  isValidGrammar,
  type Grammar,
  type GrammarValue,
} from "@leksis/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(HERE, "..", "apps", "web", ".env.local");
const PDS = "https://pds.leksis.eu";
const ACCEPTED = `${PDS}/xrpc/com.atproto.repo.getRecord?repo=did:plc:sskf5uopmzotqtmq4banq6e5&collection=eu.leksis.language&rkey=br`;

/** Todo ids the pasted copy no longer carries — triaged away since. */
const RETIRED_TODO = new Set([
  1, 2, 14, 17, 21, 30, 31, 36, 38, 43, 47, 49, 52, 68, 69, 76, 91, 102, 107,
  108, 109, 126, 196, 219, 225,
]);

function value(
  feature: string,
  val: string,
  long: string,
  short?: string,
  extra?: Partial<GrammarValue>,
): GrammarValue {
  return {
    feature,
    value: val,
    label: short === undefined ? { long } : { long, short },
    ...extra,
  };
}

const MEURGORF = {
  url: "https://niverel.brezhoneg.bzh/br/meurgorf/abrev",
  text: "Meurgorf",
};
const ARBRES_ADJ = {
  url: "https://arbres.iker.cnrs.fr/index.php?title=Les_adjectifs#Terminologie",
  text: "Arbres",
};

const pos: NonNullable<Grammar["pos"]> = [
  { value: "NOUN", label: { long: "anv-kadarn", short: "ak." } },
  { value: "VERB", label: { long: "verb", short: "v." } },
  { value: "PROPN", label: { long: "anv divoutin", short: "ad." } },
  { value: "ADJ", label: { long: "anv-gwan", short: "ag." } },
  { value: "ADV", label: { long: "adverb", short: "adv." } },
  { value: "INTJ", label: { long: "estlammadell", short: "estl." } },
  { value: "DET", label: { long: "doareer", short: "dr." } },
  { value: "NUM", label: { long: "ger niveriñ", short: "g. niv." } },
  { value: "ADP", label: { long: "araogenn", short: "ar." } },
  { value: "PRON", label: { long: "raganv", short: "rag." } },
  { value: "PART", label: { long: "rannig", short: "rn." } },
  { value: "SCONJ", label: { long: "stagell isurzhiañ", short: "stl. isur." } },
  { value: "CCONJ", label: { long: "stagell kenurzhiañ", short: "stl. kenur." } },
  { value: "AUX", label: { long: "skoazeller" } },
];

const features: NonNullable<Grammar["features"]> = [
  { feature: "Gender", label: { long: "Reizh" } },
  { feature: "Number", label: { long: "Niver" } },
  { feature: "Mood", label: { long: "Doare" } },
  { feature: "Tense", label: { long: "Amzer", short: "amz." } },
  { feature: "Voice", label: { long: "Tu" } },
  { feature: "Subcat", label: { long: "Trañzitivelezh" } },
  { feature: "Person", label: { long: "Gour" } },
  { feature: "VerbForm", label: { long: "Stummoù verbel" } },
  {
    feature: "Todo",
    scheme: "br",
    lexicographic: true,
    label: { long: "Todo", short: "Todo" },
    note: "Working scaffold, not grammar. Every value under this feature is an abbreviation printed by Meurgorf that no one has decided yet. Each carries the dictionary's own long and short forms as its label, and a note with its frequency in the crawled corpus, three entries using it, and an opinion that is explicitly not a decision. Move each value to where it belongs — a part of speech, a feature value, a named combination, a plain abbreviation — then delete this feature. The entry builder refuses to run while it exists.",
    references: [
      {
        url: MEURGORF.url,
        text: "Working scaffold minted by OmniParser from Meurgorf's own abbreviation list and index categories; every value awaits an expert decision.",
      },
    ],
  },
  {
    feature: "Implij",
    scheme: "br",
    lexicographic: true,
    label: { long: "Implij (anvioù-gwan)" },
    note: 'Implij un anv-gwan evel "doareenn" (goude an anv) pe "stagenn" (evel predikat).',
  },
  { feature: "Degree", label: { long: "Derez" } },
];

/** Every value the pasted copy carries outside the `Todo` scaffold, in its order. */
const plainValues: GrammarValue[] = [
  value("Gender", "Masc", "gourel", "gour."),
  value("Number", "Sing", "unander", "unan."),
  value("Number", "Plur", "liester", "lies."),
  value("Number", "Coll", "hollek", "holl.", {
    note: "NOUN Num=Coll =/> ak. stroll met ak. hollek, cf. UD docs.",
  }),
  value("Number", "Grpl", "adliester", "adlies."),
  value("Gender", "Fem", "gwregel", "gw."),
  value("Mood", "Ind", "Diskleriañ", "diskl."),
  value("Mood", "Imp", "Gourc'hemenn", "gourc'h."),
  value("Mood", "Cnd", "Gallus", "gall."),
  value("Mood", "Irr", "Dic'hallus", "dic'hall."),
  value("Tense", "Past", "Tremenet strizh", "trem. st."),
  value("Tense", "Pres", "A-vremañ", "a-vr."),
  value("Tense", "Fut", "Dazont"),
  value("Tense", "Imp", "Tremenet ledan"),
  value("Voice", "Act", "Tu gra"),
  value("Subcat", "Intr", "gwan"),
  value("Subcat", "Indir", "gwan dieeun"),
  value("Subcat", "Tran", "kreñv"),
  value("VerbForm", "Part", "Anv-gwan verb"),
  value("VerbForm", "Inf", "Anv-verb"),
  value("Person", "0", "dic'hour"),
  value("Person", "2", "daou gour"),
  value("Person", "3", "tri gour"),
  value("Person", "1", "unan gour"),
];

/** The nine rows the accepted record does not have — adjectival use, and degree. */
const addedValues: GrammarValue[] = [
  value("Implij", "Doar", "doareenn", "doar.", {
    scheme: "br",
    references: [
      MEURGORF,
      { url: ARBRES_ADJ.url, text: "Arbres: Les adjectifs, Terminologie" },
    ],
  }),
  value("Implij", "Stn", "stagenn", "stn.", {
    scheme: "br",
    references: [
      { url: ARBRES_ADJ.url, text: "Arbres: Les adjectifs, Terminologie" },
      { url: MEURGORF.url, text: "Meurgorf: Berradurioù" },
    ],
  }),
  value("Implij", "DS", "doareenn ha stagenn", "doar./stn.", {
    scheme: "br",
    note: "Lodenn vrasañ an anvioù-gwan a zo er rummad-mañ.",
  }),
  value("Degree", "Pos", "pozitiv", undefined, {
    note: 'Derez "diazez" un anv-gwan: yaouank (ha neket yaouankoc\'h pe yaouankañ).',
  }),
  value("Degree", "Cmp", "eil derez", undefined, { note: "Yaouankoc'h" }),
  value("Degree", "Sup", "trede derez", undefined, { note: "Yaouankañ" }),
  value("Degree", "Dim", "bihanaat", undefined, { note: "Yaouankik" }),
  value("Degree", "Equ", "derez kentañ", undefined, {
    note: "Derez kentañ ez-istorel, so. al lostger kembraek -ed (mor ifanged â...), implijet evel stumm estlammañ e brezhoneg a-vremañ: Bravat ti eo hennezh!",
  }),
  value("Number", "Dual", "daou", undefined, {
    note: "Cf. https://arbres.iker.cnrs.fr/index.php?title=Duel#Terminologie",
  }),
];

const inherent: NonNullable<Grammar["inherent"]> = [
  { category: { upos: { value: "NOUN" } }, feature: "Gender" },
  { category: { upos: { value: "VERB" } }, feature: "Subcat" },
];

/**
 * The two named combinations, carried over as categories with one label each.
 *
 * Nothing is said about the number they are cited at: the accepted record
 * declared Number an axis of `{NOUN}`, and ADR-0020 asks instead which features
 * *identify* a headword. Breton has more than one answer — the anv-kadarn
 * stroll is cited in the plural — so the flavours are declared one level deeper
 * in the editor, which is the language's call and not this script's.
 */
const categories: NonNullable<Grammar["categories"]> = [
  {
    category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Masc" }] },
    label: { long: "anv-kadarn gourel", short: "ak. g." },
  },
  {
    category: { upos: { value: "NOUN" }, feats: [{ feature: "Gender", value: "Fem" }] },
    label: { long: "anv-kadarn gwregel", short: "ak. gw." },
  },
];

function credentials(): { service: string; identifier: string; password: string } {
  const text = readFileSync(ENV_LOCAL, "utf8");
  const read = (key: string): string => {
    const line = text.split("\n").find((row) => row.trimStart().startsWith(`${key}=`));
    return line === undefined ? "" : line.slice(line.indexOf("=") + 1).trim();
  };
  const out = {
    service: read("VITE_DEV_PDS"),
    identifier: read("VITE_DEV_HANDLE"),
    password: read("VITE_DEV_PASSWORD"),
  };
  for (const [k, v] of Object.entries(out)) if (v === "") throw new Error(`${k} is blank`);
  return out;
}

async function main(): Promise<void> {
  const publish = process.argv.includes("--publish");

  // The Todo scaffold, read back from the version already on the PDS.
  const res = await fetch(ACCEPTED);
  if (!res.ok) throw new Error(`could not read the accepted br record: ${res.status}`);
  const accepted = (await res.json()) as { value: { grammar: Grammar } };
  const acceptedTodo = (accepted.value.grammar.values ?? []).filter(
    (row) => row.feature === "Todo",
  );
  const keptTodo = acceptedTodo.filter(
    (row) => !RETIRED_TODO.has(Number(row.value.replace(/\D/g, ""))),
  );
  console.log(
    `Todo scaffold: ${acceptedTodo.length} rows on the accepted record, ` +
      `${acceptedTodo.length - keptTodo.length} retired, ${keptTodo.length} kept`,
  );
  if (keptTodo.length !== 205) {
    throw new Error(`expected 205 kept Todo rows, got ${keptTodo.length} — check RETIRED_TODO`);
  }

  const grammar: Grammar = {
    pos,
    features,
    values: [...plainValues, ...keptTodo, ...addedValues],
    inherent,
    categories,
  };

  const record = {
    tag: "br",
    translations: [
      { languageID: "br", translation: "Brezhoneg" },
      { languageID: "cy", translation: "Llydaweg" },
      { languageID: "en", translation: "Breton" },
    ],
    grammar,
  };

  console.log(
    `\nbuilt: ${pos.length} pos · ${features.length} features · ${(grammar.values ?? []).length} values ` +
      `(${plainValues.length} plain + ${keptTodo.length} Todo + ${addedValues.length} added) · ` +
      `${inherent.length} inherent · ${categories.length} categories · no axes, no layout`,
  );

  if (!isValidGrammar(grammar)) throw new Error("isValidGrammar refused the built grammar");
  const issues = grammarIssues(grammar);
  console.log(
    issues.length === 0
      ? "gate: isValidGrammar ok, grammarIssues empty — this version will index"
      : `gate: ${issues.length} defect(s): ${issues.map((i) => `${i.kind}(${i.key})`).join(", ")}`,
  );
  if (issues.length > 0) throw new Error("refusing to publish an incoherent grammar");

  if (!publish) {
    console.log("\n(dry run — pass --publish to write it)");
    return;
  }

  const { service, identifier, password } = credentials();
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  const did = agent.session?.did;
  if (did === undefined) throw new Error("logged in but no DID");
  const written = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: LEKSIS_LANGUAGE_COLLECTION,
    rkey: "br",
    record: {
      $type: LEKSIS_LANGUAGE_COLLECTION,
      ...record,
      createdAt: new Date().toISOString(),
    },
  });
  console.log(`\npublished ${written.data.uri}\n  cid ${written.data.cid}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
