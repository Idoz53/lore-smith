import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeDecisionFlows, decisionFlowStatus } from "../scripts/decision-flow-runtime.js";
import { getTacticalProfile, tacticalOptionScore, tacticalDecisionCoverage } from "../scripts/tactical-profiles.js";

const data = JSON.parse(fs.readFileSync(new URL("../data/ai-decision-flowcharts.json", import.meta.url), "utf8"));
await initializeDecisionFlows({ data });
assert.equal(decisionFlowStatus().classes, 29, "all class flowcharts should load");
for (const classSlug of Object.keys(data.classes)) {
  assert.equal(getTacticalProfile(actorFor(classSlug)).flow?.id, `class-${classSlug}`, `${classSlug} should receive its class flow`);
}

function actorFor(className, states = []) {
  return {
    items: [
      { type: "class", name: className, slug: className.toLowerCase() },
      ...states.map((name) => ({ type: "effect", name })),
    ],
    conditions: [],
  };
}

assert.equal(getTacticalProfile({ items: [], conditions: [] }).generalFlow?.id, "general-tactical-ai", "classless NPCs should still use the shared flow");

function option(name, properties = {}) {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    kind: "ability",
    traits: [],
    description: "",
    costs: [1],
    range: 5,
    conditions: [],
    conditionOperations: [],
    ...properties,
  };
}

function score(profile, candidate, context = {}) {
  return tacticalOptionScore(profile, candidate, {
    actor: context.actor,
    combatants: context.combatants ?? [],
    available: context.available ?? [],
    target: context.target ?? null,
    round: 1,
    remainingUses: null,
    actionsRemaining: context.actionsRemaining ?? 3,
    mapPenalty: context.mapPenalty ?? 0,
  });
}

const swashActor = { actor: actorFor("Swashbuckler"), team: "party", hp: 30, maxHp: 30, conditions: new Map() };
const swash = getTacticalProfile(swashActor.actor);
const tumble = option("Tumble Through", { kind: "skill" });
const finisher = option("Confident Finisher", { kind: "strike", attackTrait: true, damage: "2d6" });
assert.ok(score(swash, tumble, { actor: swashActor }) > score(swash, finisher, { actor: swashActor }), "a swashbuckler without Panache should prefer gaining it");
swashActor.conditions.set("panache", 1);
assert.ok(score(swash, finisher, { actor: swashActor }) > score(swash, tumble, { actor: swashActor }), "a swashbuckler with Panache should prefer a finisher");

const clericActor = { actor: actorFor("Cleric"), team: "party", hp: 30, maxHp: 30, conditions: new Map() };
const dyingAlly = { actor: actorFor("Fighter"), team: "party", hp: 0, maxHp: 30, conditions: new Map([["dying", 1]]) };
const cleric = getTacticalProfile(clericActor.actor);
const heal = option("Heal", { kind: "spell", healing: "2d8+16", range: 30 });
const stabilize = option("Stabilize", { kind: "spell", range: 30 });
const rescueContext = { actor: clericActor, combatants: [clericActor, dyingAlly], target: dyingAlly, available: [heal, stabilize] };
assert.ok(score(cleric, heal, rescueContext) > score(cleric, stabilize, rescueContext), "healing a dying ally should beat Stabilize when healing is available");

const rangerActor = { actor: actorFor("Ranger"), team: "party", hp: 30, maxHp: 30, conditions: new Map() };
const huntedTarget = { actor: actorFor("Fighter", ["Hunted Prey"]), team: "enemy", hp: 30, maxHp: 30, ac: 18, conditions: new Map() };
const ranger = getTacticalProfile(rangerActor.actor);
const huntPrey = option("Hunt Prey");
const rangerStrike = option("Longbow Strike", { kind: "strike", attackTrait: true, attack: 12, damage: "1d8", range: 100 });
assert.ok(score(ranger, rangerStrike, { actor: rangerActor, target: huntedTarget }) > score(ranger, huntPrey, { actor: rangerActor, target: huntedTarget }), "Hunt Prey should not be repeated on an already hunted target");

const fighterActor = { actor: actorFor("Fighter"), team: "party", hp: 30, maxHp: 30, conditions: new Map() };
const fighter = getTacticalProfile(fighterActor.actor);
const target = { actor: actorFor("Barbarian"), team: "enemy", hp: 40, maxHp: 40, ac: 22, conditions: new Map() };
assert.ok(score(fighter, rangerStrike, { actor: fighterActor, target, mapPenalty: 0 }) > score(fighter, rangerStrike, { actor: fighterActor, target, mapPenalty: 10 }), "a poor third MAP attack should be strongly discouraged");

const coverage = tacticalDecisionCoverage(swash, [tumble, finisher]);
assert.equal(coverage.classFlow, "class-swashbuckler");
assert.ok(coverage.matchedTags.includes("finisher"));
assert.ok(coverage.matchedTags.includes("tumble"));

console.log("Decision-flow runtime checks passed for 29 classes.");
