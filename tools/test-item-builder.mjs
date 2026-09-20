import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as support from '../scripts/item-builder-support.js';

const flags = {
  schemaVersion: 2, generatedRules: [],
  activations: [{ id: 'ward', name: 'Ember Ward', type: 'action', actions: '1', traits: [], applyTo: 'self', durationUnit: 'minutes', durationValue: 1, frequencyMax: 2, frequencyPer: 'day', areaType: 'none' }],
  effects: [{ id: 'constant', kind: 'flat-modifier', selector: 'athletics', modifierType: 'item', value: 1 }, { id: 'temporary', activationId: 'ward', kind: 'resistance', damageType: 'fire', value: 5 }],
};
assert.equal(support.lsItemConstantRules(flags, 'Ward').length, 1);
assert.equal(support.lsItemConstantRules(flags, 'Ward')[0].key, 'FlatModifier');
assert.equal(support.lsItemConstantRules(flags, 'Ward')[0].requiresEquipped, true);
assert.equal(support.lsItemRule({ kind: 'damage-dice', selector: 'strike-damage', formula: '1d6+4' }), null);
assert.equal(support.lsItemRule({ kind: 'damage-dice', selector: 'strike-damage', formula: '2d6' }).diceNumber, 2);
assert.equal(support.lsItemDuration({ durationUnit: 'manual' }), null);
assert.equal(support.lsItemDuration({ durationUnit: 'rounds', durationValue: 0 }), null);
assert.equal(support.lsItemDuration({ durationUnit: 'encounter' }).unit, 'encounter');
assert.equal(support.lsPreserveItemDamage({ max: 20, value: 11 }, 30), 21);
assert.match(support.lsItemPriceGuidance({ type: 'consumable', system: { level: { value: 2 } } }).url, /2951$/);

let sequence = 0;
const notices = [];
const assign = (target, updates) => {
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split('.'); let next = target;
    while (parts.length > 1) next = next[parts.shift()] ??= {};
    next[parts[0]] = structuredClone(value);
  }
};
const actor = { uuid: 'Actor.test', name: 'Keeper', isOwner: true, items: [], combatant: { initiative: 17 },
  async createEmbeddedDocuments(_type, sources) { const created = sources.map(source => makeDocument(source, this)); this.items.push(...created); return created; },
  async updateEmbeddedDocuments(_type, updates) { for (const update of updates) await this.items.find(i => i.id === update._id).update(update); },
  async deleteEmbeddedDocuments(_type, ids) { this.items = this.items.filter(i => !ids.includes(i.id)); },
};
function makeDocument(source, parent = actor) {
  const data = structuredClone(source); data._id ??= `item${++sequence}`;
  return { id: data._id, uuid: `${parent.uuid}.Item.${data._id}`, actor: parent, isOwner: true, isEquipped: true, isInvested: true,
    get name() { return data.name; }, get type() { return data.type; }, get img() { return data.img; }, get system() { return data.system; },
    getFlag(scope, key) { return data.flags?.[scope]?.[key]; }, toObject() { return structuredClone(data); },
    async update(updates) { assign(data, updates); return this; },
    async delete() { parent.items = parent.items.filter(i => i !== this); },
    async setFlag(scope, key, value) { assign(data, { [`flags.${scope}.${key}`]: value }); },
  };
}
const item = makeDocument({ name: 'Ember Ward', type: 'equipment', img: '', system: { level: { value: 3 }, traits: { value: [], rarity: 'common' }, price: { value: { gp: 50 } }, rules: [], description: { value: 'Original text' } }, flags: { 'lore-smith': { itemBuilder: structuredClone(flags) } } });
const action = makeDocument({ name: 'Activate Ward', type: 'action', system: { frequency: { max: 2, value: 2 } }, flags: { 'lore-smith': { itemActivation: { sourceItemId: item.id, activationId: 'ward' } } } });
actor.items.push(item, action);
globalThis.game = { time: { worldTime: 100 }, user: { targets: new Set() }, i18n: { localize: s => s } };
globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => true } } } };
globalThis.ui = { notifications: { info: m => notices.push(['info', m]), error: m => notices.push(['error', m]) } };
assert.deepEqual(support.lsValidateItemBuilder(item, flags).errors, []);
const source = support.lsItemEffectSource(item, flags.activations[0], [flags.effects[1]]);
assert.equal(source.system.rules[0].key, 'Resistance');
assert.equal(source.system.rules.length, 1);
assert.equal(source.system.start.value, 100);
assert.equal(source.system.start.initiative, 17);
assert.equal(source.system.duration.unit, 'minutes');
const effect = await support.lsActivateBuiltItem(item, 'ward');
assert.equal(effect.type, 'effect');
assert.equal(action.system.frequency.value, 1);
await support.lsActivateBuiltItem(item, 'ward');
assert.equal(actor.items.filter(i => i.type === 'effect').length, 1, 'Reactivation refreshes one effect instead of stacking copies.');
assert.equal(action.system.frequency.value, 0);
assert.equal(await support.lsActivateBuiltItem(item, 'ward'), undefined);
assert.match(notices.at(-1)[1], /No activation uses remain/);

