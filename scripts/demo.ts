// Demo: run the full pipeline on the real Aldric fixture and print Roll20 commands.
import fixture from "../test/fixtures/aldric-144074405.json" assert { type: "json" };
import { rollFrom } from "../src/pipeline.js";
import type { CharacterData, RollRequest } from "../src/pipeline.js";
import { writeFileSync } from "node:fs";

const data = (fixture as any).data as CharacterData;

const jobs: { label: string; req: RollRequest; toggles?: string[] }[] = [
  { label: "Perception (advantage)", req: { kind: "skill", key: "perception", advantage: "advantage" } },
  { label: "Investigation (normal)", req: { kind: "skill", key: "investigation" } },
  { label: "CON save (normal)", req: { kind: "save", key: "CON" } },
  { label: "CON save + Bless", req: { kind: "save", key: "CON" }, toggles: ["effects-bless"] },
  { label: "Initiative", req: { kind: "initiative" } },
];

const out: Record<string, string> = {};
for (const j of jobs) {
  const r = rollFrom(data, j.req, j.toggles ?? []);
  out[j.label] = r.command;
  console.log(`\n# ${j.label}`);
  console.log(r.command);
}
writeFileSync(process.env.CMD_OUT || "/tmp/commands.json", JSON.stringify(out, null, 2));
console.log("\n(wrote commands to", process.env.CMD_OUT || "/tmp/commands.json", ")");
