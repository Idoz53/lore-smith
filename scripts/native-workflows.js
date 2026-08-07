const LS_MODULE_ID = "lore-smith";
const { ApplicationV2: LSApplicationV2, HandlebarsApplicationMixin: LSHandlebarsMixin, DialogV2: LSDialogV2 } = foundry.applications.api;

function lsNumber(value, fallback = 0) {
  const result = Number(value?.value ?? value?.mod ?? value);
  return Number.isFinite(result) ? result : fallback;
}

function lsRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
}

function lsTraits(document) {
  return [...(document.system?.traits?.value ?? [])];
}

function lsSplitTraits(value) {
  return [...new Set(String(value ?? "").split(",").map((trait) => trait.trim().toLowerCase()).filter(Boolean))];
}

async function lsSearchPacks({ documentName, query, types = [], limit = 80 }) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (normalized.length < 2) return [];
  const results = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === documentName)) {
    const fields = documentName === "Actor"
      ? ["name", "img", "type", "system.details.level.value"]
      : ["name", "img", "type", "system.level.value", "system.traits.value"];
    const index = await pack.getIndex({ fields });
    for (const entry of index) {
      if (types.length && !types.includes(entry.type)) continue;
      const haystack = `${entry.name} ${(entry.system?.traits?.value ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(normalized)) continue;
      results.push({
        name: entry.name,
        img: entry.img,
        type: entry.type,
        level: lsNumber(entry.system?.details?.level ?? entry.system?.level, 0),
        pack: pack.metadata.label,
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${documentName}.${entry._id}`,
      });
      if (results.length >= limit) return results.sort((left, right) => left.name.localeCompare(right.name));
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

