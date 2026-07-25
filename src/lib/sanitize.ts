/**
 * Deterministic allowlist HTML sanitizer — produces byte-identical output on
 * server and client, so SSR'd markup hydrates cleanly.
 *
 * History: this module used to strip ALL tags on the server but run DOMPurify
 * on the client, so every SSR'd component rendering user HTML (review cards on
 * book pages / public profiles) produced different __html on server vs client
 * and broke hydration. DOMPurify needs a real DOM, and shipping jsdom in every
 * Vercel function is multi-MB of cold-start weight — so this is a small pure-
 * string sanitizer instead, sized for the HTML we actually store (Goodreads
 * review imports: p/br/div/b/i/a, spoiler spans, entities).
 *
 * Safety model: output is only ever REBUILT from canonical pieces — allowlisted
 * lowercase tag names, allowlisted attributes whose values are validated and
 * re-escaped, and text that is entity-decoded then re-escaped. Raw input never
 * passes through unescaped, so there is no tag/attribute smuggling surface.
 *
 * Determinism model: output is also kept stable under browser parse→serialize
 * (balanced tags, <p>-autoclose emulation, canonical entity escaping), so a
 * hydration-time innerHTML comparison sees identical strings.
 */

export type SanitizeConfig = {
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
};

const DEFAULT_ALLOWED_TAGS = [
  "p", "br", "div", "b", "i", "strong", "em", "u", "s",
  "span", "ul", "ol", "li", "blockquote", "a",
];

const DEFAULT_ALLOWED_ATTR = ["class", "data-spoiler", "href"];

/** Elements whose entire content must be removed, not just the tags. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "textarea",
  "title", "noscript", "svg", "math", "template", "select", "option",
]);

const VOID_TAGS = new Set(["br", "hr"]);

/** Block-level tags whose open tag implicitly closes an open <p> in the HTML parser. */
const CLOSES_P = new Set([
  "p", "div", "ul", "ol", "blockquote", "hr", "pre", "table",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

/** Class / data-attribute values are restricted to a boring charset. */
const SAFE_ATTR_VALUE = /^[A-Za-z0-9 _-]*$/;

/** Windows-1252 remapping the HTML parser applies to numeric refs &#128;–&#159;. */
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", deg: "°",
  plusmn: "±", times: "×", divide: "÷", micro: "µ",
  middot: "·", bull: "•", hellip: "…", dagger: "†",
  Dagger: "‡", permil: "‰", prime: "′", Prime: "″",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  lsaquo: "‹", rsaquo: "›", laquo: "«", raquo: "»",
  iexcl: "¡", iquest: "¿", cent: "¢", pound: "£",
  euro: "€", yen: "¥", sect: "§", para: "¶",
  shy: "­", frac12: "½", frac14: "¼", frac34: "¾",
  sup1: "¹", sup2: "²", sup3: "³", ordf: "ª",
  ordm: "º", curren: "¤", brvbar: "¦", uml: "¨",
  not: "¬", macr: "¯", acute: "´", cedil: "¸",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã",
  Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó",
  Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  Yacute: "Ý", THORN: "Þ", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã",
  auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó",
  ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  yacute: "ý", thorn: "þ", yuml: "ÿ",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š",
  Yuml: "Ÿ", fnof: "ƒ", circ: "ˆ", tilde: "˜",
  ensp: " ", emsp: " ", thinsp: " ",
};

function decodeNumericRef(hex: string | undefined, dec: string | undefined): string {
  let code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec!, 10);
  if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return "�";
  }
  if (CP1252[code] !== undefined) code = CP1252[code];
  return String.fromCodePoint(code);
}

/** Decode character references to plain text (mirrors HTML parser behavior). */
function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (full, hex, dec, named) => {
      if (named !== undefined) {
        const decoded = NAMED_ENTITIES[named];
        // Unknown named refs stay literal (the parser leaves them as text too).
        return decoded !== undefined ? decoded : full;
      }
      return decodeNumericRef(hex, dec);
    }
  );
}

