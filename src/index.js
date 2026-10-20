// SPDX-License-Identifier: MIT
// Based on "crosspoint-calendar" by ckorhonen (https://github.com/ckorhonen/crosspoint-calendar,
// MIT according to its README). Modified and extended by RockyBalboa360, 2026.
// Origin, data sources and third-party notices: see NOTICE.md
// ============================================================================
//  XTEINK X4 – Tagesansicht (Wetter für zwei Orte + Google Kalender + Todoist)
//  Cloudflare Worker, liefert ein 480x800 BMP-Bild für den Ruhebildschirm.
//
//  EINRICHTUNG: Trage unten bei "CONFIG" deine Zugangsdaten ein
//  (oder lege sie in Cloudflare unter Settings > Variables and Secrets an,
//   mit denselben Namen – diese haben dann Vorrang).
// ============================================================================

// ---------- 1) HIER DEINE ZUGANGSDATEN EINTRAGEN ----------------------------
const CONFIG = {
  // --- Google Kalender über ein DIENSTKONTO (für private Kalender) ---
  // Beides steht in der JSON-Schlüsseldatei des Dienstkontos:
  //   "client_email"  -> hier bei EMAIL eintragen
  //   "private_key"   -> hier bei PRIVATE_KEY eintragen (inkl. -----BEGIN ... END PRIVATE KEY-----)
  //                      Mit Zeilenumbrüchen: in Backticks `...` statt Anführungszeichen setzen.
  //                      Aus der JSON-Datei direkt kopiert (mit \n) geht auch "..."
  // Der Kalender muss in Google Kalender für diese E-Mail-Adresse freigegeben sein!
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "",
  GOOGLE_PRIVATE_KEY: "",
  // Alternativ den gesamten Inhalt der JSON-Datei (am besten als Secret in Cloudflare):
  GOOGLE_SERVICE_ACCOUNT_JSON: "",

  // Nur nötig, wenn du KEIN Dienstkonto nutzt (funktioniert nur mit öffentlichem Kalender)
  GOOGLE_CALENDAR_API_KEY: "",

  // Google Kalender > Einstellungen > Kalender integrieren > Kalender-ID
  // Beim Hauptkalender ist das deine Gmail-Adresse.
  // Mehrere Kalender: mit Komma trennen, z.B. "a@gmail.com,b@group.calendar.google.com"
  GOOGLE_CALENDAR_ID: "",

  // Todoist > Einstellungen > Integrationen > Entwickler > API-Token
  TODOIST_API_TOKEN: "",

  // Todoist-Filter für die Aufgabenliste. "today | overdue" = heute fällig + überfällig.
  // Nur heute: "today"
  TODOIST_FILTER: "today | overdue",

  // Optional: Ersatz-Wetterdienst, falls Open-Meteo ausfällt (kann leer bleiben)
  VISUAL_CROSSING_API_KEY: "",
};

// ---------- 2) STANDORT / ZEITZONE -------------------------------------------
// HOME wird links, SECOND rechts angezeigt (Name in Großbuchstaben, höchstens 9 Zeichen)
const HOME = { key: "berlin", name: "BERLIN", lat: 52.52, lon: 13.405 };
const SECOND = { key: "frankfurt", name: "FRANKFURT", lat: 50.1109, lon: 8.6821 };
const TIMEZONE = "Europe/Berlin";

// Maximal so viele Todoist-Aufgaben anzeigen (weitere erscheinen als "+N weitere")
const MAX_TASKS = 5;

// ============================================================================
//  Ab hier muss nichts mehr geändert werden
// ============================================================================

function setting(env, key) {
  let fromEnv = env && env[key];
  if (!fromEnv && env) {
    // Groß-/Kleinschreibung und Leerzeichen im Variablennamen verzeihen
    const name = Object.keys(env).find((n) => n.trim().toUpperCase() === key);
    if (name) fromEnv = env[name];
  }
  let value = fromEnv !== undefined && fromEnv !== null && fromEnv !== "" ? fromEnv : CONFIG[key];
  if (value && typeof value === "object") value = JSON.stringify(value); // Cloudflare-Variable vom Typ "JSON"
  return String(value || "").trim();
}

// Aufruf mit ?debug an die Worker-URL: zeigt, welche Einstellungen ankommen (ohne die Werte selbst)
function debugReport(env) {
  const lines = ["Einstellungen (nur Status, keine Werte):"];
  for (const key of Object.keys(CONFIG)) {
    const v = setting(env, key);
    lines.push(`${key}: ${v ? `gesetzt (${v.length} Zeichen)` : "LEER"}`);
  }
  lines.push("", "Namen der Cloudflare-Variablen:", Object.keys(env || {}).join(", ") || "(keine)");
  return lines.join("\n");
}

// ---------- Zeit-Helfer (immer Zeitzone Europe/Berlin) ------------------------
const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DAY_NAMES = ["SONNTAG", "MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG"];
const MONTH_SHORT = ["JAN", "FEB", "M\u00C4R", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function zonedParts(date) {
  const p = {};
  for (const { type, value } of PARTS_FORMAT.formatToParts(date)) {
    if (type !== "literal") p[type] = parseInt(value, 10);
  }
  p.hour = p.hour % 24;
  return p;
}

function tzOffsetMs(date) {
  const p = zonedParts(date);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(date.getTime() / 1000) * 1000
  );
}

// Beginn des Tages (00:00 Uhr in der Zeitzone TIMEZONE) als echter Zeitpunkt
function startOfDay(now, addDays = 0) {
  const p = zonedParts(now);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day + addDays);
  const approx = new Date(localMidnightAsUtc - tzOffsetMs(now));
  return new Date(localMidnightAsUtc - tzOffsetMs(approx));
}

