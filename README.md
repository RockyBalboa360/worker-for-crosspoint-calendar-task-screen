# Worker für den CrossPoint-Kalender-Ruhebildschirm (XTEINK X4 / X4 Pro)

Ein Cloudflare Worker, der eine Tagesansicht als **480x800-Graustufen-BMP** erzeugt:
Wetter für **zwei Orte** (Standard: Berlin und Frankfurt am Main), die **Termine von heute**
aus Google Kalender und die **Aufgaben von heute** aus Todoist. Das Bild ist als
Ruhebildschirm für den Xteink X4 / X4 Pro gedacht.

![Beispiel mit Platzhalterdaten](docs/example-display.png)

> Inoffizielles Hobbyprojekt. Es basiert auf
> [ckorhonen/crosspoint-calendar](https://github.com/ckorhonen/crosspoint-calendar) und nutzt
> Wetterdaten des Deutschen Wetterdienstes und von Open-Meteo. Details, Quellen und Lizenzen:
> [NOTICE.md](NOTICE.md).

## Funktionen
- Wetter: **Bright Sky** (Daten des Deutschen Wetterdienstes, Messwert der nächsten Station)
  mit **Open-Meteo** als automatischem Ersatz; optional Visual Crossing als dritte Reserve.
- Google Kalender über ein **Dienstkonto** (auch für private Kalender); alternativ API-Schlüssel
  für öffentliche Kalender. Mehrere Kalender-IDs mit Komma getrennt.
- Google-Termine: nur **heute**, die **nächsten drei** (beendete Termine entfallen). Gibt es keine mehr, steht dort
  „Keine weiteren Termine“.
- Todoist-Aufgaben (Filter einstellbar, Standard `today | overdue`): bis zu **8**, so viele wie nach den Terminen
  noch Platz haben, der Rest erscheint als „+N weitere“. Jeder Eintrag darf zwei Zeilen belegen.
- Lange Wörter werden nach Silben getrennt („Urlaubs-tage“), damit die Zeilen voll werden. Die Regeln sind
  vereinfacht und kennen kein Wörterbuch, einzelne Trennungen können deshalb nicht ganz richtig sein.
- Deutsche Oberfläche mit Umlauten, große Schrift, Zeilenumbruch bei langen Titeln.
- Unten steht eine Zeile „Stand: 24. Oktober '26, 20:34 CEST“ (CET im Winter).

## Einrichtung
1. **Google:** Calendar API im Google-Cloud-Projekt aktivieren, ein Dienstkonto anlegen, einen
   JSON-Schlüssel erzeugen und den Kalender in Google Kalender für die E-Mail-Adresse des
   Dienstkontos freigeben („Alle Termindetails anzeigen“).
2. **Todoist:** API-Token unter *Einstellungen → Integrationen → Entwickler* kopieren.
3. **Worker bereitstellen** (Node.js erforderlich):
   ```bash
   npx wrangler deploy
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL   # client_email aus der JSON-Datei
   npx wrangler secret put GOOGLE_PRIVATE_KEY             # private_key aus der JSON-Datei
   npx wrangler secret put GOOGLE_CALENDAR_ID             # z. B. deine Gmail-Adresse
   npx wrangler secret put TODOIST_API_TOKEN
   ```
   Alternativ lässt sich `src/index.js` im Cloudflare-Editor einfügen. Zugangsdaten gehören
   dann in *Settings → Variables and Secrets*, **nicht** in den Code.
4. Die Worker-URL im Browser öffnen: Es muss ein Bild erscheinen. Mit `?debug` hinter der URL
   zeigt der Worker, welche Einstellungen ankommen (ohne die Werte selbst).
5. Am Gerät die URL eintragen. Das geht mit einer Firmware, die den Kalender-Ruhebildschirm
   unterstützt, z. B. dem Fork
   [crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen).

## Anpassen
Orte, Zeitzone, Anzahl der Aufgaben und der obere Rand stehen oben in `src/index.js` (`HOME`, `SECOND`,
`TIMEZONE`, `MAX_EVENTS`, `MAX_TASKS`, `TOP_MARGIN`). Die Namen werden in Großbuchstaben mit höchstens 9 Zeichen
angezeigt.

### Platz für Termine und Aufgaben
Termine und Aufgaben teilen sich den Platz unter dem Wetter. Wer ihn zuerst bekommt, steuerst du mit zwei Parametern
in der Abruf-URL (`https://…workers.dev/?priority=events_n&count=3`). Die Firmware aus dem Fork hängt sie nach den
Einstellungen *Display → Calendar priority* und *Fixed count* automatisch an. Ohne Firmware-Einstellung kannst du sie
als Worker-Variablen `LAYOUT_PRIORITY` und `LAYOUT_COUNT` setzen.

| `priority`  | Wirkung |
|-------------|---------|
| `events`    | alle heutigen Termine, die Aufgaben bekommen den Rest |
| `events_n`  | genau `count` Termine, die Aufgaben bekommen den Rest (Standard, `count` = 3) |
| `tasks_n`   | genau `count` Aufgaben, die Termine bekommen den Rest |
| `tasks`     | alle Aufgaben, die Termine bekommen den Rest |

`count` liegt zwischen 1 und 8. Passt nicht alles in den Platz, steht am Ende der Rubrik „+N weitere“.
Eine Rubrik ohne Einträge belegt nur eine Zeile.

## Datenschutz und Sicherheit
- **Die Worker-URL ist öffentlich erreichbar.** Wer sie kennt, sieht deine Termine und
  Aufgaben. Gib sie nicht weiter und veröffentliche sie nicht.
- Trage Schlüssel und Tokens nie in eine Datei ein, die du auf GitHub hochlädst.
- Der private Schlüssel eines Dienstkontos gibt Zugriff auf alles, was für das Dienstkonto
  freigegeben ist.

## Lizenz
MIT, siehe [LICENSE](LICENSE). Hinweise auf übernommene Teile und Drittanbieter:
[NOTICE.md](NOTICE.md).
