import { describe, it, expect } from 'vitest';
import {
  isAllowedTag, isDroppedTag, isSafeHref, isSafeImgSrc, keptClasses,
} from '../src/notebook/sanitize';

// The sanitizer is an ALLOWLIST: it keeps only known-good tags and a validated handful of
// attributes, so there is no code-execution sink to smuggle a string into. These tests pin the
// security-critical decisions (the DOM walk is thin glue over them). Obfuscation / string-concat
// bypasses target blocklist filters; they can't defeat "reject everything not explicitly allowed".

describe('sanitizer — link scheme allowlist (obfuscation-resistant)', () => {
  it('accepts http/https/mailto only', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://x')).toBe(true);
    expect(isSafeHref('mailto:a@b.co')).toBe(true);
    expect(isSafeHref('  HTTPS://x  ')).toBe(true); // trimmed + case-insensitive
  });
  it('rejects javascript: — plain, string-concat, mixed-case, whitespace-obfuscated', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref("javascript:('ale'+'rt')(1)")).toBe(false); // concat inside the URL is irrelevant
    expect(isSafeHref('jAvAsCrIpT:alert(1)')).toBe(false);
    expect(isSafeHref('\tjavascript:alert(1)')).toBe(false);
    expect(isSafeHref('java\tscript:alert(1)')).toBe(false);
  });
  it('rejects data:, vbscript:, and other non-navigational schemes', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHref('file:///etc/passwd')).toBe(false);
  });
});

describe('sanitizer — image src allowlist (no remote beacons)', () => {
  it('keeps only inline data:image/*', () => {
    expect(isSafeImgSrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeImgSrc('data:image/jpeg;base64,ZZZ')).toBe(true);
  });
  it('rejects remote URLs (tracking) and non-image data URLs', () => {
    expect(isSafeImgSrc('https://evil.example/track.png')).toBe(false);
    expect(isSafeImgSrc('http://evil/x')).toBe(false);
    expect(isSafeImgSrc('data:text/html,<script>1</script>')).toBe(false);
    expect(isSafeImgSrc('javascript:alert(1)')).toBe(false);
  });
});

describe('sanitizer — tag allow/deny', () => {
  it('allows formatting/structure tags', () => {
    for (const t of ['B', 'I', 'CODE', 'H2', 'UL', 'LI', 'BLOCKQUOTE', 'A', 'IMG', 'HR']) expect(isAllowedTag(t)).toBe(true);
  });
  it('drops code/resource/embed/form/media tags with their subtree', () => {
    for (const t of ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'SVG', 'VIDEO', 'LINK', 'META']) expect(isDroppedTag(t)).toBe(true);
  });
  it('unknown tags are neither allowed nor dropped (→ unwrapped, text kept)', () => {
    expect(isAllowedTag('MARQUEE')).toBe(false);
    expect(isDroppedTag('MARQUEE')).toBe(false);
    expect(isAllowedTag('FONT')).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(isDroppedTag('script')).toBe(true);
    expect(isAllowedTag('code')).toBe(true);
  });
});

describe('sanitizer — class filter', () => {
  it('keeps only nb-img, drops attacker-supplied classes', () => {
    expect(keptClasses('nb-img')).toBe('nb-img');
    expect(keptClasses('nb-img sneaky evil')).toBe('nb-img');
    expect(keptClasses('foo bar')).toBe('');
  });
});