function isoDay(p) {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// ---------- Wetter (Open-Meteo, Fallback Visual Crossing) --------------------
const WMO_CODES = {
  0: "Klar",
  1: "Heiter",
  2: "Teils bew\u00F6lkt",
  3: "Bedeckt",
  45: "Nebel",
  48: "Reifnebel",
  51: "Leichter Niesel",
  53: "Niesel-regen",
  55: "Starker Niesel",
  56: "Gefr. Niesel",
  57: "Gefr. Niesel",
  61: "Leichter Regen",
  63: "Regen",
  65: "Starkregen",
  66: "Gefr. Regen",
  67: "Gefr. Starkregen",
  71: "Leichter Schnee",
  73: "Schneefall",
  75: "Starker Schneefall",
  77: "Griesel",
  80: "Leichte Schauer",
  81: "Schauer",
  82: "Starke Schauer",
  85: "Schnee-schauer",
  86: "Schnee-schauer",
  95: "Gewitter",
  96: "Gewitter mit Hagel",
  99: "Schweres Gewitter",
};

const weatherCacheKey = (loc) => `https://crosspoint-calendar.internal/weather-cache-${loc.key}-v4`;
const WEATHER_CACHE_TTL = 15 * 60;
const WEATHER_ERROR_CACHE_TTL = 5 * 60;

const VC_TO_WMO = {
  "clear-day": 0,
  "clear-night": 0,
  "partly-cloudy-day": 2,
  "partly-cloudy-night": 2,
  "cloudy": 3,
  "fog": 45,
  "wind": 3,
  "rain": 63,
  "showers-day": 80,
  "showers-night": 80,
  "snow": 73,
  "snow-showers-day": 85,
  "snow-showers-night": 85,
  "thunder-rain": 95,
  "thunder-showers-day": 95,
  "thunder-showers-night": 95,
  "hail": 96,
};

async function fetchWeatherFromOpenMeteo(loc) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=${encodeURIComponent(TIMEZONE)}&forecast_days=1`;
  const response = await fetch(url, {
    headers: { "User-Agent": "CrossPointCalendar/1.0 (e-ink display)" },
  });
  if (!response.ok) throw new Error(`Open-Meteo error: ${response.status}`);
  const data = await response.json();
  const code = data.current.weather_code;
  return {
    temperature: Math.round(data.current.temperature_2m),
    temperatureHigh: Math.round(data.daily.temperature_2m_max[0]),
    temperatureLow: Math.round(data.daily.temperature_2m_min[0]),
    condition: WMO_CODES[code] || "Unbekannt",
    conditionCode: code,
    source: "Open-Meteo",
  };
}

async function fetchWeatherFromVisualCrossing(apiKey, loc) {
  const url =
    `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${loc.lat},${loc.lon}/today` +
    `?unitGroup=metric&include=current,days&key=${encodeURIComponent(apiKey)}&contentType=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Visual Crossing error: ${response.status}`);
  const data = await response.json();
  const code = VC_TO_WMO[data.currentConditions.icon || ""] ?? 3;
  return {
    temperature: Math.round(data.currentConditions.temp),
    temperatureHigh: Math.round(data.days[0].tempmax),
    temperatureLow: Math.round(data.days[0].tempmin),
    condition: WMO_CODES[code] || "Unbekannt",
    conditionCode: code,
    source: "Visual Crossing",
  };
}

// Bright Sky (brightsky.dev): offene Schnittstelle zu den Daten des Deutschen Wetterdienstes.
// Aktuelle Temperatur = Messwert der nächstgelegenen DWD-Station, Hoch/Tief aus dem Tagesverlauf.
const BRIGHTSKY_ICONS = {
  "clear-day": { code: 0, text: "Klar" },
  "clear-night": { code: 0, text: "Klar" },
  "partly-cloudy-day": { code: 2, text: "Teils bew\u00F6lkt" },
  "partly-cloudy-night": { code: 2, text: "Teils bew\u00F6lkt" },
  "cloudy": { code: 3, text: "Bedeckt" },
  "fog": { code: 45, text: "Nebel" },
  "wind": { code: 3, text: "Windig" },
  "rain": { code: 63, text: "Regen" },
  "sleet": { code: 67, text: "Schnee-regen" },
  "snow": { code: 73, text: "Schneefall" },
  "hail": { code: 82, text: "Hagel" },
  "thunderstorm": { code: 95, text: "Gewitter" },
};

function brightSkyCondition(w) {
  let key = w.icon;
  if (!BRIGHTSKY_ICONS[key]) {
    // Kein Symbol geliefert: aus Bedingung bzw. Bewölkung ableiten
    if (w.condition === "rain") key = "rain";
    else if (w.condition === "snow") key = "snow";
    else if (w.condition === "sleet") key = "sleet";
    else if (w.condition === "fog") key = "fog";
    else if (w.condition === "thunderstorm") key = "thunderstorm";
    else if (typeof w.cloud_cover === "number") {
      key = w.cloud_cover < 15 ? "clear-day" : w.cloud_cover < 60 ? "partly-cloudy-day" : "cloudy";
    } else key = "cloudy";
  }
  return BRIGHTSKY_ICONS[key];
}

async function fetchWeatherFromBrightSky(loc) {
  const now = new Date();
  const today = isoDay(zonedParts(now));
  const tomorrow = isoDay(zonedParts(startOfDay(now, 1)));
  const base = `lat=${loc.lat}&lon=${loc.lon}&tz=${encodeURIComponent(TIMEZONE)}&units=dwd`;

  const [currentRes, dayRes] = await Promise.all([
    fetch(`https://api.brightsky.dev/current_weather?${base}`),
    fetch(`https://api.brightsky.dev/weather?${base}&date=${today}&last_date=${tomorrow}`).catch(() => null),
  ]);
  if (!currentRes.ok) throw new Error(`Bright Sky error: ${currentRes.status}`);
  const current = (await currentRes.json()).weather;
  if (!current || typeof current.temperature !== "number") throw new Error("Bright Sky: keine Temperatur");

  // Hoch/Tief des heutigen Tages (Zeitzone TIMEZONE)
  let high = null;
  let low = null;
  try {
    if (dayRes && dayRes.ok) {
      const temps = ((await dayRes.json()).weather || [])
        .filter((r) => typeof r.temperature === "number" && isoDay(zonedParts(new Date(r.timestamp))) === today)
        .map((r) => r.temperature);
      if (temps.length > 0) {
        high = Math.round(Math.max(...temps, current.temperature));
        low = Math.round(Math.min(...temps, current.temperature));
      }
    }
  } catch (e) {
    console.error("Bright Sky Tagesverlauf fehlgeschlagen:", e);
  }

  const cond = brightSkyCondition(current);
  return {
    temperature: Math.round(current.temperature),
    temperatureHigh: high,
    temperatureLow: low,
    condition: cond.text,
    conditionCode: cond.code,
    source: "DWD / Bright Sky",
  };
}

