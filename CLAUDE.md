# CVOC

Gratis Quizlet-Alternative zum Vokabellernen, die komplett offline funktioniert.
Läuft als Electron-App und als statische Web-Version (Cloudflare).

## Aufbau

- `src/` – der eigentliche Code (html, css, js, img). Dieselben JS-Dateien laufen in Electron und im Browser; den Unterschied macht `src/js/platform.js`.
- `main.js` – Electron-Hauptprozess.
- `build-web.js` – erzeugt aus `src/` den Ordner `web/` (generiert, nicht im Repo).
- `wrangler.jsonc` – Cloudflare-Deploy der Web-Version.

## Befehle

- `npm install` – Abhängigkeiten
- `npm start` – Electron-App starten
- `npm run build:web` – Web-Version nach `web/` bauen
- `npm run deploy` – Web-Version bauen und auf Cloudflare hochladen
- `npm run dist` – Mac-App bauen

## Cloudflare

- Für Cloudflare-Fragen das Cloudflare-Plugin (Skills + MCP-Server `https://mcp.cloudflare.com/mcp`) nutzen; es ist in `.claude/settings.json` aktiviert.
- Das Projekt hat eine Wrangler-Konfiguration (`wrangler.jsonc`), also Wrangler verwenden, nicht die `cf`-CLI.
- Worker-Name: `patient-bird-da50` (Cloudflare Workers mit statischen Assets aus `web/`).

## Git & GitHub

Remote: `origin` → https://github.com/theBoss-png/CVOC, Branch `main`.

- Nach jeder abgeschlossenen, funktionierenden Änderung selbständig committen und auf `main` pushen (`git push origin main`) – ohne vorher nachzufragen.
- Vor dem Push `git pull --rebase origin main`, falls das Remote neuer ist.
- Commit-Messages kurz, auf Deutsch, im Imperativ (z. B. „Anki-Import: Medien überspringen“).
- Nie committen: `node_modules/`, `web/`, `cvoc-web.zip`, `.wrangler/`, Secrets oder API-Tokens.
- Kein `git push --force`, kein Umschreiben der History auf `main`.
- Jeder Push auf `main` deployt die Web-Version automatisch über GitHub Actions (`.github/workflows/deploy.yml`) zu Cloudflare. Deshalb nur funktionierenden Code pushen; vorher `npm run build:web` laufen lassen.
- `npm run deploy` (manueller Deploy) nur ausführen, wenn ausdrücklich verlangt.
