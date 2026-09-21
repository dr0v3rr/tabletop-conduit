import { describe, it, expect } from 'vitest';
import { matchInline, matchBlock, isHrLine, blockTag } from '../src/notebook/markdown';

describe('notebook markdown — inline', () => {
  it('inline code: `ahasdf`', () => {
    expect(matchInline('`ahasdf`')).toEqual({ remove: 8, tag: 'code', text: 'ahasdf' });
  });
  it('inline code mid-line uses only the trailing run', () => {
    expect(matchInline('run `npm test`')).toEqual({ remove: 10, tag: 'code', text: 'npm test' });
  });
  it('bold **hi**', () => {
    expect(matchInline('say **hi**')).toEqual({ remove: 6, tag: 'b', text: 'hi' });
  });
  it('italic _yo_ at a word boundary (does not eat the boundary char)', () => {
    expect(matchInline('a _yo_')).toEqual({ remove: 4, tag: 'i', text: 'yo' });
    expect(matchInline('_yo_')).toEqual({ remove: 4, tag: 'i', text: 'yo' });
  });
  it('does NOT italicise snake_case', () => {
    expect(matchInline('foo_bar_')).toBeNull();
  });
  it('no trailing marker → null', () => {
    expect(matchInline('plain text')).toBeNull();
    expect(matchInline('`unclosed')).toBeNull();
  });
});

describe('notebook markdown — block', () => {
  it('headings #, ##, ###', () => {
    expect(matchBlock('#')).toEqual({ kind: 'heading', level: 1 });
    expect(matchBlock('##')).toEqual({ kind: 'heading', level: 2 });
    expect(matchBlock('###')).toEqual({ kind: 'heading', level: 3 });
    expect(matchBlock('####')).toBeNull(); // 4+ is not a heading marker
  });
  it('bullet / ordered / quote', () => {
    expect(matchBlock('-')).toEqual({ kind: 'ul' });
    expect(matchBlock('*')).toEqual({ kind: 'ul' });
    expect(matchBlock('1.')).toEqual({ kind: 'ol' });
    expect(matchBlock('12.')).toEqual({ kind: 'ol' });
    expect(matchBlock('>')).toEqual({ kind: 'quote' });
  });
  it('block markers fire only at line start (prefix === marker)', () => {
    expect(matchBlock('a #')).toBeNull();
    expect(matchBlock('text -')).toBeNull();
  });
  it('blockTag maps correctly', () => {
    expect(blockTag({ kind: 'heading', level: 2 })).toBe('H2');
    expect(blockTag({ kind: 'quote' })).toBe('BLOCKQUOTE');
    expect(blockTag({ kind: 'ul' })).toBe('UL');
  });
});

describe('notebook markdown — hr', () => {
  it('--- / *** / ___ are horizontal rules', () => {
    expect(isHrLine('---')).toBe(true);
    expect(isHrLine('***')).toBe(true);
    expect(isHrLine('___')).toBe(true);
  });
  it('shorter/other lines are not', () => {
    expect(isHrLine('--')).toBe(false);
    expect(isHrLine('- item')).toBe(false);
  });
});
