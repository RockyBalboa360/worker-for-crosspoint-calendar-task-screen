# Hinweise zu Urheberschaft, Quellen und Drittanbietern

Dieses Repository ist ein **inoffizielles, privates Hobbyprojekt**. Es steht in keiner
Verbindung zu Xteink, dem CrossPoint-Reader-Projekt, Google, Todoist, Cloudflare,
Open-Meteo, Bright Sky oder dem Deutschen Wetterdienst. Alle genannten Namen und Marken
gehören ihren jeweiligen Inhabern und werden nur beschreibend verwendet.

## Ursprung des Codes

Der Worker geht auf das Projekt **crosspoint-calendar** von **ckorhonen** zurück:
<https://github.com/ckorhonen/crosspoint-calendar>

Übernommen bzw. als Vorlage verwendet wurden die Grundidee (ein Cloudflare Worker, der ein
480x800-Graustufen-BMP für den CrossPoint-Kalendermodus erzeugt), der Aufbau der
BMP-Erzeugung, das Zeichnen mit einer eigenen 8x8-Bitmap-Schrift sowie die Schriftdaten
für Ziffern und Buchstaben. Das Original nennt in seiner README die **MIT-Lizenz**. Im
Repository fanden sich beim Anlegen dieses Projekts weder eine `LICENSE`-Datei noch eine
Copyright-Zeile; die Angabe „MIT“ stammt aus der README. Die Herkunft der Schriftdaten ist
im Originalprojekt nicht dokumentiert.

Dieses Repository enthält nach dem Umbau weitgehend neu geschriebenen Code, unter anderem:
deutsche Oberfläche, zwei Wetterorte nebeneinander, Bright Sky (DWD) mit Open-Meteo als
Ersatz, Google-Kalender-Anbindung über ein Dienstkonto, Todoist-Aufgaben, größere
Schrift mit Umbruch, Umlaute, kräftige Wettersymbole. Das Urheberrecht an den
eigenen Änderungen liegt bei RockyBalboa360 (siehe `LICENSE`), das Urheberrecht an den
übernommenen Teilen bei den Urhebern des Originals.

## Entstehung mit KI-Unterstützung

Die Überarbeitung wurde mit Unterstützung von Claude Code (Anthropic) erstellt und vom
Repository-Inhaber geprüft und veröffentlicht.

## Datenquellen und Dienste (zur Laufzeit abgefragt, nicht enthalten)

| Dienst | Zweck | Hinweise |
|---|---|---|
| Bright Sky <https://brightsky.dev> | Wetter (primär) | Offene Schnittstelle zu Daten des **Deutschen Wetterdienstes (DWD)**. Quellenangabe: „Quelle: Deutscher Wetterdienst“. |
| Open-Meteo <https://open-meteo.com> | Wetter (Ersatz) | Daten unter CC BY 4.0, kostenlos nur für nicht-kommerzielle Nutzung. Quellenangabe: „Weather data by Open-Meteo.com“. |
| Visual Crossing | Wetter (optional, dritter Ersatz) | Nur mit eigenem API-Schlüssel; deren Nutzungsbedingungen gelten. |
| Google Calendar API | Termine | Es gelten die Google-API-Nutzungsbedingungen. |
| Todoist API | Aufgaben | Es gelten die Todoist-Nutzungsbedingungen. |
| Cloudflare Workers | Hosting | Es gelten die Cloudflare-Nutzungsbedingungen. |

Das Programm zeigt die verwendete Wetterquelle unten links auf dem Bild an.

## Datenschutz

Der Worker speichert keine Daten. Er ruft Termine und Aufgaben bei jedem Aufruf ab und
liefert sie als Bild. **Wer die URL des Workers kennt, sieht diese Daten.** Veröffentliche
die URL daher nicht und trage Zugangsdaten nie in den Code ein, sondern nur als Secrets.
