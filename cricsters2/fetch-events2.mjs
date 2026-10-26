
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = "https://foott.vercel.app/api/op";
const AUTHOR = "Shiva Chaudhary";
const TIMEZONE = "Asia/Kolkata";

const EVENTS_FILE = path.join(__dirname, "cricsteras-events2.json");
const STREAMS_FILE = path.join(__dirname, "cricsteras-streams2.json");

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
  const res = await fetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
  });

  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }

  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  if (single.length >= 4) {
    return single.slice(0, 4).toUpperCase();
  }

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

/* Deterministic hash: same input gives the same output. */
function shortHash(str, len) {
  const hash = crypto.createHash("sha1").update(String(str || "")).digest();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  let out = "";

  for (let i = 0; i < len; i++) {
    out += alphabet[hash[i] % alphabet.length];
  }

  return out;
}

/* Global code uniqueness across all events. */
function buildCode(eventTitle, channelTitle, streamUrl, usedCodes) {
  let eventPart = eventSlug(eventTitle);
  let channelPart = channelSlug(channelTitle);

  const titleStr = String(channelTitle || "").trim();

  if (!titleStr || channelPart === "CHN") {
    channelPart = shortHash(streamUrl || titleStr || "stream", 3);
  }

  const base = alnum((eventPart + channelPart).toUpperCase());

  if (!usedCodes.has(base)) {
    usedCodes.add(base);
    return base;
  }

  const hashSuffix = shortHash((streamUrl || "") + "|" + base, 2);
  let candidate = base + hashSuffix;

  if (!usedCodes.has(candidate)) {
    usedCodes.add(candidate);
    return candidate;
  }

  for (let i = 2; i < 100; i++) {
    const fallback = base + hashSuffix + String(i);

    if (!usedCodes.has(fallback)) {
      usedCodes.add(fallback);
      return fallback;
    }
  }

  const last = base + shortHash(String(streamUrl) + "|" + usedCodes.size, 4);
  usedCodes.add(last);

  return last;
}

/*
 * NEW API FORMAT:
 * {
 *   success: true,
 *   generated_at: "...",
 *   total: 57,
 *   data: [
 *     {
 *       event_title, event_id, event_cat, event_name,
 *       event_time, channel_title, stream_url, keyid, key, api
 *     }
 *   ]
 * }
 *
 * Convert flat data[] into the old events[] + streams[] structure.
 */

function normalizeEvents(data) {
  const grouped = new Map();

  for (const item of data) {
    if (item?.event_id == null) continue;

    const id = String(item.event_id);

    if (!grouped.has(id)) {
      grouped.set(id, {
        event_id: item.event_id,

        // Full event name is useful for fixtures and match listings.
        event_title: item.event_name || item.event_title || "Unknown Event",

        // Keep original category and event timing fields.
        event_time: item.event_time || "",
        event_time_raw: item.event_time || "",
        category: item.event_cat || "",

        // Retain additional source metadata without changing player fields.
        source_event_title: item.event_title || "",
        streams: [],
      });
    }

    const event = grouped.get(id);

    const streamUrl = String(item.stream_url || "").trim();
    const channelTitle = String(item.channel_title || "").trim();

    // Ignore rows without a playable stream URL.
    if (!streamUrl) continue;

    // Build the legacy DRM shape from keyid/key.
    const keyId = String(item.keyid || "").trim().toLowerCase();
    const key = String(item.key || "").trim().toLowerCase();

    event.streams.push({
      title: channelTitle || "Stream",
      url: streamUrl,
      drm: keyId && key
        ? {
            kid: keyId,
            key,
          }
        : null,
    });
  }

  return [...grouped.values()];
}

async function main() {
  console.log(`[1/2] GET ${API_URL}`);

  const base = await fetchJson(API_URL);

  // NEW: the API returns data[], not events[].
  const rows = Array.isArray(base.data) ? base.data : [];

  if (base.success === false) {
    throw new Error("API returned success: false");
  }

  if (!Array.isArray(base.data)) {
    throw new Error(
      "Unexpected API response: expected an array at response.data"
    );
  }

  const now = new Date();

  const commonMeta = {
    success: base.success ?? true,
    author: AUTHOR,
    timezone: TIMEZONE,
    generated_at: formatIsoWithOffset(now),
    generated_at_india: formatIndiaDate(now),
  };

  // Convert the flat stream list into grouped events.
  const baseEvents = normalizeEvents(rows);

  const eventsJson = {
    ...commonMeta,
    total: baseEvents.length,
    events: baseEvents.map((ev) => ({
      event_id: ev.event_id,
      event_title: ev.event_title,
      event_time: ev.event_time,
      event_time_raw: ev.event_time_raw,
      category: ev.category,
      stream_count: ev.streams.length,
    })),
    raw_data: base.raw_data ?? "",
  };

  await fs.writeFile(
    EVENTS_FILE,
    JSON.stringify(eventsJson, null, 2) + "\n"
  );

  console.log(
    `[done] cricsteras-events2.json → ${eventsJson.total} events`
  );

  console.log(
    `[2/2] Preparing streams for ${baseEvents.length} events...`
  );

  const globalUsedCodes = new Set();
  const streamEvents = [];

  let ok = 0;
  let failed = 0;

  for (const ev of baseEvents) {
    try {
      const streams = ev.streams.map((s) => {
        const code = buildCode(
          ev.event_title,
          s.title,
          s.url,
          globalUsedCodes
        );

        return {
          code,
          title: s.title || "Stream",
          url: s.url,
          drm: s.drm,
        };
      });

      streamEvents.push({
        event_id: ev.event_id,
        event_title: ev.event_title,
        event_time: ev.event_time,
        event_time_raw: ev.event_time_raw,
        category: ev.category,
        stream_count: streams.length,
        streams,
      });

      ok++;

      console.log(
        `  ✓ ${ev.event_id} (${ev.category}) → ${streams.length} stream(s)`
      );
    } catch (error) {
      failed++;

      console.warn(`  ✗ ${ev.event_id}: ${error.message}`);

      streamEvents.push({
        event_id: ev.event_id,
        event_title: ev.event_title,
        event_time: ev.event_time,
        event_time_raw: ev.event_time_raw,
        category: ev.category,
        stream_count: 0,
        streams: [],
        error: error.message,
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

  await fs.writeFile(
    STREAMS_FILE,
    JSON.stringify(streamsJson, null, 2) + "\n"
  );

  console.log(
    `[done] cricsteras-streams2.json → ${ok} ok / ${failed} failed`
  );

  console.log(
    `[info] unique codes generated: ${globalUsedCodes.size}`
  );
}

main().catch((err) => {
  console.error("[error]", err);
  process.exitCode = 1;
});
