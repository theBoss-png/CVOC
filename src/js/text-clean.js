/* ============================================================
   CVOC – Textaufbereitung

   Gemeinsam genutzt vom Anki-Import (src/js/anki.js) und vom
   Quizlet-Import (src/js/quizlet-import.js). Läuft unter Node
   und im Browser.
   ============================================================ */

// Alles in einer Kapsel: auf anki.html liegen text-clean.js und anki.js
// im selben globalen Scope, zwei gleichnamige const würden kollidieren.
const CvocText = (() => {
  // ============================================================
  //  Text-Aufbereitung
  // ============================================================
  // HTML-4-Entities: der Latin-1-Block (160-255) wird aus dieser Liste
  // aufgebaut, der Rest steht in EXTRA_ENTITIES.
  const LATIN1_NAMES =
    "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
    "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
    "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
    "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times " +
    "Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
    "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
    "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
    "oslash ugrave uacute ucirc uuml yacute thorn yuml";

  const EXTRA_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ensp: " ", emsp: " ", thinsp: " ", zwnj: "", zwj: "", lrm: "", rlm: "",
    ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a",
    ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e", dagger: "\u2020", Dagger: "\u2021",
    bull: "\u2022", hellip: "\u2026", permil: "\u2030", prime: "\u2032", Prime: "\u2033",
    lsaquo: "\u2039", rsaquo: "\u203a", oline: "\u203e", frasl: "\u2044", euro: "\u20ac",
    trade: "\u2122", larr: "\u2190", uarr: "\u2191", rarr: "\u2192", darr: "\u2193",
    harr: "\u2194", minus: "\u2212", lowast: "\u2217", radic: "\u221a", infin: "\u221e",
    ne: "\u2260", equiv: "\u2261", le: "\u2264", ge: "\u2265", loz: "\u25ca",
    OElig: "\u0152", oelig: "\u0153", Scaron: "\u0160", scaron: "\u0161", Yuml: "\u0178",
    fnof: "\u0192", circ: "\u02c6", tilde: "\u02dc",
    Alpha: "\u0391", Beta: "\u0392", Gamma: "\u0393", Delta: "\u0394", Epsilon: "\u0395",
    Zeta: "\u0396", Eta: "\u0397", Theta: "\u0398", Iota: "\u0399", Kappa: "\u039a",
    Lambda: "\u039b", Mu: "\u039c", Nu: "\u039d", Xi: "\u039e", Omicron: "\u039f",
    Pi: "\u03a0", Rho: "\u03a1", Sigma: "\u03a3", Tau: "\u03a4", Upsilon: "\u03a5",
    Phi: "\u03a6", Chi: "\u03a7", Psi: "\u03a8", Omega: "\u03a9",
    alpha: "\u03b1", beta: "\u03b2", gamma: "\u03b3", delta: "\u03b4", epsilon: "\u03b5",
    zeta: "\u03b6", eta: "\u03b7", theta: "\u03b8", iota: "\u03b9", kappa: "\u03ba",
    lambda: "\u03bb", mu: "\u03bc", nu: "\u03bd", xi: "\u03be", omicron: "\u03bf",
    pi: "\u03c0", rho: "\u03c1", sigmaf: "\u03c2", sigma: "\u03c3", tau: "\u03c4",
    upsilon: "\u03c5", phi: "\u03c6", chi: "\u03c7", psi: "\u03c8", omega: "\u03c9",
  };

  const ENTITIES = (() => {
    const map = {};
    LATIN1_NAMES.split(" ").forEach((name, i) => {
      if (!name) return;
      map[name] = name === "shy" ? "" : String.fromCharCode(160 + i);
    });
    map.nbsp = " ";
    return Object.assign(map, EXTRA_ENTITIES);
  })();

  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (all, body) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return all;
        if (code === 160) return " ";
        try {
          return String.fromCodePoint(code);
        } catch (e) {
          return all;
        }
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : all;
    });
  }

  function collapse(s) {
    return String(s).replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  function htmlToText(s) {
    if (!s) return "";
    let t = String(s);
    t = t.replace(/\[sound:[^\]]*\]/gi, " ");
    t = t.replace(/\[anki:[^\]]*\]/gi, " ");
    t = t.replace(/<\s*(br|hr)\s*\/?\s*>/gi, " ");
    t = t.replace(/<\/\s*(div|p|li|tr|h[1-6]|td|th)\s*>/gi, " ");
    t = t.replace(/<\s*img[^>]*>/gi, " ");
    t = t.replace(/<[^>]*>/g, "");
    t = decodeEntities(t);
    return collapse(t);
  }

  // ============================================================
  //  Lautschrift entfernen  (accurate /ˈækjərət/  ->  accurate)
  // ============================================================
  // Ausgelöst wird nur, wenn im Klammerinhalt ein Zeichen steht, das in
  // normaler Rechtschreibung praktisch nie vorkommt. Betonungs- und
  // Längenzeichen sind die sichersten Marker. Bewusst NICHT als Auslöser:
  // æ ø ð þ ç ß β θ χ – die stehen in echten Wörtern (dänisch, isländisch,
  // französisch, griechisch) und würden "øl/ærlig/mad" zerstören.
  const IPA_STRONG = /[\u02c8\u02cc\u02d0\u02d1]/;

  const IPA_LETTERS =
    "\u0250\u0251\u0252\u0253\u0254\u0255\u0256\u0257\u0258\u0259\u025a\u025b\u025c\u025d\u025e" +
    "\u025f\u0260\u0261\u0262\u0263\u0264\u0265\u0266\u0267\u0268\u0269\u026b\u026c\u026d\u026e" +
    "\u026f\u0270\u0271\u0272\u0273\u0274\u0275\u0276\u0278\u0279\u027a\u027b\u027d\u027e\u0280" +
    "\u0281\u0282\u0283\u0284\u0288\u0289\u028a\u028b\u028c\u028d\u028e\u028f\u0290\u0291\u0292" +
    "\u0294\u0295\u0298\u0299\u029b\u029c\u029d\u029f\u02a1\u02a2\u02a7\u02a4\u014b";

  const IPA_TRIGGER = new RegExp("[" + IPA_LETTERS + "]|" + IPA_STRONG.source);

  function looksLikeIpa(text) {
    return IPA_TRIGGER.test(text);
  }

  function stripPronunciation(text) {
    let t = String(text || "");

    // /ˈækjərət/   [ˈækjərət]   (ˈækjərət)
    t = t.replace(/\/([^\/\n]{1,80})\//g, (all, inner) => (looksLikeIpa(inner) ? " " : all));
    t = t.replace(/\[([^\[\]\n]{1,80})\]/g, (all, inner) => (looksLikeIpa(inner) ? " " : all));
    t = t.replace(/\(([^()\n]{1,80})\)/g, (all, inner) => (looksLikeIpa(inner) ? " " : all));

    // Ohne Klammern: nur wenn ein Betonungs- oder Längenzeichen drinsteht.
    t = t
      .split(/\s+/)
      .filter((word) => !(word && IPA_STRONG.test(word)))
      .join(" ");

    return collapse(t);
  }

  return { decodeEntities, collapse, htmlToText, stripPronunciation, looksLikeIpa };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CvocText;
if (typeof window !== "undefined") window.CvocText = CvocText;
