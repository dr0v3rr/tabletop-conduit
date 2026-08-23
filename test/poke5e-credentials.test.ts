import { describe, it, expect } from "vitest";
import { setPoke5eCredentials, getPoke5eCredentials } from "../src/poke5e/source";

// Build a syntactically valid (unsigned) JWT with the given claims.
const b64url = (o: unknown) =>
  (globalThis as any).Buffer.from(JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;

const ROTATED_URL = "https://newref00000abc.supabase.co";
const anonKey = jwt({ iss: "supabase", ref: "newref00000abc", role: "anon", iat: 1, exp: 9 });
const serviceKey = jwt({ iss: "supabase", ref: "newref00000abc", role: "service_role", iat: 1, exp: 9 });

describe("poke5e credential auto-detection", () => {
  it("starts on the baked-in anon default (poke5e.app or supabase.co host)", () => {
    const c = getPoke5eCredentials();
    expect(c.url).toMatch(/^https:\/\/([a-z0-9-]+\.)?(poke5e\.app|supabase\.co)$/);
    expect(c.anonKey.split(".")).toHaveLength(3);
  });

  it("adopts a rotated anon key + endpoint detected from the site", () => {
    expect(setPoke5eCredentials({ url: ROTATED_URL, anonKey })).toBe(true);
    expect(getPoke5eCredentials()).toEqual({ url: ROTATED_URL, anonKey });
  });

  it("no-ops when the same credentials are seen again", () => {
    expect(setPoke5eCredentials({ url: ROTATED_URL, anonKey })).toBe(false);
  });

  it("accepts the poke5e custom API domain (endpoint move)", () => {
    expect(setPoke5eCredentials({ url: "https://api.poke5e.app/rest/v1/rpc/get_trainer" })).toBe(true);
    expect(getPoke5eCredentials().url).toBe("https://api.poke5e.app");
  });

  it("REFUSES a service_role (elevated) key — never escalates", () => {
    const before = getPoke5eCredentials().anonKey;
    expect(setPoke5eCredentials({ anonKey: serviceKey })).toBe(false);
    expect(getPoke5eCredentials().anonKey).toBe(before);
  });

  it("refuses a malformed token", () => {
    const before = getPoke5eCredentials().anonKey;
    expect(setPoke5eCredentials({ anonKey: "not-a-jwt" })).toBe(false);
    expect(getPoke5eCredentials().anonKey).toBe(before);
  });

  it("refuses a non-Supabase endpoint", () => {
    const before = getPoke5eCredentials().url;
    expect(setPoke5eCredentials({ url: "https://evil.example.com" })).toBe(false);
    expect(getPoke5eCredentials().url).toBe(before);
  });

  it("ignores empty / missing input", () => {
    const before = getPoke5eCredentials();
    expect(setPoke5eCredentials({})).toBe(false);
    expect(getPoke5eCredentials()).toEqual(before);
  });
});
