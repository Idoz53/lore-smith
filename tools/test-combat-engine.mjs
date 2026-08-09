import assert from "node:assert/strict";

globalThis.document = {
  createElement() {
    return {
      _html: "",
      textContent: "",
      set innerHTML(value) {
        this._html = String(value);
        this.textContent = this._html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      },
      get innerHTML() { return this._html; },
    };
  },
};
const rollMessages = [];
globalThis.Roll = class TestRoll {
  static replaceFormulaData(formula) { return formula; }
  constructor(formula) {
    this.formula = formula;
    this.total = 15;
    this.dice = [{ total: 10 }];
    this.terms = this.dice;
  }
  async evaluate() { return this; }
  async toMessage(data, options) { rollMessages.push({ data, options }); }
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor: speakerActor }) => ({ alias: speakerActor?.name ?? "Tester" }),
  getWhisperRecipients: () => [{ id: "gm" }],
};
globalThis.CONFIG = { PF2E: { damageTypes: {} } };
globalThis.game = { pf2e: { actions: new Map(), ConditionManager: { getCondition: () => null } } };

const { actionTargets, buildActionCatalog, checkDegree, chooseAction } = await import("../scripts/combat-engine.js");
const { consumeNativeResource, resolveModeledCheckWithRoll } = await import("../scripts/simulation-adapters.js");

function item(overrides = {}) {
  const result = {
    id: crypto.randomUUID(),
    name: "Anonymous mechanic",
    type: "action",
    system: {
      actionType: { value: "action" },
      actions: { value: 1 },
      description: { value: "" },
      traits: { value: [] },
      damage: {},
      ...overrides.system,
    },
    ...overrides,
  };
  return result;
}

function actor(items) {
  const result = {
    id: crypto.randomUUID(),
    type: "npc",
    items,
    system: {
      actions: [],
      details: { level: { value: 3 } },
      attributes: { classDC: { mod: 10, dc: 20 }, hp: { value: 20, max: 30 } },
    },
    spellcasting: new Map(),
  };
  for (const owned of items) owned.actor = result;
  return result;
}

const selfEffectAction = item({
  system: {
    actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, damage: {},
    selfEffect: { name: "Effect: Anonymous", uuid: "Compendium.pf2e.bestiary-effects.Item.Anonymous" },
    description: { value: "<p><strong>Requirements</strong> The creature has taken damage and is neither @UUID[Compendium.pf2e.conditionitems.Item.Fatigued] nor already empowered. <strong>Effect</strong> The creature gains bonuses. Afterward it is fatigued.</p>" },
  },
});
const selfOption = buildActionCatalog(actor([selfEffectAction])).find((option) => option.item === selfEffectAction);
assert.equal(selfOption.targetMode, "self");
assert.equal(selfOption.selfEffect.name, "Effect: Anonymous");
assert.deepEqual(selfOption.conditions, []);
assert.equal(selfOption.requirements.requiresDamageTaken, true);
assert.deepEqual(selfOption.requirements.forbiddenConditions, ["fatigued"]);

const removingSpell = item({
  type: "spell",
  name: "Condition removal",
  system: {
    time: { value: "2" }, target: { value: "1 dying creature" }, range: { value: "30 feet" },
    traits: { value: ["cantrip", "healing"] }, damage: {}, location: { value: "entry" },
    description: { value: "<p>The target loses the @UUID[Compendium.pf2e.conditionitems.Item.Dying] condition, though it remains @UUID[Compendium.pf2e.conditionitems.Item.Unconscious] at 0 Hit Points.</p>" },
  },
});
const removingOption = buildActionCatalog(actor([removingSpell])).find((option) => option.item === removingSpell);
assert.equal(removingOption.targetMode, "ally");
assert.equal(removingOption.targetRequirement, "dying");
assert.deepEqual(removingOption.conditionOperations.map(({ operation, slug }) => ({ operation, slug })), [{ operation: "remove", slug: "dying" }]);
assert.equal(removingOption.supportedResolution, true);

