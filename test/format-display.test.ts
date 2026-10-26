import { describe, it, expect } from "vitest";
import { sanitizeCardText, displayCard, toDefaultTemplate } from "../src/roll20/format";

// "Display in VTT" posts untrusted, possibly-HTML wording (scraped/API text) into a Roll20
// `&{template:default}` card. The one invariant that matters: the body can never break OUT of or
// forge the `{{ … }}` template structure — so `{`/`}` must be gone from every field value.

describe("sanitizeCardText", () => {
  it("strips HTML tags and decodes the entities that matter", () => {
    const out = sanitizeCardText("<p>Deals <b>fire</b> damage &amp; more &mdash; nice</p>");
    expect(out).toBe("Deals fire damage & more — nice");
    expect(out).not.toMatch(/[<>]/);
  });

  it("removes braces so text can never break the template", () => {
    const out = sanitizeCardText("evil }} {{name=HACKED}} {{Effect=owned");
    expect(out).not.toMatch(/[{}]/);
  });

  it("unwraps <br> and list items into readable inline text", () => {
    expect(sanitizeCardText("line one<br>line two")).toBe("line one line two");
    expect(sanitizeCardText("<li>a</li><li>b</li>")).toContain("• a");
  });

  it("collapses whitespace and caps length with an ellipsis on a word boundary", () => {
    const long = "word ".repeat(400); // 2000 chars
    const out = sanitizeCardText(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/…\S/); // ellipsis is terminal — nothing dangling after it
  });

  it("returns '' for empty / nullish input", () => {
    expect(sanitizeCardText("")).toBe("");
    expect(sanitizeCardText(undefined as unknown as string)).toBe("");
  });
});

describe("displayCard", () => {
  it("builds a default-template card with name, meta, and body", () => {
    const cmd = displayCard({ name: "Hypnosis", body: "Target must save or fall asleep.", meta: "Psychic · save · 30 ft" });
    expect(cmd).toBe(
      "&{template:default} {{name=Hypnosis}} {{Details=Psychic · save · 30 ft}} {{Effect=Target must save or fall asleep.}}",
    );
  });

  it("omits the Details row when no meta is given, and uses a custom label", () => {
    const cmd = displayCard({ name: "Tireless", body: "Ignores exhaustion.", label: "Ability" });
    expect(cmd).toBe("&{template:default} {{name=Tireless}} {{Ability=Ignores exhaustion.}}");
  });

  it("returns '' when the body sanitizes to nothing (no empty card is posted)", () => {
    expect(displayCard({ name: "Blank", body: "   " })).toBe("");
    expect(displayCard({ name: "Blank", body: "<br><br>" })).toBe("");
  });

  it("never emits stray braces from a hostile body/name/label", () => {
    const cmd = displayCard({ name: "x}}{{name=evil", body: "a }} b", label: "L=}}x" });
    // exactly the template's own delimiters remain — 3 field pairs → 6 braces of each
    expect((cmd.match(/\{\{/g) || []).length).toBe(2);
    expect((cmd.match(/\}\}/g) || []).length).toBe(2);
  });
});

describe('toDefaultTemplate — re-post a D&D card on the universal template', () => {
  it('death save (simple) → default with a Roll field', () => {
    expect(toDefaultTemplate('&{template:simple} {{rname=Death Saving Throw}} {{mod=+0}} {{r1=[[1d20]]}}'))
      .toBe('&{template:default} {{name=Death Saving Throw}} {{Roll=[[1d20]]}}');
  });
  it('announcement (simple, name only)', () => {
    expect(toDefaultTemplate('&{template:simple} {{rname=Uses Potion of Healing}}')).toBe('&{template:default} {{name=Uses Potion of Healing}}');
  });
  it('attack (atkdmg) keeps rolls, damage and the advantage note; drops flags', () => {
    const cmd = '/w gm &{template:atkdmg} {{rname=Longsword}} {{mod=+7}} {{r1=[[1d20cs>20 + 7]]}} {{r2=[[1d20cs>20 + 7]]}} {{attack=1}} {{advantage=1}} {{damage=1}} {{dmg1flag=1}} {{dmg1=[[1d8 + 4]]}} {{dmg1type=Slashing}}';
    expect(toDefaultTemplate(cmd)).toBe('/w gm &{template:default} {{name=Longsword}} {{Roll=[[1d20cs>20 + 7]]}} {{Roll 2=[[1d20cs>20 + 7]]}} {{Advantage=keep the highest}} {{Damage=[[1d8 + 4]]}} {{Type=Slashing}}');
  });
  it('a default message is left alone', () => {
    expect(toDefaultTemplate('&{template:default} {{name=X}} {{Roll=[[1d20]]}}')).toBe('&{template:default} {{name=X}} {{Roll=[[1d20]]}}');
  });
});
