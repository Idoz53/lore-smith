// Drafts are scoped to one world, user, and document. Undo touches only fields
// changed by this builder and refuses to overwrite subsequent outside edits.
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function builderChanges(before, after, path = []) {
  if (same(before, after)) return [];
  if (object(before) && object(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .flatMap((key) => builderChanges(before[key], after[key], [...path, key]));
  return [{ path, before: copy(before), after: copy(after), beforeExists: before !== undefined, afterExists: after !== undefined }];
}

const valueAt = (data, path) => path.reduce((value, key) => value?.[key], data);
export function builderUndoUpdate(changes, current) {
  const updates = {};
  for (const change of changes) {
    if (!same(valueAt(current, change.path), change.after)) throw new Error("This field changed outside the builder. Reopen the builder to continue safely.");
    const path = [...change.path];
    if (!change.beforeExists) path[path.length - 1] = `-=${path.at(-1)}`;
    updates[path.join(".")] = change.beforeExists ? copy(change.before) : null;
  }
  return updates;
}

function documentData(document) {
  const raw = document.toObject();
  return {
    name: raw.name, img: raw.img, system: raw.system,
    ...(raw.prototypeToken ? { prototypeToken: raw.prototypeToken } : {}),
    flags: { "lore-smith": raw.flags?.["lore-smith"] ?? {} },
  };
}

function itemData(item) {
  const raw = item.toObject ? item.toObject() : copy(item);
  delete raw._stats;
  return raw;
}

export function captureBuilderSnapshot(app) {
  const document = app.item ?? app.actor;
  return {
    document: documentData(document),
    items: app.item ? [] : (document.items?.contents ?? [...(document.items ?? [])]).map(itemData),
    builderFlags: copy(app.builderFlags),
  };
}

export function builderOperation(before, after, label) {
  const changes = builderChanges(before.document, after.document);
  const previous = new Map(before.items.map((item) => [item._id, item]));
  const current = new Map(after.items.map((item) => [item._id, item]));
  const items = [...new Set([...previous.keys(), ...current.keys()])].flatMap((id) => {
    const oldItem = previous.get(id), newItem = current.get(id);
    if (same(oldItem, newItem)) return [];
    return [{ id, before: oldItem, after: newItem, changes: oldItem && newItem ? builderChanges(oldItem, newItem) : [] }];
  });
  if (!changes.length && !items.length && same(before.builderFlags, after.builderFlags)) return null;
  return { label, changes, items, beforeBuilderFlags: before.builderFlags, afterBuilderFlags: after.builderFlags };
}

export async function undoBuilderOperation(app, operation) {
  const document = app.item ?? app.actor;
  const updates = builderUndoUpdate(operation.changes, documentData(document));
  const creates = [], removes = [], embeddedUpdates = [];
  for (const item of operation.items) {
    const current = document.items.get(item.id);
    if (!item.before) {
      if (!current || !same(itemData(current), item.after)) throw new Error("An added entry changed outside the builder; undo was stopped.");
      removes.push(item.id);
    } else if (!item.after) {
      if (current) throw new Error("An entry with the original ID already exists; undo was stopped.");
      creates.push(copy(item.before));
    } else {
      if (!current) throw new Error("An edited entry was removed outside the builder; undo was stopped.");
      embeddedUpdates.push({ _id: item.id, ...builderUndoUpdate(item.changes, itemData(current)) });
    }
  }
  const options = { loreSmithBuilderRestore: true, loreSmithAutoScale: true, keepId: true, render: false };
  // Check every conflict before writing. Re-create removed entries first so
  // dependent spell links can safely point at their original IDs again.
  if (creates.length) await document.createEmbeddedDocuments("Item", creates, options);
  if (embeddedUpdates.length) await document.updateEmbeddedDocuments("Item", embeddedUpdates, options);
  if (Object.keys(updates).length) await document.update(updates, options);
  if (removes.length) await document.deleteEmbeddedDocuments("Item", removes, options);
  if (operation.beforeBuilderFlags !== undefined) app.builderFlags = copy(operation.beforeBuilderFlags);
}

function collectFields(root) {
  const counts = new Map();
  return [...(root?.querySelectorAll("input[name],select[name],textarea[name]") ?? [])].map((field) => {
    const index = counts.get(field.name) ?? 0;
    counts.set(field.name, index + 1);
    return { name: field.name, index, value: field.value, checked: field.checked, type: field.type };
  });
}

function restoreFields(root, fields) {
  const byName = new Map();
  for (const element of root.querySelectorAll("input[name],select[name],textarea[name]")) {
    if (!byName.has(element.name)) byName.set(element.name, []);
    byName.get(element.name).push(element);
  }
  for (const field of fields) {
    const element = byName.get(field.name)?.[field.index];
    if (!element) continue;
    if (["checkbox", "radio"].includes(element.type)) element.checked = Boolean(field.checked);
    else if (element.tagName !== "SELECT" || [...element.options].some((option) => option.value === field.value)) element.value = field.value;
  }
}

function sessionKey(app) {
  const document = app.item ?? app.actor;
  return `lore-smith:builder:${game.world?.id ?? "world"}:${game.user.id}:${document.uuid ?? `${document.documentName}.${document.id}`}`;
}

function session(app) {
  if (app._lsSession) return app._lsSession;
  const state = app._lsSession = { key: sessionKey(app), history: [], queue: Promise.resolve(), loaded: false, busy: false, stale: null, restore: null, storageError: false };
  try {
    const draft = JSON.parse(localStorage.getItem(state.key) || "null");
    if (draft?.version === 1) {
      const current = captureBuilderSnapshot(app);
      if (same(draft.document, current.document) && (!draft.items || same(draft.items, current.items))) {
        app.step = Number(draft.step) || 0;
        if (draft.builderFlags && app.item) app.builderFlags = copy(draft.builderFlags);
        if (app.actor && draft.editingAbility && app.actor.items.get(draft.editingAbility)) app.editingAbility = draft.editingAbility;
        state.workshopDraft = draft.workshopDraft ?? null;
        state.restore = draft;
        state.history = draft.history ?? [];
      } else state.stale = draft;
    }
  } catch { state.storageError = true; }
  return state;
}

function saveDraft(app, { retainFields = false } = {}) {
  const state = session(app);
  if (state.stale) return;
  const visibleFields = collectFields(app.element);
  if (visibleFields.length) state.lastFields = visibleFields;
  const snapshot = captureBuilderSnapshot(app);
  const draft = {
    version: 1, step: app.step, document: snapshot.document, items: snapshot.items,
    builderFlags: copy(app.builderFlags), history: state.history.slice(-10),
    editingAbility: app.editingAbility ?? null, workshopDraft: state.workshopDraft ?? null,
    fields: retainFields ? state.restore?.fields ?? state.lastFields ?? [] : state.lastFields ?? [],
    updated: Date.now(),
  };
  try { localStorage.setItem(state.key, JSON.stringify(draft)); state.storageError = false; }
  catch { state.storageError = true; }
  refreshToolbar(app);
}

function refreshToolbar(app) {
  const state = session(app), root = app.element;
  const undo = root?.querySelector('[data-builder-session="undo"]');
  if (undo) { undo.disabled = state.busy || !state.history.length; undo.textContent = state.history.length ? `Undo: ${state.history.at(-1).label}` : "Undo last change"; }
  const status = root?.querySelector("[data-builder-draft-status]");
  if (status) status.textContent = state.busy ? "Saving…" : state.storageError ? "Draft storage is unavailable. Save and finish before closing this browser." : state.stale ? "An older draft is available. The sheet has changed since it was saved." : "Unfinished fields are saved on this device.";
}

function serialize(app, callback) {
  const state = session(app);
  const next = state.queue.catch(() => {}).then(async () => {
    state.busy = true; refreshToolbar(app);
    try { return await callback(); }
    finally { state.busy = false; refreshToolbar(app); }
  });
  state.queue = next;
  return next;
}

function addButton(parent, text, action) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = text; button.dataset.builderSession = action;
  parent.append(button); return button;
}

function bindSession(app, kind, guide, options) {
  const state = session(app), root = app.element;
  if (!root) return;
  if (state.restore && state.restore.step === app.step) {
    restoreFields(root, state.restore.fields ?? []);
    state.restore = null;
  }
  root.querySelector(".ls-builder-session")?.remove();
  const toolbar = document.createElement("section"); toolbar.className = "ls-builder-session";
  const controls = document.createElement("div"); controls.className = "ls-builder-session-controls";
  const undo = addButton(controls, "Undo last change", "undo");
  const review = addButton(controls, "Review result", "review");
  const status = document.createElement("span"); status.dataset.builderDraftStatus = ""; status.setAttribute("role", "status");
  controls.append(status); toolbar.append(controls);
  const details = document.createElement("details"); details.className = "ls-builder-guide";
  const summary = document.createElement("summary"); summary.textContent = `Guide: ${guide.title}`;
  details.append(summary);
  const intro = document.createElement("p"); intro.textContent = guide.summary; details.append(intro);
  const list = document.createElement("ul");
  for (const point of guide.checkpoints ?? []) { const item = document.createElement("li"); item.textContent = point; list.append(item); }
  details.append(list);
  if (guide.example) { const example = document.createElement("p"); example.className = "ls-guide-example"; example.textContent = guide.example; details.append(example); }
  const links = document.createElement("nav"); links.setAttribute("aria-label", "Archives of Nethys rules");
  for (const source of guide.sources ?? []) { const link = document.createElement("a"); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = source.label; links.append(link); }
  details.append(links); toolbar.append(details);
  root.querySelector(".ls-builder-body")?.prepend(toolbar);
  const footer = root.querySelector(".ls-builder-navigation > span");
  if (footer) footer.textContent = "Leaving a step or closing saves its fields. Finish applies the final build.";
  if (state.stale) {
    const resume = addButton(controls, "Resume older draft", "resume");
    const discard = addButton(controls, "Use current sheet", "discard");
    resume.addEventListener("click", () => serialize(app, async () => {
      const draft = state.stale; state.stale = null; state.history = [];
      app.step = draft.step; if (draft.builderFlags && app.item) app.builderFlags = copy(draft.builderFlags);
      if (app.actor && draft.editingAbility && app.actor.items.get(draft.editingAbility)) app.editingAbility = draft.editingAbility;
      state.workshopDraft = draft.workshopDraft ?? null;
      state.restore = draft; await app.render(); saveDraft(app);
    }).catch(report));
    discard.addEventListener("click", () => { state.stale = null; state.history = []; saveDraft(app); app.render(); });
  }
  undo.addEventListener("click", () => serialize(app, async () => {
    const operation = state.history.at(-1); if (!operation) return;
    await undoBuilderOperation(app, operation);
    if (options.afterRestore) await options.afterRestore(app);
    state.history.pop(); state.restore = null;
    await app.render(); saveDraft(app);
  }).catch(report));
  review.addEventListener("click", () => app.constructor.DEFAULT_OPTIONS.actions.goToStep.call(app, null, { dataset: { step: kind === "item" ? "5" : "6" } }).catch(report));
  state.controller?.abort(); state.controller = new AbortController();
  const onInput = () => saveDraft(app);
  root.addEventListener("input", onInput, { signal: state.controller.signal });
  root.addEventListener("change", onInput, { signal: state.controller.signal });
  refreshToolbar(app);
}

function report(error) { console.error("Lore Smith | Builder operation failed", error); ui.notifications.error(error.message || "Could not save the builder. Your draft is retained."); }

export function installBuilderSession(Builder, kind, guideFor, options = {}) {
  const prepare = Builder.prototype._prepareContext;
  Builder.prototype._prepareContext = async function (...args) {
    session(this);
    return prepare.apply(this, args);
  };
  const render = Builder.prototype._onRender;
  Builder.prototype._onRender = function (...args) {
    // Restore raw values before the builder initializes traits and dependent fields.
    const state = session(this);
    if (state.restore?.step === this.step && this.element) {
      restoreFields(this.element, state.restore.fields ?? []);
      state.restore = null;
    }
    const result = render?.apply(this, args);
    const level = this.item?.system?.level?.value ?? this.actor?.system?.details?.level?.value ?? 0;
    bindSession(this, kind, guideFor(kind, this.step, level), options);
    return result;
  };
  const close = Builder.prototype.close;
  Builder.prototype.close = async function (...args) {
    const state = session(this);
    // Finish calls close within the serialized action; do not await its own queue.
    const finish = async () => {
      if (!state.stale) {
        const before = captureBuilderSnapshot(this);
        try { await this.saveStep(); }
        catch (error) { saveDraft(this); report(error); throw error; }
        const operation = builderOperation(before, captureBuilderSnapshot(this), "saved step");
        if (operation) state.history.push(operation);
        saveDraft(this);
      }
      state.controller?.abort();
      const result = await close?.apply(this, args);
      state.didClose = true;
      return result;
    };
    return state.insideAction && args[0]?.loreSmithBuilderFinish ? finish() : serialize(this, finish);
  };
  for (const [name, handler] of Object.entries(Builder.DEFAULT_OPTIONS.actions)) {
    Builder.DEFAULT_OPTIONS.actions[name] = async function (...args) {
      return serialize(this, async () => {
        const state = session(this), before = captureBuilderSnapshot(this);
        state.insideAction = true;
        state.didClose = false;
        const previousStep = this.step;
        if (kind === "creature" && this.step === 4 && ["previous", "next", "goToStep"].includes(name)) state.workshopDraft = { step: 4, fields: collectFields(this.element), editingAbility: this.editingAbility };
        const destination = name === "goToStep" ? Number(args[1]?.dataset?.step) : name === "next" ? previousStep + 1 : name === "previous" ? previousStep - 1 : null;
        if (kind === "creature" && state.workshopDraft && destination === 4 && previousStep !== 4) {
          state.restore = state.workshopDraft;
          this.editingAbility = state.workshopDraft.editingAbility;
        }
        if (["searchContent", "previewContent", "addContent", "removeContent"].includes(name)) state.restore = { step: this.step, fields: collectFields(this.element) };
        try {
          await handler.apply(this, args);
          if (kind === "creature" && ["useSource", "createLinkedAbility", "createLinkedStrike", "createLinkedPassive", "cancelAbilityEdit"].includes(name)) state.workshopDraft = null;
          const operation = builderOperation(before, captureBuilderSnapshot(this), name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
          if (operation) { state.history.push(operation); state.history = state.history.slice(-10); }
          saveDraft(this);
          if (name === "finish" && state.didClose) localStorage.removeItem(state.key);
        } catch (error) {
          const partial = builderOperation(before, captureBuilderSnapshot(this), "incomplete change");
          if (partial) state.history.push(partial);
          saveDraft(this); report(error); throw error;
        }
        finally { state.insideAction = false; }
      });
    };
  }
}
