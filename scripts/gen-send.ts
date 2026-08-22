// Produce page-context send expressions from the full pipeline, for live injection.
import fixture from "../test/fixtures/aldric-144074405.json" assert { type: "json" };
import { rollFrom } from "../src/pipeline.js";
import type { CharacterData, RollRequest } from "../src/pipeline.js";
import { buildSendExpression } from "../src/roll20/inject.js";
import { writeFileSync } from "node:fs";

const data = (fixture as any).data as CharacterData;
const jobs: { label: string; req: RollRequest; toggles?: string[] }[] = [
  { label: "Aldric: Perception (advantage)", req: { kind: "skill", key: "perception", advantage: "advantage" } },
  { label: "Aldric: CON Save + Bless", req: { kind: "save", key: "CON" }, toggles: ["effects-bless"] },
];

const out: Record<string, { command: string; expr: string }> = {};
for (const j of jobs) {
  const r = rollFrom(data, j.req, j.toggles ?? []);
  out[j.label] = { command: r.command, expr: buildSendExpression(r.command, r.request.speakingAs) };
}
writeFileSync(process.env.OUT!, JSON.stringify(out, null, 2));
console.log("wrote", Object.keys(out).length, "send expressions to", process.env.OUT);
for (const [k, v] of Object.entries(out)) console.log(`\n# ${k}\n${v.command}`);