async function fetchWeather(env, loc) {
  let cache = null;
  try {
    cache = caches.default;
    const cached = await cache.match(weatherCacheKey(loc));
    if (cached) return await cached.json();
  } catch (e) {
    cache = null;
  }

  let weatherData = null;
  try {
    weatherData = await fetchWeatherFromBrightSky(loc);
  } catch (brightSkyError) {
    console.error(`Bright Sky failed (${loc.name}):`, brightSkyError);
  }
  if (!weatherData) try {
    weatherData = await fetchWeatherFromOpenMeteo(loc);
  } catch (error) {
    console.error(`Open-Meteo failed (${loc.name}):`, error);
    const vcKey = setting(env, "VISUAL_CROSSING_API_KEY");
    if (vcKey) {
      try {
        weatherData = await fetchWeatherFromVisualCrossing(vcKey, loc);
      } catch (vcError) {
        console.error("Visual Crossing also failed:", vcError);
      }
    }
  }

  const result = weatherData || {
    temperature: 0,
    temperatureHigh: 0,
    temperatureLow: 0,
    condition: "Nicht verf\u00FCgbar",
    conditionCode: -1,
    source: "",
  };

  if (cache) {
    try {
      await cache.put(
        weatherCacheKey(loc),
        new Response(JSON.stringify(result), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${weatherData ? WEATHER_CACHE_TTL : WEATHER_ERROR_CACHE_TTL}`,
          },
        })
      );
    } catch (e) {
      // Cache ist optional (auf workers.dev-Adressen ohne Wirkung)
    }
  }
  return result;
}

// ---------- Text-Aufbereitung für den Bitmap-Font -----------------------------
const CHAR_MAP = {
  "\u2018": "'", "\u2019": "'", "\u201A": ",", "\u201C": "'", "\u201D": "'", "\u201E": "'",
  '"': "'", "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2026": "...", "\u00A0": " ",
  "_": "-", ";": ",", "[": "(", "]": ")", "{": "(", "}": ")", "\u20AC": "EUR",
};

// Wandelt beliebigen Text in Zeichen um, die der Font darstellen kann
// (Umlaute bleiben erhalten, Akzente werden entfernt, Emojis verschwinden).
function sanitize(str) {
  let out = "";
  for (const ch of String(str).normalize("NFC")) {
    if (FONT_DATA[ch]) {
      out += ch;
    } else if (CHAR_MAP[ch] !== undefined) {
      out += CHAR_MAP[ch];
    } else {
      const base = ch.normalize("NFD")[0];
      if (base !== ch && FONT_DATA[base]) out += base;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

// ---------- Google Kalender (nur heute) --------------------------------------
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getServiceAccount(env) {
  const json = setting(env, "GOOGLE_SERVICE_ACCOUNT_JSON");
  if (json) {
    try {
      const o = JSON.parse(json);
      return { email: o.client_email || "", key: o.private_key || "" };
    } catch (e) {
      console.error("GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON:", e);
    }
  }
  return {
    email: setting(env, "GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: setting(env, "GOOGLE_PRIVATE_KEY"),
  };
}

// Meldet das Dienstkonto bei Google an (signiertes JWT) und liefert ein Zugriffstoken
async function getGoogleAccessToken(email, privateKey) {
  const b64 = privateKey
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + 3600,
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)
  );
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  if (!response.ok) {
    console.error(`Google token ${response.status}:`, await response.text());
    throw new Error(`Google-Login fehlgeschlagen (${response.status})`);
  }
  return (await response.json()).access_token;
}

const CALENDAR_ERROR_HINTS = {
  404: "Kalender 404: Freigabe?",
  403: "Kalender 403: API/Rechte?",
  401: "Kalender 401: Login?",
};

async function fetchOneCalendar(calendarId, auth, dayStart, dayEnd) {
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?timeMin=${encodeURIComponent(dayStart.toISOString())}` +
    `&timeMax=${encodeURIComponent(dayEnd.toISOString())}` +
    `&timeZone=${encodeURIComponent(TIMEZONE)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=50` +
    (auth.token ? "" : `&key=${encodeURIComponent(auth.apiKey)}`);
  const response = await fetch(url, auth.token ? { headers: { Authorization: `Bearer ${auth.token}` } } : undefined);
  if (!response.ok) {
    console.error(`Calendar API ${response.status} for ${calendarId}:`, await response.text());
    throw new Error(CALENDAR_ERROR_HINTS[response.status] || `Kalender-Fehler ${response.status}`);
  }
  const data = await response.json();
  const events = [];
  for (const item of data.items || []) {
    if (item.status === "cancelled") continue;
    const title = sanitize(item.summary || "") || "(Ohne Titel)";
    const startIso = item.start && item.start.dateTime;
    const start = startIso ? new Date(startIso) : null;
    if (start && start >= dayStart) {
      events.push({ title, time: TIME_FORMAT.format(start), sort: start.getTime() });
    } else {
      // ganztägig oder schon vor heute gestartet
      events.push({ title, time: "Ganztag", sort: -1 });
    }
  }
  return events;
}

async function fetchCalendarEvents(env, now) {
  const apiKey = setting(env, "GOOGLE_CALENDAR_API_KEY");
  const sa = getServiceAccount(env);
  const ids = setting(env, "GOOGLE_CALENDAR_ID").split(",").map((s) => s.trim()).filter(Boolean);
  const useServiceAccount = Boolean(sa.email && sa.key);
  if (ids.length === 0) {
    return { events: [], error: "Kalender-ID fehlt" };
  }
  if (!useServiceAccount && !apiKey) {
    if (sa.email && !sa.key) return { events: [], error: "Privater Schlüssel fehlt" };
    if (sa.key && !sa.email) return { events: [], error: "Dienstkonto-E-Mail fehlt" };
    return { events: [], error: "Dienstkonto nicht eingetragen" };
  }

  let auth = { apiKey };
  if (useServiceAccount) {
    try {
      auth = { token: await getGoogleAccessToken(sa.email, sa.key) };
    } catch (error) {
      console.error("Google-Anmeldung fehlgeschlagen:", error);
      return { events: [], error: sanitize(error.message || "Google-Login fehlgeschlagen") };
    }
  }

  const dayStart = startOfDay(now);
  const dayEnd = startOfDay(now, 1);
  const results = await Promise.allSettled(ids.map((id) => fetchOneCalendar(id, auth, dayStart, dayEnd)));
  const ok = results.filter((r) => r.status === "fulfilled");
  if (ok.length === 0) {
    const reason = results[0].reason;
    return { events: [], error: sanitize(reason && reason.message ? reason.message : "Kalender-Fehler") };
  }
  // Termine, die in mehreren Kalendern stehen, nur einmal anzeigen
  const seen = new Set();
  const events = ok
    .flatMap((r) => r.value)
    .filter((ev) => {
      const key = `${ev.time}|${ev.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.sort - b.sort);
  return { events, error: null };
}

// ---------- Todoist ---------------------------------------------------------
function parseDue(due) {
  const raw = due.datetime || due.date || "";
  if (raw.length <= 10) return { day: raw, time: null };
  if (/(Z|[+-]\d\d:\d\d)$/i.test(raw)) {
    const p = zonedParts(new Date(raw));
    return { day: isoDay(p), time: `${pad2(p.hour)}:${pad2(p.minute)}` };
  }
  return { day: raw.slice(0, 10), time: raw.slice(11, 16) };
}

async function fetchTodoistTasks(env, now) {
  const token = setting(env, "TODOIST_API_TOKEN");
  if (!token) return { tasks: [], error: "Todoist nicht eingerichtet" };
  const filter = setting(env, "TODOIST_FILTER") || "today | overdue";
  try {
    const url = `https://api.todoist.com/api/v1/tasks/filter?query=${encodeURIComponent(filter)}&limit=100`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      console.error(`Todoist API ${response.status}:`, await response.text());
      return { tasks: [], error: `Todoist-Fehler ${response.status}` };
    }
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.results || [];
    const today = isoDay(zonedParts(now));

    const tasks = list
      .filter((t) => !t.checked && !t.is_completed)
      .map((t) => {
        const due = t.due ? parseDue(t.due) : { day: today, time: null };
        const overdue = due.day < today;
        let when = null;
        if (overdue) when = `${due.day.slice(8, 10)}.${due.day.slice(5, 7)}.`;
        else if (due.time) when = due.time;
        const title =
          sanitize(String(t.content || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "")) ||
          "(Ohne Titel)";
        return {
          title,
          when,
          priority: t.priority || 1, // Todoist-API: 4 = Prio 1 (dringend)
          group: overdue ? 0 : due.time ? 1 : 2,
          day: due.day,
          time: due.time || "",
        };
      })
      .sort((a, b) => {
        if (a.group !== b.group) return a.group - b.group;
        if (a.group === 0 && a.day !== b.day) return a.day < b.day ? -1 : 1;
        if (a.group === 1 && a.time !== b.time) return a.time < b.time ? -1 : 1;
        return b.priority - a.priority;
      });
    return { tasks, error: null };
  } catch (error) {
    console.error("Todoist fetch error:", error);
    return { tasks: [], error: "Todoist nicht erreichbar" };
  }
}

// ---------- BMP-Erzeugung (8 Bit Graustufen, top-down) ------------------------
function createBMP(width, height, pixelData) {
  const paddedRowSize = Math.ceil(width / 4) * 4;
  const pixelDataSize = paddedRowSize * height;
  const paletteSize = 256 * 4;
  const headerSize = 14;
  const dibHeaderSize = 40;
  const fileSize = headerSize + dibHeaderSize + paletteSize + pixelDataSize;
  const buffer = new Uint8Array(fileSize);
  const view = new DataView(buffer.buffer);

  buffer[0] = 66; // 'B'
  buffer[1] = 77; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, headerSize + dibHeaderSize + paletteSize, true);

  view.setUint32(14, dibHeaderSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // negativ = von oben nach unten
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelDataSize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, 256, true);
  view.setUint32(50, 256, true);

  const paletteOffset = headerSize + dibHeaderSize;
  for (let i = 0; i < 256; i++) {
    buffer[paletteOffset + i * 4 + 0] = i;
    buffer[paletteOffset + i * 4 + 1] = i;
    buffer[paletteOffset + i * 4 + 2] = i;
    buffer[paletteOffset + i * 4 + 3] = 0;
  }

  const pixelOffset = headerSize + dibHeaderSize + paletteSize;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buffer[pixelOffset + y * paddedRowSize + x] = pixelData[y * width + x];
    }
  }
  return buffer;
}

// ---------- Zeichnen ----------------------------------------------------------
const INK_BLACK = 0;
const DARK_GRAY = 64;
const LIGHT_GRAY = 176;
const PAPER_WHITE = 255;

// 8x8-Bitmap-Font (jede Zahl = eine Pixelzeile, Bit 7 = ganz links)
const FONT_DATA = {
  "0": [60, 102, 110, 118, 102, 102, 60, 0],
  "1": [24, 56, 24, 24, 24, 24, 126, 0],
  "2": [60, 102, 6, 28, 48, 96, 126, 0],
  "3": [60, 102, 6, 28, 6, 102, 60, 0],
  "4": [12, 28, 60, 108, 126, 12, 12, 0],
  "5": [126, 96, 124, 6, 6, 102, 60, 0],
  "6": [28, 48, 96, 124, 102, 102, 60, 0],
  "7": [126, 6, 12, 24, 48, 48, 48, 0],
  "8": [60, 102, 102, 60, 102, 102, 60, 0],
  "9": [60, 102, 102, 62, 6, 12, 56, 0],
  "A": [24, 60, 102, 102, 126, 102, 102, 0],
  "B": [124, 102, 102, 124, 102, 102, 124, 0],
  "C": [60, 102, 96, 96, 96, 102, 60, 0],
  "D": [120, 108, 102, 102, 102, 108, 120, 0],
  "E": [126, 96, 96, 124, 96, 96, 126, 0],
  "F": [126, 96, 96, 124, 96, 96, 96, 0],
  "G": [60, 102, 96, 110, 102, 102, 60, 0],
  "H": [102, 102, 102, 126, 102, 102, 102, 0],
  "I": [60, 24, 24, 24, 24, 24, 60, 0],
  "J": [6, 6, 6, 6, 6, 102, 60, 0],
  "K": [102, 108, 120, 112, 120, 108, 102, 0],
  "L": [96, 96, 96, 96, 96, 96, 126, 0],
  "M": [99, 119, 127, 107, 99, 99, 99, 0],
  "N": [102, 118, 126, 126, 110, 102, 102, 0],
  "O": [60, 102, 102, 102, 102, 102, 60, 0],
  "P": [124, 102, 102, 124, 96, 96, 96, 0],
  "Q": [60, 102, 102, 102, 106, 108, 54, 0],
  "R": [124, 102, 102, 124, 108, 102, 102, 0],
  "S": [60, 102, 96, 60, 6, 102, 60, 0],
  "T": [126, 24, 24, 24, 24, 24, 24, 0],
  "U": [102, 102, 102, 102, 102, 102, 60, 0],
  "V": [102, 102, 102, 102, 102, 60, 24, 0],
  "W": [99, 99, 99, 107, 127, 119, 99, 0],
  "X": [102, 102, 60, 24, 60, 102, 102, 0],
  "Y": [102, 102, 102, 60, 24, 24, 24, 0],
  "Z": [126, 6, 12, 24, 48, 96, 126, 0],
  "a": [0, 0, 60, 6, 62, 102, 62, 0],
  "b": [96, 96, 124, 102, 102, 102, 124, 0],
  "c": [0, 0, 60, 102, 96, 102, 60, 0],
  "d": [6, 6, 62, 102, 102, 102, 62, 0],
  "e": [0, 0, 60, 102, 126, 96, 60, 0],
  "f": [28, 54, 48, 124, 48, 48, 48, 0],
  "g": [0, 0, 62, 102, 102, 62, 6, 60],
  "h": [96, 96, 124, 102, 102, 102, 102, 0],
  "i": [24, 0, 56, 24, 24, 24, 60, 0],
  "j": [12, 0, 28, 12, 12, 12, 108, 56],
  "k": [96, 96, 102, 108, 120, 108, 102, 0],
  "l": [56, 24, 24, 24, 24, 24, 60, 0],
  "m": [0, 0, 118, 127, 107, 107, 99, 0],
  "n": [0, 0, 124, 102, 102, 102, 102, 0],
  "o": [0, 0, 60, 102, 102, 102, 60, 0],
  "p": [0, 0, 124, 102, 102, 124, 96, 96],
  "q": [0, 0, 62, 102, 102, 62, 6, 6],
  "r": [0, 0, 110, 118, 96, 96, 96, 0],
  "s": [0, 0, 62, 96, 60, 6, 124, 0],
  "t": [48, 48, 124, 48, 48, 54, 28, 0],
  "u": [0, 0, 102, 102, 102, 102, 62, 0],
  "v": [0, 0, 102, 102, 102, 60, 24, 0],
  "w": [0, 0, 99, 107, 107, 127, 54, 0],
  "x": [0, 0, 102, 60, 24, 60, 102, 0],
  "y": [0, 0, 102, 102, 102, 62, 6, 60],
  "z": [0, 0, 126, 12, 24, 48, 126, 0],
  // Umlaute und Eszett
  "\u00E4": [102, 0, 60, 6, 62, 102, 62, 0],
  "\u00F6": [102, 0, 60, 102, 102, 102, 60, 0],
  "\u00FC": [102, 0, 102, 102, 102, 102, 62, 0],
  "\u00C4": [102, 0, 24, 60, 102, 126, 102, 102],
  "\u00D6": [102, 0, 60, 102, 102, 102, 102, 60],
  "\u00DC": [102, 0, 102, 102, 102, 102, 102, 60],
  "\u00DF": [60, 102, 102, 124, 102, 102, 124, 96],
  // Satzzeichen
  " ": [0, 0, 0, 0, 0, 0, 0, 0],
  ":": [0, 24, 24, 0, 24, 24, 0, 0],
  ".": [0, 0, 0, 0, 0, 24, 24, 0],
  ",": [0, 0, 0, 0, 0, 24, 24, 48],
  "-": [0, 0, 0, 126, 0, 0, 0, 0],
  "/": [6, 12, 24, 48, 96, 64, 0, 0],
  "\u00B0": [28, 54, 54, 28, 0, 0, 0, 0],
  "'": [24, 24, 48, 0, 0, 0, 0, 0],
  "(": [12, 24, 48, 48, 48, 24, 12, 0],
  ")": [48, 24, 12, 12, 12, 24, 48, 0],
  "+": [0, 24, 24, 126, 24, 24, 0, 0],
  "!": [24, 24, 24, 24, 24, 0, 24, 0],
  "?": [60, 102, 6, 12, 24, 0, 24, 0],
  "%": [98, 102, 12, 24, 48, 102, 70, 0],
  "&": [56, 108, 56, 118, 222, 204, 118, 0],
  "\u2191": [24, 60, 126, 24, 24, 24, 24, 0],
  "\u2193": [24, 24, 24, 24, 126, 60, 24, 0],
};

// Zeichnet ein Zeichen; scale darf Bruchteile haben (z.B. 2.5 = 20 Pixel pro Zeichen)
function drawChar(pixels, width, x, y, char, color, scale) {
  const data = FONT_DATA[char];
  if (!data) return;
  const size = Math.round(8 * scale);
  for (let ty = 0; ty < size; ty++) {
    const rowData = data[Math.min(7, Math.floor(ty / scale))];
    if (!rowData) continue;
    const py = y + ty;
    if (py < 0) continue;
    for (let tx = 0; tx < size; tx++) {
      if (rowData & (128 >> Math.min(7, Math.floor(tx / scale)))) {
        const px = x + tx;
        if (px >= 0 && px < width) pixels[py * width + px] = color;
      }
    }
  }
}

// bold = jede Zeile doppelt mit 1 Pixel Versatz (kräftigere Striche)
function drawText(pixels, width, x, y, text, color, scale = 1, bold = false) {
  const advance = 8 * scale;
  let cx = x;
  for (const char of text) {
    drawChar(pixels, width, Math.round(cx), y, char, color, scale);
    if (bold) drawChar(pixels, width, Math.round(cx) + 1, y, char, color, scale);
    cx += advance;
  }
}

function getTextWidth(text, scale = 1) {
  return [...text].length * 8 * scale;
}

function drawCenteredText(pixels, width, y, text, color, scale = 1, bold = false) {
  drawText(pixels, width, Math.floor((width - getTextWidth(text, scale)) / 2), y, text, color, scale, bold);
}

function drawRightAlignedText(pixels, width, y, text, color, scale, margin) {
  drawText(pixels, width, Math.round(width - margin - getTextWidth(text, scale)), y, text, color, scale);
}

// Kürzt Text mit "...", damit er in die Breite passt
function fitText(text, maxWidth, scale) {
  const chars = [...text];
  const maxChars = Math.floor(maxWidth / (8 * scale));
  if (chars.length <= maxChars) return text;
  return chars.slice(0, Math.max(maxChars - 3, 0)).join("").trimEnd() + "...";
}

function fillRect(pixels, width, height, x, y, w, h, color) {
  for (let py = Math.max(Math.round(y), 0); py < y + h && py < height; py++) {
    for (let px = Math.max(Math.round(x), 0); px < x + w && px < width; px++) {
      pixels[py * width + px] = color;
    }
  }
}

function drawHLine(pixels, width, y, x1, x2, color, thickness = 1) {
  fillRect(pixels, width, 9999, x1, y, x2 - x1, thickness, color);
}

function drawBox(pixels, width, x, y, size, color) {
  fillRect(pixels, width, 9999, x, y, size, 2, color);
  fillRect(pixels, width, 9999, x, y + size - 2, size, 2, color);
  fillRect(pixels, width, 9999, x, y, 2, size, color);
  fillRect(pixels, width, 9999, x + size - 2, y, 2, size, color);
}

// ---------- Wettersymbole (kräftige Linien, 56x56 Pixel) -----------------------
const ICON_SIZE = 56;

function setPixel(pixels, width, px, py, color) {
  if (px < 0 || px >= width || py < 0) return;
  const i = py * width + px;
  if (i < pixels.length) pixels[i] = color;
}

function fillCircle(pixels, width, cx, cy, r, color) {
  const r2 = r * r;
  for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py++) {
    for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px++) {
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r2) setPixel(pixels, width, px, py, color);
    }
  }
}

