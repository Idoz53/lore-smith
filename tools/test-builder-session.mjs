import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/builder-session.js", import.meta.url), "utf8");
const { builderChanges, builderUndoUpdate, captureBuilderSnapshot, builderOperation, undoBuilderOperation, installBuilderSession } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const clone = structuredClone;
const writes = [];
function applyUpdate(data, updates) {
  for (const [path, value] of Object.entries(updates)) {
    if (path === "_id") continue;
    const keys = path.split(".");
    const final = keys.pop();
    let parent = data;
    for (const key of keys) parent = parent[key] ??= {};
    if (final.startsWith("-=")) delete parent[final.slice(2)];
    else parent[final] = clone(value);
  }
}

class MockDocument {
  constructor(data, type = "Item") {
    this.data = clone(data);
    this.documentName = type;
    this.id = data._id;
    this.uuid = `${type}.${this.id}`;
    this.items = new Map((data.items ?? []).map((item) => [item._id, new MockDocument(item)]));
    Object.defineProperty(this.items, "contents", { get: () => [...this.items.values()] });
  }
  get system() { return this.data.system; }
  get name() { return this.data.name; }
  toObject() { return clone(this.data); }
  async update(updates, options) {
    writes.push({ kind: "update", id: this.id, updates: clone(updates), options });
    applyUpdate(this.data, updates);
    return this;
  }
  async createEmbeddedDocuments(type, entries, options) {
    assert.equal(type, "Item");
    writes.push({ kind: "create", entries: clone(entries), options });
    assert.equal(options.keepId, true, "Undo must ask Foundry to retain embedded IDs.");
    return entries.map((entry) => {
      assert.ok(!this.items.has(entry._id), "Recreation must not collide with an existing embedded ID.");
      const item = new MockDocument(entry);
      this.items.set(item.id, item);
      return item;
    });
  }
  async updateEmbeddedDocuments(type, entries, options) {
    assert.equal(type, "Item");
    writes.push({ kind: "embedded-update", entries: clone(entries), options });
    for (const entry of entries) {
      const item = this.items.get(entry._id);
      assert.ok(item, "An embedded update must target an existing ID.");
      applyUpdate(item.data, entry);
      const linkedEntry = item.system.location?.value;
      if (linkedEntry) assert.ok(this.items.has(linkedEntry), "Restore spellcasting entries before reconnecting their spells.");
    }
    return entries.map((entry) => this.items.get(entry._id));
  }
  async deleteEmbeddedDocuments(type, ids, options) {
    assert.equal(type, "Item");
    writes.push({ kind: "delete", ids: [...ids], options });
    for (const id of ids) this.items.delete(id);
  }
}

const itemData = (id = "item-one") => ({
  _id: id, name: "Old cloak", img: "cloak.webp", type: "equipment",
  system: { level: { value: 3 }, hp: { value: 5, max: 12 }, description: { value: "Original description" } },
  flags: { "lore-smith": { mode: "constant" }, otherModule: { note: "leave this alone" } },
});
const actorData = () => ({
  _id: "actor-one", name: "Marsh witch", img: "witch.webp", type: "npc",
  system: { details: { level: { value: 5 } }, attributes: { hp: { value: 30, max: 70 }, ac: { value: 20 } } },
  prototypeToken: { name: "Witch", texture: { src: "witch-token.webp" } },
  flags: { "lore-smith": {} },
  items: [
    { _id: "entry-original", name: "Primal spells", type: "spellcastingEntry", system: { tradition: { value: "primal" } } },
    { _id: "spell-original", name: "Heal", type: "spell", system: { location: { value: "entry-original" }, level: { value: 3 }, notes: "keep" } },
  ],
});