const proseOnly = item({
  type: "spell",
  system: {
    time: { value: "1" }, target: { value: "1 creature" }, range: { value: "30 feet" },
    traits: { value: ["cantrip"] }, damage: {}, location: { value: "entry" },
    description: { value: "<p>The target gains a bonus, then becomes temporarily immune. @UUID[Compendium.pf2e.spell-effects.Item.Effect One] @UUID[Compendium.pf2e.spell-effects.Item.Effect Two]</p>" },
  },
});
const proseOption = buildActionCatalog(actor([proseOnly])).find((option) => option.item === proseOnly);
assert.equal(proseOption.supportedResolution, false);
assert.equal(proseOption.coverage.status, "unsupported");

const castCalls = [];
const spell = item({
  type: "spell",
  isCantrip: true,
  system: {
    time: { value: "2" }, target: { value: "1 creature" }, range: { value: "60 feet" },
    traits: { value: ["cantrip", "attack"] }, damage: { 0: { formula: "2d4", kinds: ["damage"], type: "spirit" } },
    location: { value: "entry" }, level: { value: 0 }, description: { value: "" },
  },
});
const caster = actor([spell]);
caster.spellcasting.set("entry", { cast: async (...args) => castCalls.push(args), system: { prepared: { value: "prepared" }, slots: {} } });
const spellOption = buildActionCatalog(caster).find((option) => option.item === spell);
const castResult = await consumeNativeResource(spellOption, caster);
assert.equal(castResult.available, true);
assert.equal(castCalls.length, 1);
assert.deepEqual(castCalls[0][1], {
  rank: 0,
  slotId: undefined,
  consume: true,
  message: true,
  rollMode: "gmroll",
});
const isolatedCastResult = await consumeNativeResource(spellOption, caster, { isolated: true });
assert.equal(isolatedCastResult.available, true);
assert.equal(isolatedCastResult.source, "PF2e cantrip (isolated copy)");
assert.equal(castCalls.length, 2, "isolated casting should create a native PF2e Cast card");
assert.deepEqual(castCalls[1][1], {
  rank: 0,
  slotId: undefined,
  consume: false,
  message: true,
  rollMode: "gmroll",
}, "the isolated Cast card must never consume the actor's real spell resource");
let consumableUpdates = 0;
const consumable = item({
  type: "consumable",
  system: { quantity: 2, actionType: { value: "action" }, actions: { value: 1 }, traits: { value: [] }, damage: {} },
  async update() { consumableUpdates += 1; },
});
const isolatedConsumable = await consumeNativeResource({ item: consumable }, caster, { isolated: true });
assert.equal(isolatedConsumable.available, true);
assert.equal(isolatedConsumable.source, "PF2e consumable quantity (isolated copy)");
assert.equal(consumableUpdates, 0, "isolated item use must not decrement the real owned item");

const variableSpell = item({
  type: "spell",
  name: "Variable spell",
  system: {
    time: { value: "1 to 3" }, target: { value: "varies" }, range: { value: "varies" },
    traits: { value: ["healing"] }, damage: {}, location: { value: "entry" }, level: { value: 1 },
    description: { value: "" },
  },
});
const oneAction = item({
  id: variableSpell.id, type: "spell", name: "Variable spell (one action)", original: variableSpell,
  appliedOverlays: new Map([["override", "one"]]),
  system: { time: { value: "1" }, target: { value: "1 ally" }, range: { value: "touch" }, traits: { value: ["healing"] }, damage: { 0: { formula: "1d8", kinds: ["healing"] } }, location: { value: "entry" }, level: { value: 1 }, description: { value: "" } },
});
const threeAction = item({
  id: variableSpell.id, type: "spell", name: "Variable spell (three actions)", original: variableSpell,
  appliedOverlays: new Map([["override", "three"]]),
  system: { time: { value: "3" }, target: { value: "all allies" }, range: { value: "" }, area: { type: "emanation", value: 30 }, traits: { value: ["healing"] }, damage: { 0: { formula: "1d8", kinds: ["healing"] } }, location: { value: "entry" }, level: { value: 1 }, description: { value: "" } },
});
variableSpell.overlays = { overrideVariants: [oneAction, threeAction] };
const variantActor = actor([variableSpell]);
oneAction.actor = variantActor;
threeAction.actor = variantActor;
const variableOptions = buildActionCatalog(variantActor).filter((option) => option.item?.original === variableSpell);
assert.deepEqual(variableOptions.map((option) => option.costs), [[1], [3]]);
assert.deepEqual(variableOptions.map((option) => option.id), [`${variableSpell.id}:one`, `${variableSpell.id}:three`]);