class LoreSmithCreatureBuilder extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-creature-builder-{id}",
    classes: ["lore-smith-builder"],
    position: { width: 940, height: 760 },
    window: { title: "Lore Smith Creature Builder", icon: "fa-solid fa-dragon", resizable: true },
    actions: {
      previous: LoreSmithCreatureBuilder.previous,
      next: LoreSmithCreatureBuilder.next,
      searchSource: LoreSmithCreatureBuilder.searchSource,
      useSource: LoreSmithCreatureBuilder.useSource,
      useCurrent: LoreSmithCreatureBuilder.useCurrent,
      searchContent: LoreSmithCreatureBuilder.searchContent,
      addContent: LoreSmithCreatureBuilder.addContent,
      removeContent: LoreSmithCreatureBuilder.removeContent,
      finish: LoreSmithCreatureBuilder.finish,
    },
  };

  static PARTS = {
    builder: { template: `modules/${LS_MODULE_ID}/templates/creature-builder.hbs` },
  };

  constructor(actor, options = {}) {
    super({ ...options, id: `lore-smith-creature-builder-${actor.id}` });
    this.actor = actor;
  }

  step = 0;
  sourceQuery = "";
  contentQuery = "";
  sourceResults = [];
  contentResults = [];

  async _prepareContext(options) {
    const actor = this.actor;
    const system = actor.system;
    return {
      ...await super._prepareContext(options),
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        level: lsNumber(system.details?.level, 0),
        size: system.traits?.size?.value ?? "med",
        traits: lsTraits(actor).join(", "),
        ac: lsNumber(system.attributes?.ac, 10),
        hp: lsNumber(system.attributes?.hp?.max, 1),
        perception: lsNumber(system.perception, 0),
        fortitude: lsNumber(system.saves?.fortitude, 0),
        reflex: lsNumber(system.saves?.reflex, 0),
        will: lsNumber(system.saves?.will, 0),
        speed: lsNumber(system.attributes?.speed, 25),
        items: actor.items.map((item) => ({ id: item.id, name: item.name, img: item.img, type: item.type })),
      },
      sourceQuery: this.sourceQuery,
      contentQuery: this.contentQuery,
      sourceResults: this.sourceResults,
      contentResults: this.contentResults,
      step: this.step,
      stepNumber: this.step + 1,
      steps: {
        source: this.step === 0,
        identity: this.step === 1,
        defenses: this.step === 2,
        content: this.step === 3,
        review: this.step === 4,
      },
      canBack: this.step > 0,
      canNext: this.step > 0 && this.step < 4,
    };
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      await this.actor.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.actor.name,
        "system.details.level.value": Math.max(-1, Math.min(25, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.size.value": root.querySelector('[name="size"]')?.value || "med",
        "system.traits.value": lsSplitTraits(root.querySelector('[name="traits"]')?.value),
      });
    }
    if (this.step === 2) {
      await this.actor.update({
        "system.attributes.ac.value": lsNumber(root.querySelector('[name="ac"]')?.value, 10),
        "system.attributes.hp.max": Math.max(1, lsNumber(root.querySelector('[name="hp"]')?.value, 1)),
        "system.attributes.hp.value": Math.max(1, lsNumber(root.querySelector('[name="hp"]')?.value, 1)),
        "system.perception.mod": lsNumber(root.querySelector('[name="perception"]')?.value, 0),
        "system.saves.fortitude.value": lsNumber(root.querySelector('[name="fortitude"]')?.value, 0),
        "system.saves.reflex.value": lsNumber(root.querySelector('[name="reflex"]')?.value, 0),
        "system.saves.will.value": lsNumber(root.querySelector('[name="will"]')?.value, 0),
        "system.attributes.speed.value": Math.max(0, lsNumber(root.querySelector('[name="speed"]')?.value, 25)),
      });
    }
  }

  static async previous() {
    await this.saveStep();
    this.step = Math.max(0, this.step - 1);
    await this.render();
  }

  static async next() {
    await this.saveStep();
    this.step = Math.min(4, this.step + 1);
    await this.render();
  }

  static async searchSource() {
    this.sourceQuery = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.sourceResults = await lsSearchPacks({ documentName: "Actor", query: this.sourceQuery, types: ["npc"] });
    await this.render();
  }

  static async useSource(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source?.isOfType?.("npc") && source?.type !== "npc") return ui.notifications.error("That compendium entry is not a PF2e NPC.");
    const confirmed = await LSDialogV2.confirm({
      window: { title: "Use creature as the starting point?" },
      content: `<p>This replaces the current NPC’s statistics and embedded actions with <strong>${source.name}</strong>. You can edit every field afterward.</p>`,
      yes: { label: "Use this creature" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    const sourceData = source.toObject();
    await this.actor.update({
      name: source.name,
      img: source.img,
      system: sourceData.system,
      prototypeToken: sourceData.prototypeToken,
      [`flags.${LS_MODULE_ID}.sourceUuid`]: source.uuid,
    });
    const currentIds = this.actor.items.map((item) => item.id);
    if (currentIds.length) await this.actor.deleteEmbeddedDocuments("Item", currentIds);
    const itemData = source.items.map((item) => {
      const data = item.toObject();
      delete data._id;
      return data;
    });
    if (itemData.length) await this.actor.createEmbeddedDocuments("Item", itemData);
    this.step = 1;
    await this.render();
  }

  static async useCurrent() {
    this.step = 1;
    await this.render();
  }

  static async searchContent() {
    this.contentQuery = this.element.querySelector('[name="contentQuery"]')?.value ?? "";
    this.contentResults = await lsSearchPacks({
      documentName: "Item",
      query: this.contentQuery,
      types: ["action", "feat", "melee", "spell", "effect"],
      limit: 100,
    });
    await this.render();
  }

  static async addContent(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e compendium entry.");
    const data = source.toObject();
    delete data._id;
    await this.actor.createEmbeddedDocuments("Item", [data]);
    ui.notifications.info(`Added ${source.name} to ${this.actor.name}.`);
    await this.render();
  }

  static async removeContent(_event, target) {
    await this.actor.deleteEmbeddedDocuments("Item", [target.dataset.id]);
    await this.render();
  }

  static async finish() {
    await this.saveStep();
    await this.actor.setFlag(LS_MODULE_ID, "builderComplete", true);
    await this.close();
    this.actor.sheet.render(true);
  }
}

class LoreSmithItemBuilder extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-item-builder-{id}",
    classes: ["lore-smith-builder"],
    position: { width: 880, height: 720 },
    window: { title: "Lore Smith Item Builder", icon: "fa-solid fa-hammer", resizable: true },
    actions: {
      previous: LoreSmithItemBuilder.previous,
      next: LoreSmithItemBuilder.next,
      searchSource: LoreSmithItemBuilder.searchSource,
      useSource: LoreSmithItemBuilder.useSource,
      useCurrent: LoreSmithItemBuilder.useCurrent,
      finish: LoreSmithItemBuilder.finish,
    },
  };

  static PARTS = {
    builder: { template: `modules/${LS_MODULE_ID}/templates/item-builder.hbs` },
  };

  constructor(item, options = {}) {
    super({ ...options, id: `lore-smith-item-builder-${item.id}` });
    this.item = item;
  }

  step = 0;
  query = "";
  results = [];

  async _prepareContext(options) {
    const item = this.item;
    return {
      ...await super._prepareContext(options),
      item: {
        name: item.name,
        img: item.img,
        type: item.type,
        typeLabel: item.type.replace(/([A-Z])/g, " $1"),
        level: lsNumber(item.system?.level, 0),
        rarity: item.system?.traits?.rarity ?? "common",
        traits: lsTraits(item).join(", "),
        description: item.system?.description?.value ?? "",
        actionType: item.system?.actionType?.value ?? "",
        actions: item.system?.actions?.value ?? "",
        frequencyMax: item.system?.frequency?.max ?? "",
        frequencyPer: item.system?.frequency?.per ?? "",
        hasActionType: "actionType" in (item.system ?? {}),
        hasActions: "actions" in (item.system ?? {}),
        hasFrequency: "frequency" in (item.system ?? {}),
      },
      query: this.query,
      results: this.results,
      step: this.step,
      stepNumber: this.step + 1,
      steps: { source: this.step === 0, basics: this.step === 1, mechanics: this.step === 2, review: this.step === 3 },
      canBack: this.step > 0,
      canNext: this.step > 0 && this.step < 3,
    };
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      await this.item.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.item.name,
        "system.level.value": Math.max(0, Math.min(30, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.rarity": root.querySelector('[name="rarity"]')?.value || "common",
        "system.traits.value": lsSplitTraits(root.querySelector('[name="traits"]')?.value),
      });
    }
    if (this.step === 2) {
      const updates = {
        "system.description.value": root.querySelector('[name="description"]')?.value ?? "",
      };
      if (this.item.system?.actionType) updates["system.actionType.value"] = root.querySelector('[name="actionType"]')?.value || null;
      if (this.item.system?.actions) updates["system.actions.value"] = lsNumber(root.querySelector('[name="actions"]')?.value, null);
      if (this.item.system?.frequency) {
        updates["system.frequency.max"] = lsNumber(root.querySelector('[name="frequencyMax"]')?.value, null);
        updates["system.frequency.per"] = root.querySelector('[name="frequencyPer"]')?.value || null;
      }
      await this.item.update(updates);
    }
  }

  static async previous() {
    await this.saveStep();
    this.step = Math.max(0, this.step - 1);
    await this.render();
  }

  static async next() {
    await this.saveStep();
    this.step = Math.min(3, this.step + 1);
    await this.render();
  }

  static async searchSource() {
    this.query = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.results = await lsSearchPacks({ documentName: "Item", query: this.query, types: [this.item.type], limit: 100 });
    await this.render();
  }

  static async useSource(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source || source.type !== this.item.type) return ui.notifications.error("That source is not the same PF2e item type.");
    const confirmed = await LSDialogV2.confirm({
      window: { title: "Use item as the starting point?" },
      content: `<p>This replaces the current item’s mechanics with <strong>${source.name}</strong>. You can edit it afterward.</p>`,
      yes: { label: "Use this item" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    await this.item.update({
      name: source.name,
      img: source.img,
      system: source.toObject().system,
      [`flags.${LS_MODULE_ID}.sourceUuid`]: source.uuid,
    });
    this.step = 1;
    await this.render();
  }

  static async useCurrent() {
    this.step = 1;
    await this.render();
  }

  static async finish() {
    await this.saveStep();
    await this.item.setFlag(LS_MODULE_ID, "builderComplete", true);
    await this.close();
    this.item.sheet.render(true);
  }
}

function lsCombatSides() {
  const combat = game.combat;
  if (!combat) return null;
  const tokens = [];
  const partyIds = new Set();
  const enemyIds = new Set();
  for (const combatant of combat.combatants) {
    const token = combatant.token;
    if (!token?.actor) continue;
    tokens.push(token);
    const disposition = token.disposition;
    const friendly = disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
      || (disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE && token.actor.type === "character");
    (friendly ? partyIds : enemyIds).add(token.id);
  }
  return { combat, tokens, partyIds, enemyIds };
}

async function lsRunIterations() {
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    return ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
  }
  const iterations = Math.max(1, Math.min(1000, game.settings.get(LS_MODULE_ID, "combatIterations")));
  let wins = 0;
  let rounds = 0;
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = game.loreSmith.simulateEncounter(sides.tokens, sides.partyIds, sides.enemyIds, { captureLog: index < 20 });
    if (result.partyWon) wins += 1;
    rounds += result.rounds;
    if (index < 20) samples.push(result);
  }
  const logHtml = samples.map((sample, index) => `
    <details ${index === 0 ? "open" : ""}>
      <summary>Iteration ${index + 1} · ${sample.partyWon ? "Characters win" : "Opposition wins"} · ${sample.rounds} rounds</summary>
      ${sample.log.map((entry) => `<p class="${entry.kind}">${foundry.utils.escapeHTML(entry.text)}</p>`).join("")}
    </details>`).join("");
  const content = `<div class="ls-combat-report">
    <header><article><span>Character victory</span><strong>${((wins / iterations) * 100).toFixed(1)}%</strong><small>${wins}/${iterations}</small></article>
    <article><span>Average duration</span><strong>${(rounds / iterations).toFixed(1)}</strong><small>rounds</small></article></header>
    <p>Iterations are configured in <strong>Game Settings → Configure Settings → Module Settings → Lore Smith</strong>.</p>
    <section>${logHtml}</section>
  </div>`;
  new LSDialogV2({
    window: { title: `Lore Smith Combat Logs · ${iterations} iterations`, resizable: true },
    position: { width: 850, height: 760 },
    content,
    buttons: [{ action: "close", label: "Close", default: true }],
  }).render(true);
}

