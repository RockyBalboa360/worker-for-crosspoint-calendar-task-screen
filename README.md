**English** · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md)

# Worker for the CrossPoint calendar sleep screen (XTEINK X4 / X4 Pro)

A Cloudflare Worker that renders a day view as a **480x800 grayscale BMP**: weather for **two locations**
(default: Berlin and Frankfurt am Main), **today's events** from Google Calendar and **today's tasks** from
Todoist. The image is meant as the sleep screen of the Xteink X4 / X4 Pro.

<p align="center">
  <img src="docs/example-display.png" alt="Example with placeholder data" width="320">
</p>

> Unofficial hobby project. It is based on
> [ckorhonen/crosspoint-calendar](https://github.com/ckorhonen/crosspoint-calendar) and uses weather data from the
> German Weather Service (DWD) and Open-Meteo. Details, sources and licenses: [NOTICE.md](NOTICE.md).

**Two parts that belong together:**
- ☁️ **Image server** (this repository): [worker-for-crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/worker-for-crosspoint-calendar-task-screen)
- 🧩 **Firmware** for the device: [crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/tree/feature/calendar-sleep-screen), **latest release: [Releases](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/releases)**

## Features
- Weather: **Bright Sky** (German Weather Service data, measurement from the nearest station) with **Open-Meteo**
  as automatic fallback; optionally Visual Crossing as a third fallback.
- Google Calendar through a **service account** (works for private calendars); alternatively an API key for public
  calendars. Several calendar IDs separated by commas.
- Events: only **today**, finished events are dropped. If none are left, the section says "Keine weiteren Termine".
- Todoist tasks (filter adjustable, default `today | overdue`): up to **8**, as many as fit; the rest is shown as
  "+N weitere". Each entry may use two lines.
- **Choose who gets the space:** all events, a fixed number of events, a fixed number of tasks or all tasks (see below).
- Long words are hyphenated by syllable ("Urlaubs-tage") so lines fill up. The rules are simplified and use no
  dictionary, so single hyphenations may be slightly off.
- The image itself is in German (umlauts, large type, line wrapping for long titles).
- The bottom line reads "Stand: 24. Oktober '26, 20:34 CEST" (CET in winter).

## Setup
1. **Google:** enable the Calendar API in your Google Cloud project, create a service account, generate a JSON key
   and share your calendar with the service account's e-mail address in Google Calendar ("See all event details").
2. **Todoist:** copy the API token from *Settings → Integrations → Developer*.
3. **Deploy the worker** (Node.js required):
   ```bash
   npx wrangler deploy
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL   # client_email from the JSON file
   npx wrangler secret put GOOGLE_PRIVATE_KEY             # private_key from the JSON file
   npx wrangler secret put GOOGLE_CALENDAR_ID             # e.g. your Gmail address
   npx wrangler secret put TODOIST_API_TOKEN
   ```
   Alternatively paste `src/index.js` into the Cloudflare editor. Credentials then belong in
   *Settings → Variables and Secrets*, **not** in the code.
4. Open the worker URL in a browser: an image must appear. Add `?debug` to the URL and the worker shows which
   settings arrive (without the values themselves).
5. Enter the URL on the device. This works with a firmware that supports the calendar sleep screen, for example the fork
   [crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/tree/feature/calendar-sleep-screen)
   (download in its [Releases](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/releases)).

## Customizing
Locations, time zone, number of tasks and the top margin are at the top of `src/index.js` (`HOME`, `SECOND`,
`TIMEZONE`, `MAX_EVENTS`, `MAX_TASKS`, `TOP_MARGIN`). Names are shown in capital letters, at most 9 characters.

### Space for events and tasks
Events and tasks share the space below the weather. Two parameters in the request URL decide who gets it first
(`https://…workers.dev/?priority=events_n&count=3`). The firmware from the fork appends them automatically, based on
its settings *Display → Calendar priority* and *Fixed count*. Without such a firmware setting you can set them as worker
variables `LAYOUT_PRIORITY` and `LAYOUT_COUNT`.

| `priority`  | Effect |
|-------------|--------|
| `events`    | all of today's events, tasks get the rest |
| `events_n`  | exactly `count` events, tasks get the rest (default, `count` = 3) |
| `tasks_n`   | exactly `count` tasks, events get the rest |
| `tasks`     | all tasks, events get the rest |

`count` is between 1 and 8. If not everything fits, the section ends with "+N weitere". An empty section only takes
one line.

<p align="center">
  <img src="docs/layout-priorities.png" alt="The four layouts: events, events_n, tasks_n, tasks" width="100%"><br>
  <em>The four layouts (left to right): all events, 2 events, 3 tasks, all tasks</em>
</p>

## Privacy and security
- **The worker URL is publicly reachable.** Anyone who knows it can see your events and tasks. Do not share or
  publish it.
- Never put keys or tokens into a file you upload to GitHub.
- A service account's private key gives access to everything shared with that service account.

## License
MIT, see [LICENSE](LICENSE). Notes on adopted parts and third-party services: [NOTICE.md](NOTICE.md).