let passed = 0;
async function test(name, callback) {
  writes.length = 0;
  await callback();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

await test("field undo preserves unrelated wounds, flags, and external edits", async () => {
  const item = new MockDocument(itemData());
  const app = { item, builderFlags: { effects: [] } };
  const before = captureBuilderSnapshot(app);
  item.data.name = "Ward cloak";
  item.data.system.level.value = 4;
  item.data.system.newBenefit = { value: 5 };
  delete item.data.system.description;
  const operation = builderOperation(before, captureBuilderSnapshot(app), "edit cloak");
  item.data.system.hp.value = 2;
  item.data.flags.otherModule.note = "updated outside builder";
  item.data.system.ownerNotes = "Player's notes";
  await undoBuilderOperation(app, operation);
  assert.equal(item.name, "Old cloak");
  assert.equal(item.system.level.value, 3);
  assert.equal(item.system.hp.value, 2);
  assert.equal(item.system.ownerNotes, "Player's notes");
  assert.deepEqual(item.system.description, { value: "Original description" });
  assert.ok(!Object.hasOwn(item.system, "newBenefit"));
  assert.equal(item.data.flags.otherModule.note, "updated outside builder");
});

await test("any conflicting changed field stops undo before writing", async () => {
  const item = new MockDocument(itemData());
  const app = { item };
  const before = captureBuilderSnapshot(app);
  item.data.name = "Ward cloak";
  item.system.level.value = 4;
  const operation = builderOperation(before, captureBuilderSnapshot(app), "edit cloak");
  item.system.level.value = 8;
  const current = item.toObject();
  await assert.rejects(undoBuilderOperation(app, operation), /changed outside/);
  assert.equal(writes.length, 0);
  assert.deepEqual(item.toObject(), current);
});

await test("embedded undo restores original IDs and spell links in dependency order", async () => {
  const actor = new MockDocument(actorData(), "Actor");
  const app = { actor };
  const before = captureBuilderSnapshot(app);
  actor.items.delete("entry-original");
  actor.items.set("entry-new", new MockDocument({ _id: "entry-new", name: "Innate", type: "spellcastingEntry", system: {} }));
  actor.items.get("spell-original").system.location.value = "entry-new";
  actor.data.name = "Changed witch";
  const operation = builderOperation(before, captureBuilderSnapshot(app), "change spellcasting");
  actor.system.attributes.hp.value = 18;
  actor.items.get("spell-original").system.notes = "Outside spell note";
  await undoBuilderOperation(app, operation);
  assert.ok(actor.items.has("entry-original"));
  assert.ok(!actor.items.has("entry-new"));
  assert.equal(actor.items.get("spell-original").system.location.value, "entry-original");
  assert.equal(actor.items.get("spell-original").system.notes, "Outside spell note");
  assert.equal(actor.system.attributes.hp.value, 18);
  assert.deepEqual(writes.map((entry) => entry.kind), ["create", "embedded-update", "update", "delete"]);
});

await test("a late embedded conflict prevents even earlier planned changes", async () => {
  const actor = new MockDocument(actorData(), "Actor");
  const app = { actor };
  const before = captureBuilderSnapshot(app);
  actor.data.name = "Changed witch";
  actor.items.delete("entry-original");
  actor.items.get("spell-original").system.level.value = 4;
  actor.items.set("new-strike", new MockDocument({ _id: "new-strike", name: "Claw", type: "melee", system: { bonus: { value: 12 } } }));
  const operation = builderOperation(before, captureBuilderSnapshot(app), "change witch");
  actor.items.get("new-strike").system.bonus.value = 18;
  await assert.rejects(undoBuilderOperation(app, operation), /added entry changed/);
  assert.equal(writes.length, 0);
  assert.ok(!actor.items.has("entry-original"));
  assert.equal(actor.name, "Changed witch");
  assert.equal(actor.items.get("spell-original").system.level.value, 4);
});

await test("removed embedded ID collision and missing edited entry are both conflicts", async () => {
  const actor = new MockDocument(actorData(), "Actor");
  const app = { actor };
  const before = captureBuilderSnapshot(app);
  actor.items.delete("entry-original");
  const removed = builderOperation(before, captureBuilderSnapshot(app), "remove caster");
  actor.items.set("entry-original", new MockDocument({ _id: "entry-original", name: "Outside replacement", system: {} }));
  await assert.rejects(undoBuilderOperation(app, removed), /original ID already exists/);
  const startEdit = captureBuilderSnapshot(app);
  actor.items.get("spell-original").data.name = "Greater Heal";
  const edited = builderOperation(startEdit, captureBuilderSnapshot(app), "edit spell");
  actor.items.delete("spell-original");
  await assert.rejects(undoBuilderOperation(app, edited), /removed outside/);
  assert.equal(writes.length, 0);
});

await test("nested diff deletions and arrays produce reversible Foundry updates", async () => {
  const before = { traits: ["fire"], nested: { old: 1 }, zero: 0, disabled: false };
  const after = { traits: ["cold", "water"], nested: { extra: 2 }, zero: 1, disabled: true };
  const update = builderUndoUpdate(builderChanges(before, after), after);
  const restored = clone(after);
  applyUpdate(restored, update);
  assert.deepEqual(restored, before);
  assert.deepEqual(builderChanges(before, clone(before)), []);
});

// A small event-capable DOM exercises field restore and toolbar behavior without
// requiring browser packages. The integration browser check covers real layout.
class Element extends EventTarget {
  constructor(tag = "div") {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.className = ""; this.attributes = {}; this.type = "text"; this.value = "";
    this.checked = false; this.name = ""; this.options = [];
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((entry) => entry !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll(selector) {
    const matches = (element) => {
      if (selector === "input[name],select[name],textarea[name]") return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) && element.name;
      if (selector.startsWith(".")) return element.className.split(" ").includes(selector.slice(1));
      const data = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
      if (data) {
        const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return Object.hasOwn(element.dataset, key) && (data[2] === undefined || element.dataset[key] === data[2]);
      }
      return element.tagName.toLowerCase() === selector;
    };
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) {
    if (selector === ".ls-builder-navigation > span") return null;
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
const field = (name, value, type = "text") => Object.assign(new Element(type === "textarea" ? "textarea" : "input"), { name, value, type });
const storage = new Map();
const errors = [];
globalThis.game = { world: { id: "world-a" }, user: { id: "gm-a" } };
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
globalThis.document = { createElement: (tag) => new Element(tag) };
globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
const guide = () => ({ title: "Test guide", summary: "Test summary", checkpoints: ["Check it"], sources: [] });
const deadline = async (promise) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Builder queue deadlocked")), 2000); })]); }
  finally { clearTimeout(timer); }
};

function makeBuilder(actions = {}) {
  class TestBuilder {
    static DEFAULT_OPTIONS = { actions: {
      goToStep: async function (_event, target) { await this.saveStep(); this.step = Number(target.dataset.step); await this.render(); },
      finish: async function () { await this.saveStep(); await this.close({ loreSmithBuilderFinish: true }); },
      ...actions,
    } };
    constructor(item) { this.item = item; this.step = 0; this.builderFlags = { effects: [] }; this.closed = false; this._makeRoot(); }
    _makeRoot() {
      this.element = new Element();
      const body = new Element(); body.className = "ls-builder-body"; this.element.append(body);
      body.append(field("name", this.item.name), field("notes", "fresh template", "textarea"), field("repeated", "first"), field("repeated", "second"), field("enabled", "on", "checkbox"));
    }
    async _prepareContext() { return {}; }
    _onRender() {}
    async render() { await this._prepareContext(); this._makeRoot(); this._onRender(); return this; }
    async saveStep() { await this.item.update({ name: this.element.querySelectorAll("input[name],select[name],textarea[name]")[0].value }); }
    async close() { this.closed = true; }
  }
  installBuilderSession(TestBuilder, "item", guide);
  return TestBuilder;
}

await test("closing saves the step and reopening restores unfinished repeated fields", async () => {
  storage.clear();
  const Builder = makeBuilder();
  const item = new MockDocument(itemData());
  const app = new Builder(item);
  await app.render();
  app.step = 3;
  const fields = app.element.querySelectorAll("input[name],select[name],textarea[name]");
  fields[0].value = "Saved name"; fields[1].value = "Unfinished effect description";
  fields[2].value = "First edited row"; fields[3].value = "Second edited row"; fields[4].checked = true;
  app.element.dispatchEvent(new Event("input"));
  await deadline(app.close());
  assert.equal(item.name, "Saved name");
  assert.equal(app.closed, true);
  const reopened = new Builder(item);
  await reopened.render();
  const restored = reopened.element.querySelectorAll("input[name],select[name],textarea[name]");
  assert.equal(reopened.step, 3);
  assert.equal(restored[1].value, "Unfinished effect description");
  assert.equal(restored[2].value, "First edited row");
  assert.equal(restored[3].value, "Second edited row");
  assert.equal(restored[4].checked, true);
  assert.equal(reopened._lsSession.history.length, 1);
  assert.equal(reopened.element.querySelectorAll(".ls-builder-session").length, 1);
});

await test("stale draft is not silently restored over a changed sheet", async () => {
  storage.clear();
  const Builder = makeBuilder();
  const item = new MockDocument(itemData());
  const app = new Builder(item);
  await app.render();
  app.element.querySelectorAll("input[name],select[name],textarea[name]")[1].value = "Old draft notes";
  await app.close();
  item.data.name = "Renamed elsewhere";
  const reopened = new Builder(item);
  await reopened.render();
  assert.ok(reopened._lsSession.stale);
  assert.equal(reopened.element.querySelectorAll("input[name],select[name],textarea[name]")[0].value, "Renamed elsewhere");
  assert.equal(reopened.element.querySelectorAll("input[name],select[name],textarea[name]")[1].value, "fresh template");
  reopened.element.querySelector('[data-builder-session="resume"]').dispatchEvent(new Event("click"));
  await deadline(reopened._lsSession.queue);
  assert.equal(reopened.element.querySelectorAll("input[name],select[name],textarea[name]")[1].value, "Old draft notes");
  assert.equal(item.name, "Renamed elsewhere", "Resuming fields does not write the old document snapshot.");
  assert.equal(reopened._lsSession.history.length, 0, "Stale history must not be reused against a changed sheet.");
});

await test("actions serialize in order and finish can close without awaiting itself", async () => {
  storage.clear();
  const trace = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const Builder = makeBuilder({
    first: async function () { trace.push("first-start"); await gate; trace.push("first-end"); },
    second: async function () { trace.push("second"); },
  });
  const app = new Builder(new MockDocument(itemData()));
  await app.render();
  const first = Builder.DEFAULT_OPTIONS.actions.first.call(app);
  const second = Builder.DEFAULT_OPTIONS.actions.second.call(app);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(trace, ["first-start"]);
  releaseFirst();
  await deadline(Promise.all([first, second]));
  assert.deepEqual(trace, ["first-start", "first-end", "second"]);
  await deadline(Builder.DEFAULT_OPTIONS.actions.finish.call(app));
  assert.equal(app.closed, true);
  assert.equal(storage.size, 0, "Successful finish removes the local draft.");
});

await test("closing the window waits for an unrelated pending action", async () => {
  storage.clear();
  let releaseAction;
  const gate = new Promise((resolve) => { releaseAction = resolve; });
  const Builder = makeBuilder({
    waiting: async function () { await gate; await this.item.update({ name: "Completed action" }); await this.render(); },
  });
  const app = new Builder(new MockDocument(itemData()));
  await app.render();
  const action = Builder.DEFAULT_OPTIONS.actions.waiting.call(app);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = app.close();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.closed, false, "Window close must wait for the queued action instead of overlapping its writes.");
  } finally {
    releaseAction();
    await deadline(Promise.all([action, closing]));
  }
  assert.equal(app.closed, true);
  assert.equal(app.item.name, "Completed action");
});

await test("a rejected action preserves its draft and does not poison the queue", async () => {
  storage.clear(); errors.length = 0;
  const Builder = makeBuilder({
    failing: async function () { await this.item.update({ name: "Partial result" }); throw new Error("Simulated write failure"); },
    later: async function () { this.laterRan = true; },
  });
  const app = new Builder(new MockDocument(itemData()));
  await app.render();
  const originalConsoleError = console.error;
  try {
    console.error = () => {};
    await assert.rejects(deadline(Builder.DEFAULT_OPTIONS.actions.failing.call(app)), /Simulated write failure/);
  } finally { console.error = originalConsoleError; }
  assert.equal(app._lsSession.history.at(-1).label, "incomplete change");
  assert.equal(storage.size, 1);
  assert.deepEqual(errors, ["Simulated write failure"]);
  await deadline(Builder.DEFAULT_OPTIONS.actions.later.call(app));
  assert.equal(app.laterRan, true);
  assert.equal(app._lsSession.busy, false);
});

await test("draft keys isolate users and worlds", async () => {
  storage.clear();
  const Builder = makeBuilder();
  const item = new MockDocument(itemData());
  const first = new Builder(item);
  await first.render();
  first.element.querySelectorAll("input[name],select[name],textarea[name]")[1].value = "GM A's draft";
  await first.close();
  game.user.id = "gm-b";
  const otherUser = new Builder(item); await otherUser.render();
  assert.equal(otherUser._lsSession.restore, null);
  assert.notEqual(first._lsSession.key, otherUser._lsSession.key);
  game.user.id = "gm-a"; game.world.id = "world-b";
  const otherWorld = new Builder(item); await otherWorld.render();
  assert.notEqual(first._lsSession.key, otherWorld._lsSession.key);
  game.world.id = "world-a";
});

console.log(`Builder session checks passed (${passed} scenarios).`);
