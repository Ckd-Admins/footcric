import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = "https://foott.vercel.app/api/events";
const AUTHOR = "Shiva Chaudhary";
const TIMEZONE = "Asia/Kolkata";

const EVENTS_FILE = path.join(__dirname, "cricsteras-events.json");
const STREAMS_FILE = path.join(__dirname, "cricsteras-streams.json");

const COMMON_HEADERS = {
  Accept: "application/json",
  Origin: "https://footsters-tv.pages.dev",
  Referer: "https://footsters-tv.pages.dev/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
};

// ---------- Helpers ----------
function formatIndiaDate(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get(
    "minute"
  )}:${get("second")} ${get("dayPeriod").toUpperCase()} IST`;
}

function formatIsoWithOffset(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get(
    "minute"
  )}:${get("second")}+05:30`;
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET", headers: COMMON_HEADERS });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- NEW: stream ko index + stream_code ke saath enrich karo ----------
function enrichStreams(eventId, rawStreams) {
  if (!Array.isArray(rawStreams)) return [];
  return rawStreams.map((s, i) => ({
    index: i,                                  
    stream_code: `${eventId}.${i}`,            
    title: s?.title ?? `Stream ${i + 1}`,
    url: s?.url ?? "",
    drm: s?.drm
      ? {
          kid: String(s.drm.kid || "").toLowerCase(),
          key: String(s.drm.key || "").toLowerCase(),
        }
      : null,
  }));
}

// ---------- Main ----------
async function main() {
  console.log(`[1/2] GET ${API_URL}`);
  const base = await fetchJson(API_URL);
  const baseEvents = Array.isArray(base.events) ? base.events : [];

  const now = new Date();
  const commonMeta = {
    success: base.success ?? true,
    author: AUTHOR,
    timezone: TIMEZONE,
    generated_at: formatIsoWithOffset(now),
    generated_at_india: formatIndiaDate(now),
  };

  // ===== events.json (base list) =====
  const eventsJson = {
    ...commonMeta,
    total: base.total ?? baseEvents.length,
    events: baseEvents,
    raw_data: base.raw_data ?? "",
  };
  await fs.writeFile(EVENTS_FILE, JSON.stringify(eventsJson, null, 2) + "\n");
  console.log(`[done] cricsteras-events.json → ${eventsJson.total} events`);

  // ===== streams.json (per-event streams with index) =====
  console.log(`[2/2] Fetching streams for ${baseEvents.length} events...`);
  const streamEvents = [];
  let ok = 0;
  let failed = 0;

  for (const ev of baseEvents) {
    try {
      const detail = await fetchJson(`${API_URL}?play=${ev.event_id}`);
      const evDetail = detail.events?.[0] ?? {};
      const rawStreams = Array.isArray(evDetail.streams) ? evDetail.streams : [];
      const streams = enrichStreams(ev.event_id, rawStreams);

      streamEvents.push({
        event_id: ev.event_id,
        event_title: ev.event_title,
        event_time: ev.event_time,
        event_time_raw: ev.event_time_raw,
        category: ev.category,
        stream_count: streams.length || ev.stream_count || 0,
        streams,
      });
      ok++;
      console.log(
        `  ✓ ${ev.event_id} (${ev.category}) → ${streams.length} stream(s)`
      );
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${ev.event_id}: ${e.message}`);
      streamEvents.push({
        event_id: ev.event_id,
        event_title: ev.event_title,
        event_time: ev.event_time,
        event_time_raw: ev.event_time_raw,
        category: ev.category,
        stream_count: ev.stream_count ?? 0,
        streams: [],
        error: e.message,
      });
    }
    await sleep(300);
  }

  const streamsJson = {
    ...commonMeta,
    total: streamEvents.length,
    ok,
    failed,
    events: streamEvents,
    raw_data: "",
  };
  await fs.writeFile(STREAMS_FILE, JSON.stringify(streamsJson, null, 2) + "\n");
  console.log(`[done] cricsteras-streams.json → ${ok} ok / ${failed} failed`);
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
