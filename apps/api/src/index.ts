import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  isValidLanguageTag,
  normalizeLanguageTag,
  TRANSLATE_DEFAULT_DEPTH,
  type LabelsResponse,
  type EntriesResponse,
  type HealthResponse,
  type LanguagesResponse,
} from "@leksis/types";
import { listLabels } from "./labels";
import { getLanguageDashboard } from "./dashboard";
import { pingDb } from "./db";
import { getEntry, searchEntries } from "./entries";
import { getEntryRelations, getTranslations } from "./relations";
import { getCurrentLanguageRecord, listLanguages } from "./languages";
import { startJetstream } from "./firehose/jetstream";

const app = new Hono();

// CORS is handled entirely by Caddy for /api/* (see Caddyfile): same-origin
// leksis.eu traffic needs none, and cross-origin dev access is granted per
// source IP via ALLOWED_IPS. The API deliberately emits no CORS headers
// so Caddy stays the single Access-Control-Allow-Origin authority.

app.get("/", (c) => c.text("Leksis API"));

app.get("/health", async (c) => {
  const dbUp = await pingDb();
  const body: HealthResponse = {
    status: "ok",
    service: "leksis-api",
    db: dbUp ? "connected" : "unreachable",
    time: new Date().toISOString(),
  };
  return c.json(body);
});

app.get("/languages", async (c) => {
  // Invalid or absent locale degrades to the tag + endonym listing.
  const requested = normalizeLanguageTag(c.req.query("locale") ?? "");
  const locale = isValidLanguageTag(requested) ? requested : "";
  try {
    const languages = await listLanguages(locale);
    const body: LanguagesResponse = { locale, languages };
    return c.json(body);
  } catch (err) {
    console.error("GET /languages failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/languages/:tag/dashboard", async (c) => {
  const requested = normalizeLanguageTag(c.req.param("tag"));
  if (!isValidLanguageTag(requested)) {
    return c.json({ error: "invalid language tag" }, 400);
  }
  try {
    const dashboard = await getLanguageDashboard(requested);
    if (!dashboard) return c.json({ error: "language not found" }, 404);
    return c.json(dashboard);
  } catch (err) {
    console.error("GET /languages/:tag/dashboard failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/languages/:tag/currentRecord", async (c) => {
  const requested = normalizeLanguageTag(c.req.param("tag"));
  if (!isValidLanguageTag(requested)) {
    return c.json({ error: "invalid language tag" }, 400);
  }
  try {
    const record = await getCurrentLanguageRecord(requested);
    if (!record) return c.json({ error: "language not found" }, 404);
    return c.json(record);
  } catch (err) {
    console.error("GET /languages/:tag/currentRecord failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/languages/:tag/labels", async (c) => {
  const requested = normalizeLanguageTag(c.req.param("tag"));
  if (!isValidLanguageTag(requested)) {
    return c.json({ error: "invalid language tag" }, 400);
  }
  try {
    const labels = await listLabels(requested);
    const body: LabelsResponse = { languageID: requested, labels };
    return c.json(body);
  } catch (err) {
    console.error("GET /languages/:tag/labels failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/entries", async (c) => {
  const q = c.req.query("q") ?? "";
  // An invalid language scope degrades to searching all languages.
  const requested = normalizeLanguageTag(c.req.query("l") ?? "");
  const languageID = isValidLanguageTag(requested) ? requested : "";
  try {
    const entries = await searchEntries(q, languageID);
    const body: EntriesResponse = { entries };
    return c.json(body);
  } catch (err) {
    console.error("GET /entries failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

// Translation search. The source language and a target are both required: with
// no target the search is monolingual, which is GET /entries. Invalid tags are
// refused rather than degraded, because a translation search silently answering
// about the wrong language is worse than an error.
app.get("/translate", async (c) => {
  const from = normalizeLanguageTag(c.req.query("from") ?? "");
  const to = normalizeLanguageTag(c.req.query("to") ?? "");
  if (!isValidLanguageTag(from) || !isValidLanguageTag(to)) {
    return c.json({ error: "invalid language tag" }, 400);
  }
  const requestedDepth = Number(c.req.query("depth") ?? TRANSLATE_DEFAULT_DEPTH);
  const depth = Number.isFinite(requestedDepth) ? requestedDepth : TRANSLATE_DEFAULT_DEPTH;
  try {
    // getTranslations clamps the depth to the server's cap.
    return c.json(await getTranslations(c.req.query("q") ?? "", from, to, depth));
  } catch (err) {
    console.error("GET /translate failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/entries/:key/relations", async (c) => {
  try {
    const entry = await getEntry(c.req.param("key"));
    if (!entry) return c.json({ error: "entry not found" }, 404);
    return c.json(await getEntryRelations(entry.key));
  } catch (err) {
    console.error("GET /entries/:key/relations failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

app.get("/entries/:key", async (c) => {
  try {
    const entry = await getEntry(c.req.param("key"));
    if (!entry) return c.json({ error: "entry not found" }, 404);
    return c.json(entry);
  } catch (err) {
    console.error("GET /entries/:key failed:", err);
    return c.json({ error: "database unavailable" }, 503);
  }
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`leksis-api listening on :${info.port}`);
  // The consumer manages its own reconnection and never throws; this catch
  // only guards startup so a firehose problem cannot take down HTTP.
  startJetstream().catch((err) => console.error("jetstream: failed to start:", err));
});
