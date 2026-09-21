// Markdown-shortcut detection for the Notebook editor. Pure string logic — unit-tested here; the
// contenteditable/DOM wiring that consumes it lives in electron/sheet.ts.

export type InlineMatch = { remove: number; tag: 'b' | 'i' | 'code'; text: string };
export type BlockMatch =
  | { kind: 'heading'; level: 1 | 2 | 3 }
  | { kind: 'ul' }
  | { kind: 'ol' }
  | { kind: 'quote' };

/**
 * Trailing inline markdown ending exactly at the caret. `prefix` is the line text from the start of
 * the caret's text node up to the caret. Returns how many chars to remove (ending at the caret) and
 * the replacement element, or null. `**bold**` and `` `code` `` match anywhere; `_italic_` only when
 * the opening `_` sits at a word boundary, so `snake_case` is left alone.
 */
export function matchInline(prefix: string): InlineMatch | null {
  let m: RegExpMatchArray | null;
  if ((m = prefix.match(/\*\*(\S(?:.*?\S)?)\*\*$/))) return { remove: m[0].length, tag: 'b', text: m[1]! };
  if ((m = prefix.match(/`([^`]+)`$/))) return { remove: m[0].length, tag: 'code', text: m[1]! };
  if ((m = prefix.match(/(^|\s)_([^_\s](?:[^_]*[^_\s])?)_$/))) return { remove: m[0].length - m[1]!.length, tag: 'i', text: m[2]! };
  return null;
}

/** A block marker occupying the whole line so far (`prefix` === just the marker), matched on Space. */
export function matchBlock(prefix: string): BlockMatch | null {
  const h = /^(#{1,3})$/.exec(prefix);
  if (h) return { kind: 'heading', level: h[1]!.length as 1 | 2 | 3 };
  if (/^[-*+]$/.test(prefix)) return { kind: 'ul' };
  if (/^\d+\.$/.test(prefix)) return { kind: 'ol' };
  if (/^>$/.test(prefix)) return { kind: 'quote' };
  return null;
}

/** `---` / `***` / `___` alone on a line → a horizontal rule (matched on Enter). */
export function isHrLine(line: string): boolean {
  return /^(---|\*\*\*|___)$/.test(line.trim());
}

/** The HTML block tag for a block match (heading level → H1..H3). */
export function blockTag(b: BlockMatch): string {
  if (b.kind === 'heading') return 'H' + b.level;
  if (b.kind === 'quote') return 'BLOCKQUOTE';
  return b.kind === 'ul' ? 'UL' : 'OL';
}
