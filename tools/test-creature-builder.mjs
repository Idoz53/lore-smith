import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { creatureTableRow, safeItemGuidance } from "../scripts/building-creatures-data.js";
import { cloneCreatureItems, creatureHpAfterMaximum, creatureScalePlan, creatureOffenseReview, creatureDamageAverage } from "../scripts/creature-builder-support.js";

let id = 0;
const sourceItems = [
  { _id: "entry", name: "Prepared", type: "spellcastingEntry", system: { slots: { slot1: { prepared: [{ id: "spell", expended: true }], value: 1, max: 2 } } } },
  { _id: "spell", name: "Spell", type: "spell", system: { location: { value: "entry", heightenedLevel: 3 }, description: { value: "@UUID[Actor.old.Item.entry]" } } },
  { _id: "bag", type: "backpack", system: {} },
  { _id: "sword", type: "weapon", system: { containerId: "bag" }, flags: { pf2e: { grantedBy: { id: "spell" } } } },
];
const copied = cloneCreatureItems(sourceItems, () => `new${++id}`, "Actor.old", "Actor.new");
assert.equal(copied[1].system.location.value, copied[0]._id);
assert.equal(copied[0].system.slots.slot1.prepared[0].id, copied[1]._id);
assert.equal(copied[0].system.slots.slot1.prepared[0].expended, true);
assert.equal(copied[3].system.containerId, copied[2]._id);
assert.equal(copied[3].flags.pf2e.grantedBy.id, copied[1]._id);
assert.equal(copied[1].system.description.value, `@UUID[Actor.new.Item.${copied[0]._id}]`);
assert.equal(sourceItems[1].system.location.value, "entry", "Cloning never edits the source.");
assert.equal(creatureHpAfterMaximum({ max: 80, value: 43 }, 80), 43);
assert.equal(creatureHpAfterMaximum({ max: 80, value: 43 }, 100), 63);
assert.equal(creatureHpAfterMaximum({ max: 80, value: 43 }, 30), 0);
assert.equal(creatureHpAfterMaximum({ max: 80, value: 0 }, 100), 0);

const fixture = {
  system: { details: { level: { value: 4 } }, attributes: { ac: { value: creatureTableRow("armorClass", 4)[1] }, hp: { max: Math.round(creatureTableRow("hitPoints", 4)[1].reduce((a, b) => a + b) / 2), value: 20 } }, perception: { mod: 987 }, saves: {}, abilities: {}, skills: {} },
  items: [
    { _id: "casting", name: "Arcane", type: "spellcastingEntry", system: { spelldc: { dc: creatureTableRow("spell", 4)[2], value: creatureTableRow("spell", 4)[3] } } },
    { _id: "custom", name: "Custom", type: "spellcastingEntry", system: { spelldc: { dc: creatureTableRow("spell", 4)[2], value: creatureTableRow("spell", 4)[3] } }, flags: { "lore-smith": { creatureDamageLink: { kind: "spellcasting", dcTier: "custom" } } } },
  ],
};
const plan = creatureScalePlan(fixture, 8);
assert.equal(plan.actorUpdate["system.attributes.ac.value"], creatureTableRow("armorClass", 8)[1]);
assert.equal(plan.actorUpdate["system.perception.mod"], undefined, "Custom core statistics stay unchanged.");
assert.equal(plan.itemUpdates.find((entry) => entry._id === "casting")["system.spelldc.dc"], creatureTableRow("spell", 8)[2]);
assert.equal(plan.itemUpdates.find((entry) => entry._id === "custom"), undefined, "Explicitly custom spell statistics stay custom even if they match a benchmark.");
assert.equal(plan.actorUpdate["system.attributes.hp.max"] - plan.actorUpdate["system.attributes.hp.value"], fixture.system.attributes.hp.max - 20);
assert.equal(creatureDamageAverage("2d8+7 (16)"), 16);
assert.equal(creatureDamageAverage("2d6+1d4-2"), 7.5);
assert.equal(creatureDamageAverage("@actor.level+2"), null);
const offense = creatureOffenseReview({ system: fixture.system, items: [
  { id: "strike", name: "Overloaded", type: "melee", system: { bonus: { value: 99 }, damageRolls: { a: { damage: "10d12", damageType: "fire" }, b: { damage: "10d12", damageType: "cold" } } } },
  { id: "orphan", name: "Unassigned spell", type: "spell", system: { level: { value: 9 }, location: { value: "missing" } } },
] });
assert.ok(offense.issues.some((issue) => issue.text.includes("130 average")));
assert.ok(offense.issues.some((issue) => issue.text.includes("no valid spellcasting")));
assert.ok(offense.issues.some((issue) => issue.text.includes("rank 9")));

