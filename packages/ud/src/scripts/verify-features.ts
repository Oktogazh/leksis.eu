// Verification harness for the feature candidates the binding editor offers
// (`Grammar & labels` → Features → "Documented by Universal Dependencies").
//
// The property under test is that the list **widens** the contributor's
// options instead of narrowing them. Welsh is the standing case: UD publishes
// no language-specific feature documentation for `cy` at all, and Welsh verbs
// are transitive or intransitive — so `Subcat` must be on offer to a Welsh
// editor even though no Welsh-scoped source documents it. It was not, until
// 2026-08-18, because the candidates were read off the universal-tier index.
//
//   npx tsx packages/ud/src/scripts/verify-features.ts
//
// The first block is pure — fixtures in, assertions out, no network. The
// second calls the live documentation, so a red line there may mean UD moved
// its pages rather than that this repo broke; either way the editor keeps
// working, since every fetch here fails soft to "no suggestions".

import {
  featurePageUrl,
  fetchFeatureValues,
  fetchFeatures,
  parseFeatureList,
  parseFeatureValues,
} from "../index";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- the page shapes, verbatim from universaldependencies.org -----------

/**
 * `u/feat/all.html` in miniature: a universal feature, a non-universal one
 * with a global page (the case the old index dropped), a layered name, and
 * the plain cross-reference heading a base page carries for its own layers —
 * which repeats a name and must not produce a second candidate.
 */
const ALL_FEATURES_PAGE = `
<h1 id="universal-features">Universal features</h1>
<p><a id="al-u-feat/Gender" class="al-dest"></a></p>
<h2><code>Gender</code>: gender</h2>
<p>Gender is usually a lexical feature of nouns.</p>
<h2 id="gendersubj">Gender[subj]</h2>
<p>See the layered feature below.</p>
<h2><code>Gender[subj]</code>: gender agreement with subject</h2>
<p><a id="al-u-feat/Subcat" class="al-dest"></a></p>
<h2><code>Subcat</code>: subcategorization</h2>
<p>Subcategorization distinguishes intransitive and transitive verbs.</p>
<h2 id="references">References</h2>
`;

/** `u/feat/Subcat.html`, the values level for the feature above. */
const SUBCAT_PAGE = `
<h2><code>Subcat</code>: subcategorization</h2>
<h3 id="intr-intransitive-verb"><a name="Intr"><code class="language-plaintext highlighter-rouge">Intr</code></a>: intransitive verb</h3>
<h3 id="tran-transitive-verb"><a name="Tran"><code class="language-plaintext highlighter-rouge">Tran</code></a>: transitive verb</h3>
`;

// ---- pure parsing -------------------------------------------------------

const parsed = parseFeatureList(ALL_FEATURES_PAGE);
const names = parsed.map((row) => row.feature);

check("Subcat is a candidate", names.includes("Subcat"), names.join(", "));
check(
  "Subcat carries its gloss",
  parsed.find((row) => row.feature === "Subcat")?.gloss === "subcategorization",
);
check("a layered name is a candidate", names.includes("Gender[subj]"));
check(
  "a repeated name yields one candidate",
  names.filter((n) => n === "Gender[subj]").length === 1,
);
check(
  "a plain heading is not a candidate",
  !names.includes("References") && !names.includes("Universal features"),
);
check("candidates are sorted", [...names].sort((a, b) => a.localeCompare(b, "en")).join() === names.join());
check("an unreadable page yields no candidates", parseFeatureList("").length === 0);

check(
  "Subcat's values parse",
  parseFeatureValues(SUBCAT_PAGE)
    .map((v) => v.value)
    .join(",") === "Intr,Tran",
);
check(
  "a layered name documents on its base page",
  featurePageUrl("Gender[subj]") === "https://universaldependencies.org/u/feat/Gender.html",
);

// ---- the live documentation ---------------------------------------------

/** The universal tier — everything the previous source could ever offer. */
const UNIVERSAL_TIER = [
  "Abbr", "Animacy", "Aspect", "Case", "Clusivity", "Definite", "Degree", "Deixis", "DeixisRef",
  "Evident", "ExtPos", "Foreign", "Gender", "Mood", "NounClass", "NumType", "Number", "Person",
  "Polarity", "Polite", "Poss", "PronType", "Reflex", "Tense", "Typo", "VerbForm", "Voice",
];

const live = await fetchFeatures();
const liveNames = live.map((row) => row.feature);

if (liveNames.length === 0) {
  console.log("SKIP  live documentation unreachable — the editor falls back to manual entry");
} else {
  check(
    "a Welsh editor is offered Subcat",
    liveNames.includes("Subcat"),
    `${liveNames.length} features offered`,
  );
  const withheld = UNIVERSAL_TIER.filter((name) => !liveNames.includes(name));
  check("the universal tier is still whole", withheld.length === 0, withheld.join(", "));
  check(
    "non-universal features are offered too",
    ["AdpType", "NumForm", "Style", "VerbType"].every((name) => liveNames.includes(name)),
  );
  check("layered names are offered too", liveNames.some((name) => name.endsWith("[psor]")));
  check(
    "candidates are glossed",
    live.filter((row) => row.gloss !== undefined).length === live.length,
  );

  const subcat = await fetchFeatureValues("Subcat");
  check(
    "Subcat's values are offered",
    ["Intr", "Tran"].every((v) => subcat.values.some((row) => row.value === v)),
    subcat.values.map((row) => row.value).join(", "),
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