/** Escape text exactly the way innerHTML serialization does. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00A0/g, "&nbsp;");
}

/** Escape an attribute value for a double-quoted attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\u00A0/g, "&nbsp;");
}

function emitText(raw: string, out: string[]): void {
  if (raw) out.push(escapeText(decodeEntities(raw)));
}

function safeHref(rawValue: string): string | null {
  const value = decodeEntities(rawValue).trim();
  // Strip chars the URL parser ignores before scheme detection (bypass vector).
  const schemeProbe = value.replace(/[\u0000-\u0020]/g, "");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(schemeProbe)) {
    if (!/^(https?:\/\/|mailto:)/i.test(schemeProbe)) return null;
    return schemeProbe;
  }
  if (value.startsWith("/") || value.startsWith("#")) return value;
  return null;
}

const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:_.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;

function buildAttrs(tagName: string, rawAttrs: string, allowedAttr: Set<string>): string {
  let result = "";
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase();
    if (!allowedAttr.has(name)) continue;
    const rawValue = m[3] ?? m[4] ?? (m[2] !== undefined ? m[2] : "");
    if (name === "href") {
      if (tagName !== "a") continue;
      const href = safeHref(rawValue);
      if (href === null) continue;
      result += ` href="${escapeAttr(href)}" rel="nofollow noopener"`;
    } else {
      const value = decodeEntities(rawValue);
      if (!SAFE_ATTR_VALUE.test(value)) continue;
      result += ` ${name}="${value}"`;
    }
  }
  return result;
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;

export function sanitizeHtml(html: string, config?: SanitizeConfig): string {
  if (!html) return "";
  const allowedTags = new Set(
    (config?.ALLOWED_TAGS ?? DEFAULT_ALLOWED_TAGS).map((t) => t.toLowerCase())
  );
  const allowedAttr = new Set(
    (config?.ALLOWED_ATTR ?? DEFAULT_ALLOWED_ATTR).map((a) => a.toLowerCase())
  );

  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emitText(html.slice(i), out);
      break;
    }
    emitText(html.slice(i, lt), out);

    // Comments and declarations (<!-- -->, <!doctype>, <?...>) are dropped whole.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt + 1);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(html);
    if (!m) {
      // Lone "<" that never forms a tag — escape it as text.
      out.push("&lt;");
      i = lt + 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const isClosing = m[1] === "/";
    const name = m[2].toLowerCase();

    if (isClosing) {
      if (allowedTags.has(name) && !VOID_TAGS.has(name)) {
        const idx = stack.lastIndexOf(name);
        if (idx !== -1) {
          while (stack.length > idx) out.push(`</${stack.pop()}>`);
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      // Remove the element INCLUDING its contents (script bodies must not leak as text).
      const closeRe = new RegExp(`</${name}\\s*>`, "gi");
      closeRe.lastIndex = i;
      const closeMatch = closeRe.exec(html);
      i = closeMatch ? closeRe.lastIndex : html.length;
      continue;
    }

    if (!allowedTags.has(name)) continue; // drop tag, keep flowing content

    // Mirror the HTML parser: block elements implicitly close an open <p>,
    // and a new <li> closes the previous one.
    if (CLOSES_P.has(name) && stack[stack.length - 1] === "p") {
      out.push("</p>");
      stack.pop();
    }
    if (name === "li" && stack[stack.length - 1] === "li") {
      out.push("</li>");
      stack.pop();
    }

    out.push(`<${name}${buildAttrs(name, m[3], allowedAttr)}>`);
    // Non-void tags always open (the parser ignores "/" on them, e.g. <span/>).
    if (!VOID_TAGS.has(name)) stack.push(name);
  }

  while (stack.length > 0) out.push(`</${stack.pop()}>`);
  return out.join("");
}
