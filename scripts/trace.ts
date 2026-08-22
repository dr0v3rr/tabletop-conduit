import fixture from "../test/fixtures/aldric-144074405.json" assert { type: "json" };
import { computeRollModel } from "../src/engine/index.js";
import { resolveEffects } from "../src/rules/index.js";
import { rollFrom } from "../src/pipeline.js";
import type { RollRequest } from "../src/pipeline.js";

const data: any = (fixture as any).data;
const model = computeRollModel(data);
const req: RollRequest = { kind: "save", key: "CON" };
console.log("resolveEffects(effects-bless):", JSON.stringify(resolveEffects(data, model, req, ["effects-bless"])));
console.log("\nCON save + Bless command:");
console.log(rollFrom(data, req, ["effects-bless"]).command);
console.log("\nAttack + Bless command:");
console.log(rollFrom(data, { kind: "attack", key: "test" }, ["effects-bless"]).command);