async function lsRunLiveCombat() {
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    return ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
  }
  if (!sides.combat.started) await sides.combat.startCombat();
  const missingInitiative = sides.combat.combatants.filter((combatant) => combatant.initiative === null).map((combatant) => combatant.id);
  if (missingInitiative.length) await sides.combat.rollInitiative(missingInitiative);
  ui.notifications.info("Lore Smith live combat started on the current Scene. Actions are recorded in Chat.");
  await game.loreSmith.runLiveReplay(sides.tokens, sides.partyIds, sides.enemyIds, { combat: sides.combat });
}

function lsAddCombatTrackerButtons(_app, html) {
  if (!game.user.isGM || game.system.id !== "pf2e") return;
  const root = lsRoot(html);
  if (!root || root.querySelector(".lore-smith-combat-controls")) return;
  const controls = document.createElement("div");
  controls.className = "lore-smith-combat-controls";
  controls.innerHTML = `
    <button type="button" data-action="lore-smith-logs" data-tooltip="Run randomized combat iterations and show detailed logs"><i class="fa-solid fa-list-ol"></i> Simulate logs</button>
    <button type="button" data-action="lore-smith-live" data-tooltip="Run one live encounter using the current Scene and Combat Tracker"><i class="fa-solid fa-play"></i> Live combat</button>`;
  controls.querySelector('[data-action="lore-smith-logs"]').addEventListener("click", lsRunIterations);
  controls.querySelector('[data-action="lore-smith-live"]').addEventListener("click", lsRunLiveCombat);
  const anchor = root.querySelector(".combat-tracker-header, .directory-header, header");
  (anchor?.parentElement ?? root).insertBefore(controls, anchor?.nextSibling ?? root.firstChild);
}

