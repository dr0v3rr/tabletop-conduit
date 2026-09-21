// Sanitize note HTML before it's stored or rendered. The renderer CSP already blocks script
// execution (script-src 'self', no unsafe-inline), so this is defense-in-depth with one job the CSP
// does NOT do: stop untrusted pasted content from (a) loading REMOTE resources — a tracking beacon
// via `<img src=https://…>` or `style="background:url(https://…)"` — and (b) smuggling interactive
// or embedding tags. We allow only formatting tags, inline `data:` images, and safe-scheme links.
//
// Uses DOMParser, so call it only where a DOM exists (the renderer, or a jsdom test) — never in the
// main process.

const ALLOWED = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'SPAN', 'BR',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'A', 'IMG',
]);

// Elements dropped with their whole subtree (never merely unwrapped): script/style carry code, the
// rest can load resources, embed, or take input.
const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET',
  'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL',
  'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS',
]);

// --- Pure allow/deny decisions (unit-tested in node; the DOM walk below is thin glue over them) ---

/** True for a tag we keep (formatting / structure / inline image / link). */
export function isAllowedTag(tag: string): boolean { return ALLOWED.has(tag.toUpperCase()); }
/** True for a tag dropped with its whole subtree (code, resource loaders, form controls, media). */
export function isDroppedTag(tag: string): boolean { return DROP.has(tag.toUpperCase()); }
/** A link href we keep — http(s)/mailto only, never javascript:/data:/other schemes. */
export function isSafeHref(value: string): boolean { return /^(https?:|mailto:)/i.test(value.trim()); }
/** An image src we keep — inline `data:image/…` only, never a remote URL (a tracking beacon). */
export function isSafeImgSrc(value: string): boolean { return /^data:image\//i.test(value.trim()); }
/** The subset of a class attribute we keep (only our own known class). */
export function keptClasses(value: string): string {
  return value.split(/\s+/).filter((c) => c === 'nb-img').join(' ');
}

/** Return a cleaned copy of `html` containing only the allowlisted, resource-safe subset. */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  cleanChildren(doc.body);
  return doc.body.innerHTML;
}

function cleanChildren(parent: Node): void {
  // Snapshot first — we mutate the tree as we go.
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      cleanElement(child as Element);
    } else if (child.nodeType !== 3) {
      child.parentNode?.removeChild(child); // comments / CDATA / processing instructions
    }
    // text nodes (type 3) are kept as-is
  }
}

function cleanElement(el: Element): void {
  const tag = el.tagName.toUpperCase();
  if (isDroppedTag(tag)) { el.remove(); return; }
  if (!isAllowedTag(tag)) {
    // Unknown-but-harmless wrapper (font, marquee, custom elements…): keep its text, drop the tag.
    cleanChildren(el);
    const parent = el.parentNode;
    if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); }
    el.remove();
    return;
  }
  scrubAttributes(el);
  if (!el.isConnected && !el.parentNode) return; // scrubAttributes may have dropped a src-less <img>
  cleanChildren(el);
}

function scrubAttributes(el: Element): void {
  const tag = el.tagName.toUpperCase();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name === 'href' && tag === 'A') {
      if (!isSafeHref(value)) el.removeAttribute(attr.name); // no javascript:/data: links
    } else if (name === 'src' && tag === 'IMG') {
      if (!isSafeImgSrc(value)) el.removeAttribute(attr.name); // inline images only — never remote
    } else if (name === 'alt' && tag === 'IMG') {
      // harmless; keep
    } else if (name === 'class') {
      const kept = keptClasses(value); // only our own known class
      if (kept) el.setAttribute('class', kept); else el.removeAttribute('class');
    } else {
      el.removeAttribute(attr.name); // strip everything else: on* handlers, style, id, srcset, data-*, …
    }
  }
  if (tag === 'IMG' && !el.getAttribute('src')) el.remove(); // a remote <img> we just de-fanged → gone
}
