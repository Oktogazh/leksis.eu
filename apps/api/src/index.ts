import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  isValidLanguageTag,
  normalizeLanguageTag,
  type AbbreviationsResponse,
  type EntriesResponse,
  type HealthResponse,
  type LanguagesResponse,
} from "@leksis/types";
import { listAbbreviations } from "./abbreviations";
import { getLanguageDashboard } from "./dashboard";
import { pingDb } from "./db";
import { getEntry, searchEntries } from "./entries";
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

app.get("/languages/:tag/abbreviations", async (c) => {
  const requested = normalizeLanguageTag(c.req.param("tag"));
  if (!isValidLanguageTag(requested)) {
    return c.json({ error: "invalid language tag" }, 400);
  }
  try {
    const abbreviations = await listAbbreviations(requested);
    const body: AbbreviationsResponse = { languageID: requested, abbreviations };
    return c.json(body);
  } catch (err) {
    console.error("GET /languages/:tag/abbreviations failed:", err);
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