function lsAddSheetButton(app, html, { kind, icon, title, onClick }) {
  if (!game.user.isGM) return;
  const root = lsRoot(html);
  if (!root || root.querySelector(`[data-lore-smith-builder="${kind}"]`)) return;
  const header = root.closest(".app")?.querySelector(".window-header") ?? root.querySelector(".window-header");
  if (!header) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon lore-smith-sheet-builder";
  button.dataset.loreSmithBuilder = kind;
  button.dataset.tooltip = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<i class="${icon}"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  const close = header.querySelector('[data-action="close"], .close');
  header.insertBefore(button, close ?? null);
}

Hooks.once("init", () => {
  game.settings.register(LS_MODULE_ID, "combatIterations", {
    name: "Combat log iterations",
    hint: "How many randomized combats the Simulate Logs button runs from the Combat Tracker.",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    range: { min: 1, max: 1000, step: 1 },
  });
});

Hooks.on("renderCombatTracker", lsAddCombatTrackerButtons);
Hooks.on("renderCombatTrackerHTML", lsAddCombatTrackerButtons);

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app.actor ?? app.document;
  if (actor?.type !== "npc") return;
  lsAddSheetButton(app, html, {
    kind: "creature",
    icon: "fa-solid fa-dragon",
    title: "Open Lore Smith Creature Builder",
    onClick: () => new LoreSmithCreatureBuilder(actor).render(true),
  });
});