function drawThickLine(pixels, width, x1, y1, x2, y2, thickness, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  for (let i = 0; i <= steps; i++) {
    const px = x1 + ((x2 - x1) * i) / steps;
    const py = y1 + ((y2 - y1) * i) / steps;
    fillCircle(pixels, width, px, py, thickness / 2, color);
  }
}

// Ausgefüllte Wolke; oy verschiebt sie nach unten, grow vergrößert sie (für einen weißen Rand)
function drawCloud(pixels, width, x, y, oy, grow, color) {
  fillCircle(pixels, width, x + 15, y + oy + 26, 10 + grow, color);
  fillCircle(pixels, width, x + 28, y + oy + 19, 13 + grow, color);
  fillCircle(pixels, width, x + 42, y + oy + 26, 10 + grow, color);
  fillRect(pixels, width, pixels.length / width, x + 15, y + oy + 26 - grow, 27, 10 + 2 * grow, color);
}

function drawSun(pixels, width, cx, cy, r, rayLen, rayThickness) {
  fillCircle(pixels, width, cx, cy, r, INK_BLACK);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const from = r + 5;
    const to = r + 5 + rayLen;
    drawThickLine(
      pixels, width,
      cx + from * Math.cos(a), cy + from * Math.sin(a),
      cx + to * Math.cos(a), cy + to * Math.sin(a),
      rayThickness, INK_BLACK
    );
  }
}