const notices = [];
const sandbox = {
  console, structuredClone, creatureTableRow, safeItemGuidance, cloneCreatureItems, creatureHpAfterMaximum, creatureScalePlan, creatureOffenseReview,
  foundry: { applications: { api: { ApplicationV2: class { async render() {} }, HandlebarsApplicationMixin: (Base) => Base, DialogV2: { confirm: async () => true } } }, utils: { randomID: () => `id${++id}`, deepClone: structuredClone, mergeObject: (left, right) => ({ ...left, ...right }) } },
  TextEditor: { enrichHTML: async (value) => value },
  CONFIG: { PF2E: {} }, game: { i18n: { localize: (value) => value } },
  ui: { notifications: { warn: (message) => notices.push(message), info() {}, error: (message) => { throw Error(message); } } },
  lsEscapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
};
vm.createContext(sandbox);
const native = (await readFile(new URL("../scripts/native-workflows.js", import.meta.url), "utf8")).split("const LS_PHYSICAL_ITEM_TYPES")[0].replace(/^import .*;\r?\n/gm, "");
vm.runInContext(`${native}\nglobalThis.api={ LoreSmithCreatureBuilder,lsAbilityDescription,lsRecalculateLinkedCreatureEntries,lsCreatureFinalPreview };`, sandbox);
const { LoreSmithCreatureBuilder: Builder, lsAbilityDescription: describe, lsRecalculateLinkedCreatureEntries: recalculate, lsCreatureFinalPreview: preview } = sandbox.api;
const ability = { kind: "ability", damageTier: "custom", customDamage: "2d6", damageType: "fire", dcTier: "custom", customDc: 20, save: "reflex", delivery: "target", saveMode: "basic", condition: "frightened", conditionValue: 1, conditionResult: "criticalFailure" };
assert.match(describe(ability, 4), /@Check\[reflex\|dc:20\|basic\]/);
assert.match(describe(ability, 4), /On critical failure/);
const explicit = describe({ ...ability, saveMode: "degrees", outcomes: { criticalSuccess: "No effect", success: "Half damage", failure: "Full damage", criticalFailure: "<img onerror=alert(1)>" } }, 4);
assert.match(explicit, /@Check\[reflex\|dc:20\]/);
assert.doesNotMatch(explicit, /\|basic/);
assert.match(explicit, /&lt;img/);
assert.match(explicit, /<strong>Critical Failure<\/strong>/);

const setPath = (target, path, value) => { const parts = path.split("."); const last = parts.pop(); let node = target; for (const key of parts) node = node[key] ??= {}; node[last] = value; };
const makeActor = (source = {}) => {
  const actor = { name: "Test NPC", uuid: "Actor.test", _source: structuredClone(source), system: structuredClone(source.system ?? {}), items: [], getFlag() { return null; }, async setFlag() {}, async update(values) { for (const [key, value] of Object.entries(values)) { setPath(this, key, value); setPath(this._source, key, value); } }, async updateEmbeddedDocuments(_type, values) { this.embeddedUpdates = values; }, async createEmbeddedDocuments(_type, values, options) { this.created = values; this.createOptions = options; return values.map((item) => ({ ...item, id: item._id ?? `created${++id}` })); }, async deleteEmbeddedDocuments() {} };
  actor.items.get = (key) => actor.items.find((item) => item.id === key);
  return actor;
};
const hpActor = makeActor({ system: { attributes: { hp: { max: 80, value: 43 } }, skills: {} } });
const fields = new Map([["hp", { value: "80" }]]);
const root = { querySelector(selector) { return fields.get(selector.match(/name="([^"]+)"/)?.[1]) ?? null; }, querySelectorAll() { return []; } };
await Builder.prototype.saveStep.call({ actor: hpActor, step: 3, element: root });
assert.equal(hpActor.system.attributes.hp.value, 43, "Saving stats preserves injury.");

const casting = { id: "entry", type: "spellcastingEntry", getFlag: () => ({ kind: "spellcasting", dcTier: "high", autoScale: true }) };
const linked = makeActor(); linked.items.push(casting);
await recalculate(linked, 10);
assert.equal(linked.embeddedUpdates[0]["system.spelldc.dc"], creatureTableRow("spell", 10)[2]);

const oldAbility = { id: "ability", type: "action", async update(update) { this.saved = update; } };
const actor = makeActor({ system: { details: { level: { value: 4 } } } }); actor.items.push(oldAbility);
const values = { abilityName: "Frightful Howl", abilityDamageTier: "none", abilityUsage: "action", abilitySave: "will", abilitySaveMode: "degrees", abilityCriticalSuccess: "No effect", abilitySuccess: "No effect", abilityFailure: "Frightened 1", abilityCriticalFailure: "Frightened 2" };
const form = { querySelector(selector) { const key = selector.match(/name="([^"]+)"/)?.[1]; return key ? { value: values[key] ?? "", checked: key === "abilityAutoScale" } : null; } };
const app = { actor, element: form, editingAbility: "ability", async render() {} };
await Builder.createLinkedAbility.call(app);
assert.equal(oldAbility.saved?.name, "Frightful Howl");
assert.equal(actor.created, undefined, "Editing updates the existing entry rather than creating a duplicate.");
assert.equal(oldAbility.saved["system.description.value"].includes("|basic"), false);
assert.equal(oldAbility.saved["system.rules"], undefined, "Editing preserves any native rules on the item.");
assert.equal(app.editingAbility, null);
console.log("Creature builder checks passed: item references, damage preservation, benchmark rescale, spellcasting, custom outcomes, edit-in-place, offensive review.");