const areaOption = { area: { type: "cone", value: 15 } };
const primaryTarget = { id: "inside", team: "enemy", defeated: false, hp: 10 };
const areaCombatants = [
  primaryTarget,
  { id: "also-inside", team: "enemy", defeated: false, hp: 20 },
  { id: "outside", team: "enemy", defeated: false, hp: 1 },
  { id: "ally", team: "party", defeated: false, hp: 1 },
];
assert.deepEqual(
  actionTargets(areaOption, primaryTarget, areaCombatants, (candidate) => candidate.id.includes("inside")).map((target) => target.id),
  ["inside", "also-inside"],
);

const modeledAttacker = { name: "Attacker", actor: { name: "Attacker" }, token: null };
const modeledTarget = { name: "Target", actor: { name: "Target" }, token: null };
const modeledCheck = await resolveModeledCheckWithRoll({
  option: { id: "save", name: "Save effect", save: "reflex", dc: 15 },
  attacker: modeledAttacker,
  target: modeledTarget,
  ac: () => 18,
  saveModifier: () => 5,
  checkDegree,
});
assert.equal(modeledCheck.total, 15);
assert.equal(modeledCheck.natural, 10);
assert.equal(modeledCheck.degree, 2);
assert.equal(rollMessages.at(-1).options.rollMode, "gmroll");
assert.deepEqual(rollMessages.at(-1).data.whisper, ["gm"]);

const strikeChoice = {
  id: "strike", name: "Longsword", kind: "strike", costs: [1], damage: "1d8+4",
  healing: null, conditions: [], conditionOperations: [], traits: [], range: 5,
  attackTrait: true, supportedResolution: true, utility: false, defensive: false,
  targetMode: "enemy", limitedUses: null,
};
const demoralizeChoice = {
  id: "demoralize", name: "Demoralize", kind: "skill", costs: [1], damage: null,
  healing: null, conditions: [{ slug: "frightened", value: 1 }], conditionOperations: [], traits: [], range: 30,
  attackTrait: false, supportedResolution: true, utility: true, defensive: false,
  targetMode: "enemy", limitedUses: null,
};
const raiseShieldChoice = {
  id: "raise-shield", name: "Raise a Shield", kind: "action", costs: [1], damage: null,
  healing: null, conditions: [], conditionOperations: [], selfEffect: { name: "Effect: Raise a Shield" }, traits: [], range: 0,
  attackTrait: false, supportedResolution: true, utility: true, defensive: true,
  targetMode: "self", limitedUses: null,
};
const tacticalActor = {
  id: "fighter", name: "Fighter", team: "party", hp: 30, maxHp: 30, defeated: false,
  actor: { items: [], system: { attributes: { ac: { value: 18 } } } },
  options: [strikeChoice, demoralizeChoice, raiseShieldChoice],
  uses: new Map(), cooldowns: new Map(), turnUses: new Set(), targetUses: new Set(), actionHistory: new Map(),
  conditions: new Map(), damageActionsThisTurn: 0, utilityActionsThisTurn: 0,
  profile: { roles: ["damage", "frontline"], prefer: ["strike"], avoid: [], healingThreshold: 0.6 },
};
const tacticalTarget = {
  id: "enemy", name: "Enemy", team: "enemy", hp: 30, maxHp: 30, ac: 18, defeated: false,
  actor: { items: [], system: { attributes: { ac: { value: 18 } } } }, conditions: new Map(),
};
assert.equal(chooseAction(tacticalActor, [tacticalActor, tacticalTarget], 3, 0, 1)?.option.id, "strike");
tacticalActor.utilityActionsThisTurn = 1;
assert.notEqual(chooseAction(tacticalActor, [tacticalActor, tacticalTarget], 2, 0, 1)?.option.id, "demoralize");

console.log("Lore Smith combat-engine regression tests passed.");