function drawWeatherIcon(pixels, width, x, y, code) {
  if (code === 0 || code === 1) {
    drawSun(pixels, width, x + 28, y + 28, 11, 7, 4);
  } else if (code === 2) {
    drawSun(pixels, width, x + 19, y + 19, 8, 5, 3);
    drawCloud(pixels, width, x, y, 14, 3, PAPER_WHITE);
    drawCloud(pixels, width, x, y, 14, 0, INK_BLACK);
  } else if (code === 3) {
    drawCloud(pixels, width, x, y, 10, 0, INK_BLACK);
  } else if (code >= 45 && code <= 48) {
    for (let i = 0; i < 4; i++) {
      const x0 = x + (i % 2 ? 4 : 10);
      const len = i % 2 ? 46 : 38;
      drawThickLine(pixels, width, x0, y + 10 + i * 12, x0 + len, y + 10 + i * 12, 5, INK_BLACK);
    }
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    drawCloud(pixels, width, x, y, 0, 0, INK_BLACK);
    for (let i = 0; i < 3; i++) {
      const x0 = x + 17 + i * 12;
      drawThickLine(pixels, width, x0 + 3, y + 41, x0 - 2, y + 52, 4, INK_BLACK);
    }
  } else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    drawCloud(pixels, width, x, y, 0, 0, INK_BLACK);
    for (let i = 0; i < 3; i++) {
      fillCircle(pixels, width, x + 16 + i * 12, y + (i % 2 ? 50 : 44), 3.5, INK_BLACK);
    }
  } else if (code >= 95) {
    drawCloud(pixels, width, x, y, 0, 0, INK_BLACK);
    drawThickLine(pixels, width, x + 33, y + 36, x + 24, y + 46, 4, INK_BLACK);
    drawThickLine(pixels, width, x + 24, y + 46, x + 34, y + 46, 4, INK_BLACK);
    drawThickLine(pixels, width, x + 34, y + 46, x + 25, y + 56, 4, INK_BLACK);
  } else if (code === -1) {
    drawThickLine(pixels, width, x + 14, y + 14, x + 42, y + 42, 5, INK_BLACK);
    drawThickLine(pixels, width, x + 42, y + 14, x + 14, y + 42, 5, INK_BLACK);
  } else {
    drawText(pixels, width, x + 8, y + 8, "?", INK_BLACK, 5, true);
  }
}

