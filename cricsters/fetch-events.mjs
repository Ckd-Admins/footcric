import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
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

function alnum(s) {
  return String(s || "").replace(/[^A-Za-z0-9]/g, "");
}

function eventSlug(eventTitle) {
  const clean = String(eventTitle || "").split(" - ").pop() || "";

  const vsParts = clean.split(/\s+vs\.?\s+/i);
  if (vsParts.length === 2) {
    const leftWord = alnum(vsParts[0].split(/\s+/)[0] || "");
    const rightWord = alnum(vsParts[1].split(/\s+/)[0] || "");
    const L = (leftWord.slice(0, 2) || "XX").toUpperCase();
    const R = (rightWord.slice(0, 2) || "XX").toUpperCase();
    return L + R;
  }

  const single = alnum(clean);
  if (single.length >= 4) return single.slice(0, 4).toUpperCase();
  return (single.slice(0, 2) || "EV").toUpperCase().padEnd(4, "X");
}

function channelSlug(title) {
  const cleaned = String(title || "").replace(/[^A-Za-z0-9 ]/g, " ");
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return "CHN";

  const first = words[0].toUpperCase();

  if (first.length >= 5) return first.slice(0, 4);

  if (first.length <= 3 && words.length >= 2) {
    const second = words[1].toUpperCase();
    return first + second.slice(0, Math.max(1, 4 - first.length));
  }

  return first.slice(0, 4).padEnd(3, "X");
}

/* Deterministic 3-char hash (A-Z0-9) from any string.
   Same input always same output — stream delete hone se nahi badalta. */
function shortHash(str, len) {
  const h = crypto.createHash("sha1").update(String(str || "")).digest();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[h[i] % alphabet.length];
  }
  return out;
}

/* Global uniqueness: usedCodes poore JSON ke liye ek hi Set.
   Stream title missing / duplicated ho to URL se hash lagta hai. */
function buildCode(eventTitle, channelTitle, streamUrl, usedCodes) {
  let eventPart = eventSlug(eventTitle);
  let channelPart = channelSlug(channelTitle);

  // Missing / too-short title → deterministic hash fallback
  const titleStr = String(channelTitle || "").trim();
  if (!titleStr || channelPart === "CHN") {
    channelPart = shortHash(streamUrl || titleStr || "stream", 3);
  }

  let base = (eventPart + channelPart).toUpperCase();
  base = alnum(base);

  if (!usedCodes.has(base)) {
    usedCodes.add(base);
    return base;
  }

  // Collision: URL se deterministic 2-char hash lagao (order-independent)
  const hashSuffix = shortHash((streamUrl || "") + "|" + base, 2).slice(0, 2);
  let candidate = base + hashSuffix;

  if (!usedCodes.has(candidate)) {
    usedCodes.add(candidate);
    return candidate;
  }

  // Extremely rare: same URL + same base (duplicate stream)
  for (let i = 2; i < 100; i++) {
    const fallback = base + hashSuffix + String(i);
    if (!usedCodes.has(fallback)) {
      usedCodes.add(fallback);
      return fallback;
    }
  }

  const last = base + shortHash(Math.random().toString(), 4);
  usedCodes.add(last);
  return last;
}

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

  const eventsJson = {
    ...commonMeta,
    total: base.total ?? baseEvents.length,
    events: baseEvents,
    raw_data: base.raw_data ?? "",
  };
  await fs.writeFile(EVENTS_FILE, JSON.stringify(eventsJson, null, 2) + "\n");
  console.log(`[done] cricsteras-events.json → ${eventsJson.total} events`);

  console.log(`[2/2] Fetching streams for ${baseEvents.length} events...`);

  /* ⬇️ GLOBAL Set — poore JSON ke liye ek hi uniqueness space */
  const globalUsedCodes = new Set();

  const streamEvents = [];
  let ok = 0;
  let failed = 0;

  for (const ev of baseEvents) {
    try {
      const detail = await fetchJson(`${API_URL}?play=${ev.event_id}`);
      const evDetail = detail.events?.[0] ?? {};
      const rawStreams = Array.isArray(evDetail.streams) ? evDetail.streams : [];

      const streams = rawStreams.map((s) => {
        const title = s?.title ?? "";
        const url = s?.url ?? "";
        const code = buildCode(ev.event_title, title, url, globalUsedCodes);

        return {
          code,
          title: title || "Stream",
          url,
          drm: s?.drm
            ? {
                kid: String(s.drm.kid || "").toLowerCase(),
                key: String(s.drm.key || "").toLowerCase(),
              }
            : null,
        };
      });

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
      console.log(`  ✓ ${ev.event_id} (${ev.category}) → ${streams.length} stream(s)`);
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
  console.log(`[info] unique codes generated: ${globalUsedCodes.size}`);
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