Hooks.on("renderItemSheet", (app, html) => {
  const item = app.item ?? app.document;
  if (!item || item.documentName !== "Item") return;
  lsAddSheetButton(app, html, {
    kind: "item",
    icon: "fa-solid fa-hammer",
    title: "Open Lore Smith Item Builder",
    onClick: () => new LoreSmithItemBuilder(item).render(true),
  });
});

Hooks.on("renderApplicationV2", (app, html) => {
  const document = app.document ?? app.actor ?? app.item;
  if (document?.documentName === "Actor" && document.type === "npc") {
    lsAddSheetButton(app, html, {
      kind: "creature",
      icon: "fa-solid fa-dragon",
      title: "Open Lore Smith Creature Builder",
      onClick: () => new LoreSmithCreatureBuilder(document).render(true),
    });
  } else if (document?.documentName === "Item") {
    lsAddSheetButton(app, html, {
      kind: "item",
      icon: "fa-solid fa-hammer",
      title: "Open Lore Smith Item Builder",
      onClick: () => new LoreSmithItemBuilder(document).render(true),
    });
  }
  if (/CombatTracker/i.test(app.constructor?.name ?? "")) lsAddCombatTrackerButtons(app, html);
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  Object.assign(game.loreSmith ??= {}, {
    openCreatureBuilder: (actor) => new LoreSmithCreatureBuilder(actor).render(true),
    openItemBuilder: (item) => new LoreSmithItemBuilder(item).render(true),
    runCombatLogs: lsRunIterations,
    runLiveCombat: lsRunLiveCombat,
  });
});