// ---------- Layout ------------------------------------------------------------
const MARGIN = 24;
const BODY = 2.5; // Schriftgröße für Termine, Aufgaben und Wetterbeschreibung (20 Pixel pro Zeichen)
const LINE_H = 24; // Zeilenabstand im Fließtext
const ROW_PAD = 10; // Abstand pro Eintrag inkl. Trennlinie
const MORE_H = 32; // Höhe der Zeile "+N weitere"
const SECTION_HEADER_H = 34;
const SECTION_GAP = 16;
const FOOTER_H = 38;

const rowHeight = (lines) => lines * LINE_H + ROW_PAD;

// Zerlegt Text in Wörter; nach einem Bindestrich darf umgebrochen werden ("Schnee-schauer")
function tokenize(text) {
  const tokens = [];
  for (const word of text.split(" ").filter(Boolean)) {
    const parts = word.match(/[^-]+-?|-+/g) || [word];
    parts.forEach((part, i) => tokens.push({ text: part, glue: i > 0 }));
  }
  return tokens;
}

// Bricht Text in höchstens maxLines Zeilen um; zu lange Wörter werden mit "-" getrennt,
// was darüber hinausgeht, wird mit "..." abgeschnitten.
function wrapText(text, maxWidth, scale, maxLines) {
  const maxChars = Math.floor(maxWidth / (8 * scale));
  const lines = [];
  let line = "";
  for (const tok of tokenize(text)) {
    let piece = tok.text;
    const sep = line && !tok.glue ? " " : "";
    if ([...(line + sep + piece)].length <= maxChars) {
      line += sep + piece;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    while ([...piece].length > maxChars) {
      const chars = [...piece];
      lines.push(chars.slice(0, maxChars - 1).join("") + "-");
      piece = chars.slice(maxChars - 1).join("");
    }
    line = piece;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const last = lines.slice(maxLines - 1).join(" ");
    return [...lines.slice(0, maxLines - 1), fitText(last, maxWidth, scale)];
  }
  return lines;
}

// Wählt, welche Einträge in die verfügbare Höhe passen (Rest wird zu "+N weitere")
function planRows(rows, availPx, maxItems) {
  const shown = [];
  let used = 0;
  const limit = Math.min(rows.length, maxItems);
  for (let i = 0; i < limit; i++) {
    const h = rowHeight(rows[i].lineCount);
    const reserve = rows.length - (i + 1) > 0 ? MORE_H : 0;
    if (used + h + reserve > availPx) break;
    shown.push(rows[i]);
    used += h;
  }
  const hidden = rows.length - shown.length;
  return { shown, hidden, used: used + (hidden > 0 ? MORE_H : 0) };
}

function drawSectionHeader(ctx, y, title) {
  drawText(ctx.pixels, ctx.width, MARGIN, y, title, INK_BLACK, 2);
  drawHLine(ctx.pixels, ctx.width, y + 22, MARGIN, ctx.width - MARGIN, INK_BLACK, 2);
  return y + SECTION_HEADER_H;
}

function drawRows(ctx, y, plan, drawRow) {
  const { pixels, width } = ctx;
  plan.shown.forEach((row, i) => {
    drawRow(row, y);
    if (i < plan.shown.length - 1 || plan.hidden > 0) {
      drawHLine(pixels, width, y + row.lineCount * LINE_H + 1, MARGIN, width - MARGIN, LIGHT_GRAY, 1);
    }
    y += rowHeight(row.lineCount);
  });
  if (plan.hidden > 0) {
    drawText(pixels, width, MARGIN, y, `+${plan.hidden} weitere`, INK_BLACK, BODY);
    y += MORE_H;
  }
  return y;
}

// Ein Wetter-Feld (Ortsname, Symbol, Temperatur, Beschreibung, Tief/Hoch)
function drawWeatherPanel(pixels, width, x, panelW, name, weather, condLines, hiLoY) {
  const unavailable = weather.conditionCode === -1;
  drawText(pixels, width, x, 12, name, INK_BLACK, 2, true);
  drawWeatherIcon(pixels, width, x + panelW - ICON_SIZE, 2, weather.conditionCode);

  const temp = unavailable ? "--" : `${weather.temperature}`;
  let tempScale = 7;
  while (tempScale > 5 && getTextWidth(temp, tempScale) + 48 > panelW) tempScale--;
  const tw = getTextWidth(temp, tempScale);
  drawText(pixels, width, x, 60, temp, INK_BLACK, tempScale, true);
  drawText(pixels, width, x + tw, 60, "°", INK_BLACK, 3, true);
  drawText(pixels, width, x + tw + 24, 60, "C", INK_BLACK, 3, true);

  condLines.forEach((line, i) => {
    drawText(pixels, width, x, 124 + i * LINE_H, line, INK_BLACK, BODY, true);
  });

  if (!unavailable && weather.temperatureHigh !== null && weather.temperatureHigh !== undefined) {
    const hiLo = `↓${weather.temperatureLow}° ↑${weather.temperatureHigh}°`;
    const scale = getTextWidth(hiLo, 3) <= panelW ? 3 : BODY;
    drawText(pixels, width, x, hiLoY, hiLo, INK_BLACK, scale, true);
  }
}

function renderDisplay(width, height, weathers, calendar, todoist, now) {
  const pixels = new Uint8Array(width * height);
  pixels.fill(PAPER_WHITE);
  const ctx = { pixels, width, height };
  const maxContentY = height - FOOTER_H;
  const contentW = width - MARGIN * 2;

  // --- Wetter: zwei gleich große Felder nebeneinander ---
  const panelW = 208;
  const cond = weathers.map((w) => wrapText(w.condition, panelW, BODY, 2));
  const hiLoY = 124 + Math.max(cond[0].length, cond[1].length, 1) * LINE_H + 8;
  const weatherEndY = hiLoY + 34;
  drawWeatherPanel(pixels, width, MARGIN, panelW, HOME.name, weathers[0], cond[0], hiLoY);
  drawWeatherPanel(pixels, width, width - MARGIN - panelW, panelW, SECOND.name, weathers[1], cond[1], hiLoY);
  fillRect(pixels, width, height, Math.floor(width / 2) - 1, 12, 2, weatherEndY - 20, LIGHT_GRAY);
  drawHLine(pixels, width, weatherEndY, MARGIN, width - MARGIN, INK_BLACK, 3);

  // --- Datum in einer Zeile: "DIENSTAG 20. OKT" ---
  const p = zonedParts(now);
  const weekday = DAY_NAMES[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const dateStr = `${weekday} ${p.day}. ${MONTH_SHORT[p.month - 1]}`;
  const dateScale = getTextWidth(dateStr, 3) <= contentW ? 3 : BODY;
  drawCenteredText(pixels, width, weatherEndY + 12, dateStr, INK_BLACK, dateScale);
  drawHLine(pixels, width, weatherEndY + 44, MARGIN, width - MARGIN, INK_BLACK, 2);

  // --- Zeilen für Termine und Aufgaben vorbereiten ---
  const emptyRow = (msg) => {
    const lines = wrapText(msg, contentW, BODY, 2);
    return { lines, lineCount: Math.max(lines.length, 1) };
  };

  const timeColW = Math.max(0, ...calendar.events.map((ev) => getTextWidth(ev.time, BODY))) + 14;
  const eventRows = calendar.events.map((ev) => {
    const lines = wrapText(ev.title, contentW - timeColW, BODY, 2);
    return { time: ev.time, lines, lineCount: Math.max(lines.length, 1) };
  });

  const taskTextX = MARGIN + 32;
  const taskRows = todoist.tasks.map((task) => {
    const text = task.when ? `${task.when} ${task.title}` : task.title;
    const lines = wrapText(text, width - MARGIN - taskTextX, BODY, 2);
    return { lines, lineCount: Math.max(lines.length, 1), bold: task.priority === 4 };
  });

  // --- Platz verteilen: Aufgaben behalten mindestens zwei Einträge ---
  let y = weatherEndY + 58;
  const avail = maxContentY - y - 2 * SECTION_HEADER_H - SECTION_GAP;
  let evPlan;
  if (eventRows.length === 0) {
    const row = emptyRow(calendar.error || "Keine Termine heute");
    evPlan = { shown: [row], hidden: 0, used: rowHeight(row.lineCount), empty: true };
  } else {
    let reserve = 0;
    if (taskRows.length === 0) {
      reserve = rowHeight(1);
    } else {
      reserve = taskRows.slice(0, 2).reduce((sum, r) => sum + rowHeight(r.lineCount), 0);
      if (taskRows.length > 2) reserve += MORE_H;
    }
    evPlan = planRows(eventRows, avail - reserve, Infinity);
  }
  let taskPlan;
  if (taskRows.length === 0) {
    const row = emptyRow(todoist.error || "Keine Aufgaben heute");
    taskPlan = { shown: [row], hidden: 0, empty: true };
  } else {
    taskPlan = planRows(taskRows, avail - evPlan.used, MAX_TASKS);
  }

  // --- Termine ---
  y = drawSectionHeader(ctx, y, "TERMINE");
  y = drawRows(ctx, y, evPlan, (row, rowY) => {
    if (evPlan.empty) {
      row.lines.forEach((line, i) => drawText(pixels, width, MARGIN, rowY + i * LINE_H, line, INK_BLACK, BODY));
      return;
    }
    drawText(pixels, width, MARGIN, rowY, row.time, INK_BLACK, BODY, true);
    row.lines.forEach((line, i) => {
      drawText(pixels, width, MARGIN + timeColW, rowY + i * LINE_H, line, INK_BLACK, BODY);
    });
  });

  // --- Aufgaben ---
  y += SECTION_GAP;
  y = drawSectionHeader(ctx, y, "AUFGABEN");
  drawRows(ctx, y, taskPlan, (row, rowY) => {
    if (taskPlan.empty) {
      row.lines.forEach((line, i) => drawText(pixels, width, MARGIN, rowY + i * LINE_H, line, INK_BLACK, BODY));
      return;
    }
    drawBox(pixels, width, MARGIN, rowY + 1, 20, INK_BLACK);
    row.lines.forEach((line, i) => {
      drawText(pixels, width, taskTextX, rowY + i * LINE_H, line, INK_BLACK, BODY, row.bold);
    });
  });

  // --- Fußzeile ---
  const footerY = height - 22;
  drawHLine(pixels, width, footerY - 8, MARGIN, width - MARGIN, LIGHT_GRAY, 1);
  drawRightAlignedText(pixels, width, footerY, `Stand ${TIME_FORMAT.format(now)}`, DARK_GRAY, 1, MARGIN);
  const sources = [...new Set(weathers.map((w) => w.source).filter(Boolean))].join(", ");
  if (sources) drawText(pixels, width, MARGIN, footerY, `Wetter: ${sources}`, DARK_GRAY, 1);

  return pixels;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).searchParams.has("debug")) {
      return new Response(debugReport(env), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const width = parseInt(env.DISPLAY_WIDTH) || 480;
    const height = parseInt(env.DISPLAY_HEIGHT) || 800;
    const now = new Date();

    const [weatherHome, weatherSecond, calendar, todoist] = await Promise.all([
      fetchWeather(env, HOME),
      fetchWeather(env, SECOND),
      fetchCalendarEvents(env, now),
      fetchTodoistTasks(env, now),
    ]);

    const pixels = renderDisplay(width, height, [weatherHome, weatherSecond], calendar, todoist, now);
    const bmp = createBMP(width, height, pixels);

    return new Response(bmp, {
      headers: {
        "Content-Type": "image/bmp",
        "Content-Disposition": 'inline; filename="calendar.bmp"',
        "Cache-Control": "no-cache",
      },
    });
  },
};
