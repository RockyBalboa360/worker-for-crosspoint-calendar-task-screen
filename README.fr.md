[English](README.md) · [Deutsch](README.de.md) · **Français** · [Español](README.es.md)

# Worker pour l'écran de veille « calendrier » de CrossPoint (XTEINK X4 / X4 Pro)

Un Cloudflare Worker qui génère une vue de la journée sous forme de **BMP en niveaux de gris 480x800** : la météo de
**deux lieux** (par défaut Berlin et Francfort-sur-le-Main), les **rendez-vous du jour** de Google Agenda et les
**tâches du jour** de Todoist. L'image est conçue comme écran de veille pour la Xteink X4 / X4 Pro.

<p align="center">
  <img src="docs/example-display.png" alt="Exemple avec des données fictives" width="320">
</p>

> Projet personnel non officiel. Il repose sur
> [ckorhonen/crosspoint-calendar](https://github.com/ckorhonen/crosspoint-calendar) et utilise les données
> météorologiques du Deutscher Wetterdienst (DWD) et d'Open-Meteo. Détails, sources et licences : [NOTICE.md](NOTICE.md).

**Deux parties qui vont ensemble :**
- ☁️ **Serveur d'image** (ce dépôt) : [worker-for-crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/worker-for-crosspoint-calendar-task-screen)
- 🧩 **Firmware** pour l'appareil : [crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/tree/feature/calendar-sleep-screen), **dernière version : [Releases](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/releases)**

## Fonctionnalités
- Météo : **Bright Sky** (données du Deutscher Wetterdienst, mesure de la station la plus proche) avec **Open-Meteo**
  comme solution de repli automatique ; Visual Crossing en option comme troisième secours.
- Google Agenda via un **compte de service** (fonctionne avec les agendas privés) ; ou bien une clé d'API pour les
  agendas publics. Plusieurs identifiants d'agenda séparés par des virgules.
- Rendez-vous : uniquement **aujourd'hui**, les rendez-vous terminés disparaissent. S'il n'en reste aucun, la section
  indique « Keine weiteren Termine » (« Plus de rendez-vous »).
- Tâches Todoist (filtre réglable, par défaut `today | overdue`) : jusqu'à **8**, autant que la place le permet ; le reste
  apparaît sous la forme « +N weitere » (« +N de plus »). Chaque entrée peut occuper deux lignes.
- **Choix de la répartition de la place :** tous les rendez-vous, un nombre fixe de rendez-vous, un nombre fixe de
  tâches ou toutes les tâches (voir ci-dessous).
- Les mots longs sont coupés par syllabes (« Urlaubs-tage ») pour remplir les lignes. Les règles sont simplifiées et
  n'utilisent aucun dictionnaire ; certaines coupures peuvent donc être légèrement inexactes.
- L'image elle-même est en allemand (trémas, grands caractères, retour à la ligne pour les titres longs).
- La ligne du bas indique « Stand: 24. Oktober '26, 20:34 CEST » (CET en hiver).

## Mise en place
1. **Google :** activez l'API Calendar dans votre projet Google Cloud, créez un compte de service, générez une clé JSON
   et partagez votre agenda avec l'adresse e-mail du compte de service dans Google Agenda (« Voir tous les détails de
   l'événement »).
2. **Todoist :** copiez le jeton d'API depuis *Paramètres → Intégrations → Développeur*.
3. **Déployer le worker** (Node.js requis) :
   ```bash
   npx wrangler deploy
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL   # client_email du fichier JSON
   npx wrangler secret put GOOGLE_PRIVATE_KEY             # private_key du fichier JSON
   npx wrangler secret put GOOGLE_CALENDAR_ID             # p. ex. votre adresse Gmail
   npx wrangler secret put TODOIST_API_TOKEN
   ```
   Vous pouvez aussi coller `src/index.js` dans l'éditeur de Cloudflare. Les identifiants vont alors dans
   *Settings → Variables and Secrets*, **pas** dans le code.
4. Ouvrez l'URL du worker dans un navigateur : une image doit apparaître. Avec `?debug` ajouté à l'URL, le worker
   indique quels réglages lui parviennent (sans les valeurs elles-mêmes).
5. Saisissez l'URL sur l'appareil. Cela fonctionne avec un firmware qui prend en charge l'écran de veille calendrier,
   par exemple le fork
   [crosspoint-calendar-task-screen](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/tree/feature/calendar-sleep-screen)
   (téléchargement dans ses [Releases](https://github.com/RockyBalboa360/crosspoint-calendar-task-screen/releases)).

## Personnalisation
Les lieux, le fuseau horaire, le nombre de tâches et la marge supérieure se trouvent en haut de `src/index.js`
(`HOME`, `SECOND`, `TIMEZONE`, `MAX_EVENTS`, `MAX_TASKS`, `TOP_MARGIN`). Les noms sont affichés en majuscules, 9 caractères
au maximum.

### Place pour les rendez-vous et les tâches
Les rendez-vous et les tâches se partagent la place sous la météo. Deux paramètres dans l'URL de la requête décident
qui passe en premier (`https://…workers.dev/?priority=events_n&count=3`). Le firmware du fork les ajoute
automatiquement, selon ses réglages *Display → Calendar priority* et *Fixed count*. Sans ce réglage du firmware, vous
pouvez les définir comme variables du worker `LAYOUT_PRIORITY` et `LAYOUT_COUNT`.

| `priority`  | Effet |
|-------------|-------|
| `events`    | tous les rendez-vous du jour, les tâches reçoivent le reste |
| `events_n`  | exactement `count` rendez-vous, les tâches reçoivent le reste (par défaut, `count` = 3) |
| `tasks_n`   | exactement `count` tâches, les rendez-vous reçoivent le reste |
| `tasks`     | toutes les tâches, les rendez-vous reçoivent le reste |

`count` est compris entre 1 et 8. Si tout ne tient pas, la section se termine par « +N weitere ». Une section vide ne
prend qu'une ligne.

<p align="center">
  <img src="docs/layout-priorities.png" alt="Les quatre dispositions : events, events_n, tasks_n, tasks" width="100%"><br>
  <em>Les quatre dispositions (de gauche à droite) : tous les rendez-vous, 2 rendez-vous, 3 tâches, toutes les tâches</em>
</p>

## Confidentialité et sécurité
- **L'URL du worker est accessible publiquement.** Quiconque la connaît peut voir vos rendez-vous et vos tâches. Ne la
  partagez pas et ne la publiez pas.
- N'écrivez jamais de clés ni de jetons dans un fichier que vous mettez en ligne sur GitHub.
- La clé privée d'un compte de service donne accès à tout ce qui est partagé avec ce compte de service.

## Licence
MIT, voir [LICENSE](LICENSE). Mentions sur les parties reprises et les services tiers : [NOTICE.md](NOTICE.md).
