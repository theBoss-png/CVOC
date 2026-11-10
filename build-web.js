#!/usr/bin/env node
/* ============================================================
   CVOC – Web-Build

   Erzeugt aus src/ den Ordner web/, der so wie er ist auf einen
   statischen Hoster (Cloudflare Pages) hochgeladen werden kann.

   Es gibt bewusst KEINE zweite Kopie des Codes, die man pflegen
   müsste: dieselben JS-Dateien laufen in Electron und im Browser,
   den Unterschied macht src/js/platform.js. Dieses Skript kopiert
   nur, korrigiert die Pfade und legt die drei Bibliotheken dazu.

     node build-web.js        oder      npm run build:web
   ============================================================ */

const fs = require("fs");
const path = require("path");

const root = __dirname;
const src = path.join(root, "src");
const out = path.join(root, "web");

const VENDOR = [
  ["node_modules/pako/dist/pako.min.js", "pako.min.js"],
  ["node_modules/fzstd/umd/index.js", "fzstd.js"],
  ["node_modules/sql.js/dist/sql-wasm.js", "sql-wasm.js"],
  ["node_modules/sql.js/dist/sql-wasm.wasm", "sql-wasm.wasm"],
];

// Skripte, die nur die Web-Version zusätzlich braucht.
// In Electron liegt der Anki-Parser im Hauptprozess, im Browser im Tab.
const WEB_ONLY_SCRIPTS = {
  "anki.html": [
    "vendor/pako.min.js",
    "vendor/fzstd.js",
    "vendor/sql-wasm.js",
    "js/text-clean.js",
    "js/anki.js",
  ],
};

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (filter && !filter(entry.name)) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
}

function rewriteHtml(html, file) {
  let s = html;

  // ../css/x.css -> css/x.css,  ../js/x.js -> js/x.js
  s = s.replace(/(?:\.\.\/)+(css|js)\//g, "$1/");

  // pako kam aus node_modules -> vendor/
  s = s.replace(/(?:\.\.\/)+node_modules\/pako\/dist\/pako\.min\.js/g, "vendor/pako.min.js");

  // Favicon (nur im Web nötig, Electron nutzt icon.icns)
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />';
  if (s.includes(head)) {
    s = s.replace(
      head,
      head +
        '\n    <link rel="icon" href="icon-32.png" sizes="32x32" />' +
        '\n    <link rel="apple-touch-icon" href="icon-180.png" />'
    );
  }

  // Web-only Bibliotheken vor platform.js einhängen
  const extra = WEB_ONLY_SCRIPTS[file];
  if (extra) {
    const anchor = '<script src="js/platform.js"></script>';
    if (!s.includes(anchor)) throw new Error(`${file}: platform.js nicht gefunden`);
    const tags = extra.map((p) => `<script src="${p}"></script>`).join("\n    ");
    s = s.replace(anchor, tags + "\n    " + anchor);
  }

  return s;
}

function main() {
  console.log("CVOC Web-Build");
  rm(out);
  fs.mkdirSync(out, { recursive: true });

  // ---- CSS & JS ----
  copyDir(path.join(src, "css"), path.join(out, "css"), (n) => n.endsWith(".css"));
  copyDir(path.join(src, "js"), path.join(out, "js"), (n) => n.endsWith(".js"));
  console.log("  css/ und js/ kopiert");

  // ---- HTML ----
  const htmlDir = path.join(src, "html");
  const pages = fs.readdirSync(htmlDir).filter((n) => n.endsWith(".html"));
  for (const page of pages) {
    const built = rewriteHtml(fs.readFileSync(path.join(htmlDir, page), "utf8"), page);
    fs.writeFileSync(path.join(out, page), built);
    // Die Startseite zusätzlich als index.html, damit die nackte
    // Domain funktioniert. home.html bleibt, weil intern darauf verlinkt wird.
    if (page === "home.html") fs.writeFileSync(path.join(out, "index.html"), built);
  }
  console.log(`  ${pages.length} Seiten + index.html geschrieben`);

  // ---- Bibliotheken ----
  const vendorDir = path.join(out, "vendor");
  fs.mkdirSync(vendorDir, { recursive: true });
  for (const [from, to] of VENDOR) {
    const abs = path.join(root, from);
    if (!fs.existsSync(abs)) {
      throw new Error(`Fehlt: ${from} – zuerst "npm install" ausführen.`);
    }
    fs.copyFileSync(abs, path.join(vendorDir, to));
  }
  console.log(`  ${VENDOR.length} Bibliotheken nach vendor/`);

  // ---- Bilder ----
  const imgDir = path.join(src, "img");
  if (fs.existsSync(imgDir)) {
    copyDir(imgDir, out, (n) => /\.(png|svg|ico|jpg)$/i.test(n));
    console.log("  Icons kopiert");
  }

  // ---- Cloudflare: lange Cache-Zeit für die Bibliotheken ----
  fs.writeFileSync(
    path.join(out, "_headers"),
    ["/vendor/*", "  Cache-Control: public, max-age=31536000, immutable", ""].join("\n")
  );

  // ---- Bilanz ----
  let bytes = 0;
  let files = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        bytes += fs.statSync(p).size;
        files++;
      }
    }
  };
  walk(out);
  console.log(`\nFertig: web/ – ${files} Dateien, ${(bytes / 1024).toFixed(0)} KB`);
  console.log("Diesen Ordner auf Cloudflare Pages hochladen.");
}

main();