const draftFlags = item.getFlag('lore-smith', 'itemBuilder');
draftFlags.activations[0].applyTo = 'target';
action.system.frequency.value = 1;
game.user.targets = new Set([{ actor: { uuid: 'Actor.other', name: 'Other', isOwner: false } }]);
await support.lsActivateBuiltItem(item, 'ward');
assert.equal(action.system.frequency.value, 1, 'Permission failure never spends a use.');
assert.match(notices.at(-1)[1], /cannot edit/);
draftFlags.activations[0].applyTo = 'self';
await effect.delete();
const originalUpdate = action.update;
action.update = async () => { throw new Error('Frequency write failed'); };
await support.lsActivateBuiltItem(item, 'ward');
assert.equal(actor.items.filter(i => i.type === 'effect').length, 0, 'A failed use update rolls back its created Effect.');
action.update = originalUpdate;
let confirmCount = 0, confirmRelease;
foundry.applications.api.DialogV2.confirm = async () => { confirmCount++; return new Promise(resolve => { confirmRelease = resolve; }); };
const pending = support.lsActivateBuiltItem(item, 'ward');
await support.lsActivateBuiltItem(item, 'ward');
assert.equal(confirmCount, 1, 'Double clicks cannot spend two uses.');
confirmRelease(true); await pending;

const native = (await readFile(new URL('../scripts/native-workflows.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const sandbox = { ...support, console, structuredClone, CONFIG: { PF2E: {} }, game, ui,
  foundry: { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: { confirm: async () => true } } }, utils: { randomID: () => `new${++sequence}`, deepClone: structuredClone, mergeObject: (a, b) => ({ ...a, ...b }) } },
  Hooks: { on() {}, once() {} }, installBuilderSession() {}, lsBuilderGuide() {},
};
vm.createContext(sandbox);
vm.runInContext(native + '\nglobalThis.api = { LoreSmithItemBuilder, lsSyncOwnedItemActivations, lsItemBuilderFlags };', sandbox);
const { LoreSmithItemBuilder: Builder, lsSyncOwnedItemActivations: sync, lsItemBuilderFlags: normalize } = sandbox.api;
action.system.frequency.value = 0;
await Promise.all([sync(item), sync(item)]);
assert.equal(actor.items.filter(i => i.type === 'action').length, 1);
assert.equal(action.system.frequency.value, 0, 'Synchronization preserves spent activation uses.');
const legacyRule = { key: 'Resistance', type: 'fire', value: 5 };
item.system.rules = [{ key: 'RollOption', domain: 'all', option: 'original' }, legacyRule];
const app = { item, builderFlags: structuredClone(flags) };
app.builderFlags.generatedRules = [legacyRule];
await Builder.prototype.persistBuilderAutomation.call(app);
assert.equal(item.system.rules.length, 2);
assert.equal(item.system.rules.some(rule => rule.key === 'Resistance'), false, 'Finish removes old always-on activation rules.');
assert.equal(item.system.rules[0].option, 'original', 'Copied native rules survive finishing.');
const removed = structuredClone(flags); removed.activations = [];
assert.ok(support.lsValidateItemBuilder(item, removed).errors.some(error => error.includes('removed')));
const invalid = structuredClone(flags); invalid.activations[0].durationUnit = 'manual';
assert.ok(support.lsValidateItemBuilder(item, invalid).errors.some(error => error.includes('tracked duration')));
const legacy = normalize({ getFlag: () => ({ activations: [{ id: 'old', type: 'action' }], effects: [flags.effects[1]] }) });
assert.equal(legacy.legacyReview, true); assert.equal(legacy.activations[0].applyTo, 'manual');
console.log('Item builder checks passed: constant/temporary separation, duration, validation, migration, permissions, frequency preservation, refresh, rollback, double-click protection, synchronized actions.');
