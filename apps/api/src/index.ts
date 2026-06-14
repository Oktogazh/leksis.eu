import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HealthResponse } from "@glosis/types";
import { pingDb } from "./db";

const app = new Hono();

// Allow the web app to call the API from another Fly.io app / localhost.
app.use("/*", cors({ origin: process.env.WEB_ORIGIN ?? "*" }));

app.get("/", (c) => c.text("Glosis API"));

app.get("/health", async (c) => {
  const dbUp = await pingDb();
  const body: HealthResponse = {
    status: "ok",
    service: "glosis-api",
    db: dbUp ? "connected" : "unreachable",
    time: new Date().toISOString(),
  };
  return c.json(body);
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`glosis-api listening on :${info.port}`);
});
