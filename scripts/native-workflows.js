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

const LS_AC_ROWS = [
  [18, 15, 14, 12], [19, 16, 15, 13], [19, 16, 15, 13], [21, 18, 17, 15],
  [22, 19, 18, 16], [24, 21, 20, 18], [25, 22, 21, 19], [27, 24, 23, 21],
  [28, 25, 24, 22], [30, 27, 26, 24], [31, 28, 27, 25], [33, 30, 29, 27],
  [34, 31, 30, 28], [36, 33, 32, 30], [37, 34, 33, 31], [39, 36, 35, 33],
  [40, 37, 36, 34], [42, 39, 38, 36], [43, 40, 39, 37], [45, 42, 41, 39],
  [46, 43, 42, 40], [48, 45, 44, 42], [49, 46, 45, 43], [51, 48, 47, 45],
  [52, 49, 48, 46], [54, 51, 50, 48],
];

const LS_PERCEPTION_ROWS = [
  [9, 8, 5, 2, 0], [10, 9, 6, 3, 1], [11, 10, 7, 4, 2], [12, 11, 8, 5, 3],
  [14, 12, 9, 6, 4], [15, 14, 11, 8, 6], [17, 15, 12, 9, 7], [18, 17, 14, 11, 8],
  [20, 18, 15, 12, 10], [21, 19, 16, 13, 11], [23, 21, 18, 15, 12],
  [24, 22, 19, 16, 14], [26, 24, 21, 18, 15], [27, 25, 22, 19, 16],
  [29, 26, 23, 20, 18], [30, 28, 25, 22, 19], [32, 29, 26, 23, 20],
  [33, 30, 28, 25, 22], [35, 32, 29, 26, 23], [36, 33, 30, 27, 24],
  [38, 35, 32, 29, 26], [39, 36, 33, 30, 27], [41, 38, 35, 32, 28],
  [43, 39, 36, 33, 30], [44, 40, 37, 34, 31], [46, 42, 38, 36, 32],
];

const LS_HP_ROWS = [
  [9, 7, 5], [18, 15, 12], [25, 20, 15], [38, 30, 23], [56, 45, 34], [75, 60, 45],
  [94, 75, 56], [119, 95, 71], [144, 115, 86], [169, 135, 101], [194, 155, 116],
  [219, 175, 131], [244, 195, 146], [269, 215, 161], [294, 235, 176], [319, 255, 191],
  [344, 275, 206], [369, 295, 221], [394, 315, 236], [419, 335, 251], [444, 355, 266],
  [469, 375, 281], [500, 400, 300], [538, 430, 323], [575, 460, 345], [625, 500, 375],
];

function lsLevelRow(rows, level) {
  return rows[Math.max(0, Math.min(rows.length - 1, Number(level) + 1))];
}

function lsBenchmarks(level) {
  const named = (names, values) => names.map((label, index) => ({ label, value: values[index] }));
  return {
    ac: named(["Extreme", "High", "Moderate", "Low"], lsLevelRow(LS_AC_ROWS, level)),
    hp: named(["High", "Moderate", "Low"], lsLevelRow(LS_HP_ROWS, level)),
    perception: named(["Extreme", "High", "Moderate", "Low", "Terrible"], lsLevelRow(LS_PERCEPTION_ROWS, level)),
    saves: named(["Extreme", "High", "Moderate", "Low", "Terrible"], lsLevelRow(LS_PERCEPTION_ROWS, level)),
  };
}

function lsItemTraitConfig() {
  return Object.assign({},
    CONFIG.PF2E.actionTraits,
    CONFIG.PF2E.armorTraits,
    CONFIG.PF2E.consumableTraits,
    CONFIG.PF2E.equipmentTraits,
    CONFIG.PF2E.featTraits,
    CONFIG.PF2E.spellTraits,
    CONFIG.PF2E.weaponTraits);
}

function lsIsBestiaryAbilityGlossary(pack) {
  const identity = `${pack.collection ?? ""} ${pack.metadata?.label ?? ""}`.toLowerCase();
  return /bestiary[\s._-]*abilit(?:y|ies)[\s._-]*glossary/.test(identity)
    || identity.includes("bestiary ability glossary");
}

async function lsSearchPacks({
  documentName,
  query = "",
  types = [],
  level = "",
  trait = "",
  limit = Number.POSITIVE_INFINITY,
  bestiaryGlossaryOnly = false,
}) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const results = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === documentName)) {
    if (bestiaryGlossaryOnly && !lsIsBestiaryAbilityGlossary(pack)) continue;
    const fields = documentName === "Actor"
      ? ["name", "img", "type", "system.details.level.value", "system.traits.value", "system.traits.size.value"]
      : ["name", "img", "type", "system.level.value", "system.traits.value", ...(normalized ? ["system.description.value"] : [])];
    const index = await pack.getIndex({ fields });
    for (const entry of index) {
      if (types.length && !types.includes(entry.type)) continue;
      const traits = entry.system?.traits?.value ?? [];
      const entryLevel = lsNumber(entry.system?.details?.level ?? entry.system?.level, 0);
      const description = String(entry.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
      const haystack = `${entry.name} ${traits.join(" ")} ${description}`.toLowerCase();
      if (normalized && !haystack.includes(normalized)) continue;
      if (level !== "" && entryLevel !== Number(level)) continue;
      if (trait && !traits.includes(trait)) continue;
      results.push({
        name: entry.name,
        img: entry.img,
        type: entry.type,
        level: entryLevel,
        traits,
        pack: pack.metadata.label,
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${documentName}.${entry._id}`,
      });
      if (results.length >= limit) return results.sort((left, right) => left.name.localeCompare(right.name));
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

async function lsBuildSourcePreview(uuid) {
  const source = await fromUuid(uuid);
  if (!source) return null;
  const traits = lsTraits(source).map((value) =>
    game.i18n.localize(CONFIG.PF2E.creatureTraits?.[value] ?? lsItemTraitConfig()[value] ?? value));
  if (source.documentName === "Actor") {
    return {
      uuid,
      kind: "creature",
      name: source.name,
      img: source.img,
      type: source.type,
      level: lsNumber(source.system?.details?.level, 0),
      traits,
      ac: lsNumber(source.system?.attributes?.ac, 10),
      hp: lsNumber(source.system?.attributes?.hp?.max, 1),
      perception: lsNumber(source.system?.perception, 0),
      speed: lsNumber(source.system?.attributes?.speed, 25),
      entries: source.items.map((item) => ({ name: item.name, type: item.type })).slice(0, 40),
      description: source.system?.details?.publicNotes ?? "",
    };
  }
  const price = source.system?.price?.value;
  return {
    uuid,
    kind: "item",
    name: source.name,
    img: source.img,
    type: source.type,
    level: lsNumber(source.system?.level, 0),
    traits,
    usage: source.system?.usage?.value ?? source.system?.usage ?? "",
    bulk: source.system?.bulk?.value ?? source.system?.bulk ?? "",
    price: price && typeof price === "object"
      ? Object.entries(price).map(([coin, amount]) => `${amount} ${coin}`).join(", ")
      : price ?? "",
    description: source.system?.description?.value ?? "",
  };
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
      previousSources: LoreSmithCreatureBuilder.previousSources,
      nextSources: LoreSmithCreatureBuilder.nextSources,
      previewSource: LoreSmithCreatureBuilder.previewSource,
      useSource: LoreSmithCreatureBuilder.useSource,
      useCurrent: LoreSmithCreatureBuilder.useCurrent,
      addTrait: LoreSmithCreatureBuilder.addTrait,
      removeTrait: LoreSmithCreatureBuilder.removeTrait,
      goToStep: LoreSmithCreatureBuilder.goToStep,
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
  sourceLevel = "";
  sourceTrait = "";
  sourcePage = 0;
  sourcePageSize = 60;
  sourceAllResults = [];
  sourcesLoaded = false;
  contentQuery = "";
  contentType = "";
  contentGlossaryOnly = false;
  sourceResults = [];
  sourcePreview = null;
  contentResults = [];

  async _prepareContext(options) {
    if (this.step === 0 && !this.sourcesLoaded) await this.loadSources();
    if (this.step === 3 && !this.contentResults.length) {
      this.contentResults = await lsSearchPacks({
        documentName: "Item",
        types: ["action", "feat", "melee", "spell", "effect"],
        limit: 250,
      });
    }
    const actor = this.actor;
    const system = actor.system;
    const level = lsNumber(system.details?.level, 0);
    const actorSize = system.traits?.size?.value ?? "med";
    const benchmarkRows = lsBenchmarks(level);
    const markSelected = (rows, value) => rows.map((row) => ({ ...row, selected: Number(row.value) === Number(value) }));
    return {
      ...await super._prepareContext(options),
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        level,
        size: actorSize,
        traits: lsTraits(actor).map((value) => ({
          value,
          label: game.i18n.localize(CONFIG.PF2E.creatureTraits?.[value] ?? value),
        })),
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
      sourcePreview: this.sourcePreview,
      sourceLevel: this.sourceLevel,
      sourceTrait: this.sourceTrait,
      sourcePageLabel: `${this.sourcePage + 1} / ${Math.max(1, Math.ceil(this.sourceAllResults.length / this.sourcePageSize))}`,
      sourceCount: this.sourceAllResults.length,
      hasPreviousSources: this.sourcePage > 0,
      hasNextSources: (this.sourcePage + 1) * this.sourcePageSize < this.sourceAllResults.length,
      levelFilters: Array.from({ length: 27 }, (_value, index) => ({ value: index - 1, label: index - 1, selected: String(index - 1) === String(this.sourceLevel) })),
      creatureLevels: Array.from({ length: 27 }, (_value, index) => ({
        value: index - 1,
        label: index - 1,
        selected: index - 1 === level,
      })),
      sizeOptions: [
        ["tiny", "Tiny"], ["sm", "Small"], ["med", "Medium"],
        ["lg", "Large"], ["huge", "Huge"], ["grg", "Gargantuan"],
      ].map(([value, label]) => ({ value, label, selected: value === actorSize })),
      creatureTraitOptions: Object.entries(CONFIG.PF2E.creatureTraits ?? {}).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
        selected: value === this.sourceTrait,
      })).sort((left, right) => left.label.localeCompare(right.label)),
      contentResults: this.contentResults,
      benchmarks: {
        ac: markSelected(benchmarkRows.ac, lsNumber(system.attributes?.ac, 10)),
        hp: markSelected(benchmarkRows.hp, lsNumber(system.attributes?.hp?.max, 1)),
        perception: markSelected(benchmarkRows.perception, lsNumber(system.perception, 0)),
        fortitude: markSelected(benchmarkRows.saves, lsNumber(system.saves?.fortitude, 0)),
        reflex: markSelected(benchmarkRows.saves, lsNumber(system.saves?.reflex, 0)),
        will: markSelected(benchmarkRows.saves, lsNumber(system.saves?.will, 0)),
      },
      contentType: this.contentType,
      contentGlossaryOnly: this.contentGlossaryOnly,
      contentTypes: [
        { value: "", label: "All actions, abilities, and spells" },
        { value: "spell", label: "Spells" },
        { value: "action", label: "Actions and abilities" },
        { value: "feat", label: "Feats and passive abilities" },
        { value: "melee", label: "NPC strikes" },
        { value: "effect", label: "Effects and conditions" },
      ].map((type) => ({ ...type, selected: type.value === this.contentType })),
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

  _onRender(context, options) {
    super._onRender(context, options);
    for (const select of this.element?.querySelectorAll("[data-benchmark-target]") ?? []) {
      select.addEventListener("change", () => {
        const input = this.element.querySelector(`[name="${select.dataset.benchmarkTarget}"]`);
        if (input && select.value !== "") input.value = select.value;
      });
    }
  }

  async loadSources() {
    this.sourceAllResults = await lsSearchPacks({
      documentName: "Actor",
      query: this.sourceQuery,
      types: ["npc"],
      level: this.sourceLevel,
      trait: this.sourceTrait,
    });
    const start = this.sourcePage * this.sourcePageSize;
    this.sourceResults = this.sourceAllResults.slice(start, start + this.sourcePageSize);
    this.sourcesLoaded = true;
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      await this.actor.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.actor.name,
        "system.details.level.value": Math.max(-1, Math.min(25, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.size.value": root.querySelector('[name="size"]')?.value || "med",
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

  static async goToStep(_event, target) {
    await this.saveStep();
    this.step = Math.max(0, Math.min(4, Number(target.dataset.step) || 0));
    await this.render();
  }

  static async searchSource() {
    this.sourceQuery = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.sourceLevel = this.element.querySelector('[name="sourceLevel"]')?.value ?? "";
    this.sourceTrait = this.element.querySelector('[name="sourceTrait"]')?.value ?? "";
    this.sourcePage = 0;
    await this.loadSources();
    await this.render();
  }

  static async previousSources() {
    this.sourcePage = Math.max(0, this.sourcePage - 1);
    await this.loadSources();
    await this.render();
  }

  static async nextSources() {
    this.sourcePage += 1;
    await this.loadSources();
    await this.render();
  }

  static async previewSource(_event, target) {
    this.sourcePreview = await lsBuildSourcePreview(target.dataset.uuid);
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

  static async addTrait() {
    const trait = this.element.querySelector('[name="traitToAdd"]')?.value;
    if (!trait) return;
    const traits = new Set(lsTraits(this.actor));
    traits.add(trait);
    await this.actor.update({ "system.traits.value": [...traits] });
    await this.render();
  }

  static async removeTrait(_event, target) {
    const traits = lsTraits(this.actor).filter((trait) => trait !== target.dataset.trait);
    await this.actor.update({ "system.traits.value": traits });
    await this.render();
  }

  static async searchContent() {
    this.contentQuery = this.element.querySelector('[name="contentQuery"]')?.value ?? "";
    this.contentType = this.element.querySelector('[name="contentType"]')?.value ?? "";
    this.contentGlossaryOnly = Boolean(this.element.querySelector('[name="contentGlossaryOnly"]')?.checked);
    this.contentResults = await lsSearchPacks({
      documentName: "Item",
      query: this.contentQuery,
      types: this.contentType ? [this.contentType] : ["action", "feat", "melee", "spell", "effect"],
      limit: 250,
      bestiaryGlossaryOnly: this.contentGlossaryOnly,
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
      previousSources: LoreSmithItemBuilder.previousSources,
      nextSources: LoreSmithItemBuilder.nextSources,
      previewSource: LoreSmithItemBuilder.previewSource,
      useSource: LoreSmithItemBuilder.useSource,
      useCurrent: LoreSmithItemBuilder.useCurrent,
      addTrait: LoreSmithItemBuilder.addTrait,
      removeTrait: LoreSmithItemBuilder.removeTrait,
      goToStep: LoreSmithItemBuilder.goToStep,
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
  sourceLevel = "";
  sourceTrait = "";
  sourcePage = 0;
  sourcePageSize = 60;
  sourceAllResults = [];
  sourcesLoaded = false;
  results = [];
  sourcePreview = null;

  async _prepareContext(options) {
    if (this.step === 0 && !this.sourcesLoaded) await this.loadSources();
    const item = this.item;
    const traitConfig = lsItemTraitConfig();
    return {
      ...await super._prepareContext(options),
      item: {
        name: item.name,
        img: item.img,
        type: item.type,
        typeLabel: item.type.replace(/([A-Z])/g, " $1"),
        level: lsNumber(item.system?.level, 0),
        rarity: item.system?.traits?.rarity ?? "common",
        traits: lsTraits(item).map((value) => ({
          value,
          label: game.i18n.localize(traitConfig[value] ?? value),
        })),
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
      sourcePreview: this.sourcePreview,
      sourceLevel: this.sourceLevel,
      sourceTrait: this.sourceTrait,
      sourceCount: this.sourceAllResults.length,
      sourcePageLabel: `${this.sourcePage + 1} / ${Math.max(1, Math.ceil(this.sourceAllResults.length / this.sourcePageSize))}`,
      hasPreviousSources: this.sourcePage > 0,
      hasNextSources: (this.sourcePage + 1) * this.sourcePageSize < this.sourceAllResults.length,
      levelFilters: Array.from({ length: 31 }, (_value, level) => ({
        value: level,
        label: level,
        selected: String(level) === String(this.sourceLevel),
      })),
      itemLevels: Array.from({ length: 31 }, (_value, level) => ({
        value: level,
        label: level,
        selected: level === lsNumber(item.system?.level, 0),
      })),
      rarityOptions: ["common", "uncommon", "rare", "unique"].map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1),
        selected: value === (item.system?.traits?.rarity ?? "common"),
      })),
      actionTypeOptions: [
        ["passive", "Passive"], ["free", "Free action"], ["reaction", "Reaction"], ["action", "Action"],
      ].map(([value, label]) => ({
        value,
        label,
        selected: value === (item.system?.actionType?.value ?? "passive"),
      })),
      itemTraitOptions: Object.entries(traitConfig).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
        selected: value === this.sourceTrait,
      })).sort((left, right) => left.label.localeCompare(right.label)),
      step: this.step,
      stepNumber: this.step + 1,
      steps: { source: this.step === 0, basics: this.step === 1, mechanics: this.step === 2, review: this.step === 3 },
      canBack: this.step > 0,
      canNext: this.step > 0 && this.step < 3,
    };
  }

  async loadSources() {
    this.sourceAllResults = await lsSearchPacks({
      documentName: "Item",
      query: this.query,
      types: [this.item.type],
      level: this.sourceLevel,
      trait: this.sourceTrait,
    });
    const start = this.sourcePage * this.sourcePageSize;
    this.results = this.sourceAllResults.slice(start, start + this.sourcePageSize);
    this.sourcesLoaded = true;
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      await this.item.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.item.name,
        "system.level.value": Math.max(0, Math.min(30, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.rarity": root.querySelector('[name="rarity"]')?.value || "common",
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

  static async goToStep(_event, target) {
    await this.saveStep();
    this.step = Math.max(0, Math.min(3, Number(target.dataset.step) || 0));
    await this.render();
  }

  static async searchSource() {
    this.query = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.sourceLevel = this.element.querySelector('[name="sourceLevel"]')?.value ?? "";
    this.sourceTrait = this.element.querySelector('[name="sourceTrait"]')?.value ?? "";
    this.sourcePage = 0;
    await this.loadSources();
    await this.render();
  }

  static async previousSources() {
    this.sourcePage = Math.max(0, this.sourcePage - 1);
    await this.loadSources();
    await this.render();
  }

  static async nextSources() {
    this.sourcePage += 1;
    await this.loadSources();
    await this.render();
  }

  static async previewSource(_event, target) {
    this.sourcePreview = await lsBuildSourcePreview(target.dataset.uuid);
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

  static async addTrait() {
    const trait = this.element.querySelector('[name="traitToAdd"]')?.value;
    if (!trait) return;
    const traits = new Set(lsTraits(this.item));
    traits.add(trait);
    await this.item.update({ "system.traits.value": [...traits] });
    await this.render();
  }

  static async removeTrait(_event, target) {
    const traits = lsTraits(this.item).filter((trait) => trait !== target.dataset.trait);
    await this.item.update({ "system.traits.value": traits });
    await this.render();
  }

  static async finish() {
    await this.saveStep();
    await this.item.setFlag(LS_MODULE_ID, "builderComplete", true);
    await this.close();
    this.item.sheet.render(true);
  }
}

class LoreSmithLiveLog extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-live-log",
    classes: ["lore-smith-live-log"],
    position: { width: 560, height: 680, left: 70, top: 70 },
    window: { title: "Lore Smith Live Combat", icon: "fa-solid fa-swords", resizable: true },
    actions: {
      togglePause: LoreSmithLiveLog.togglePause,
      stop: LoreSmithLiveLog.stop,
    },
  };

  static PARTS = {
    log: { template: `modules/${LS_MODULE_ID}/templates/live-combat.hbs` },
  };

  entries = [];
  running = true;
  paused = false;
  stopped = false;
  status = "Preparing encounter";
  summary = null;

  async _prepareContext(options) {
    return {
      ...await super._prepareContext(options),
      entries: this.entries,
      delay: game.settings.get(LS_MODULE_ID, "liveActionDelay"),
      delaySeconds: (game.settings.get(LS_MODULE_ID, "liveActionDelay") / 1000).toFixed(2),
      running: this.running,
      paused: this.paused,
      stopped: this.stopped,
      status: this.status,
      summary: this.summary,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const slider = this.element?.querySelector('[name="liveDelay"]');
    const label = this.element?.querySelector('[data-role="delayLabel"]');
    slider?.addEventListener("input", async () => {
      const value = Number(slider.value);
      if (label) label.textContent = `${(value / 1000).toFixed(2)} seconds`;
      await game.settings.set(LS_MODULE_ID, "liveActionDelay", value);
    });
    const log = this.element?.querySelector(".ls-live-entries");
    if (log) log.scrollTop = log.scrollHeight;
    this.bringToTop?.();
  }

  async add(entry) {
    this.entries.push(entry);
    if (this.entries.length > 500) this.entries.shift();
    const list = this.element?.querySelector(".ls-live-entries");
    if (!list) return this.render({ force: true });
    list.querySelector(".empty")?.remove();
    const row = document.createElement("p");
    row.className = entry.kind ?? "action";
    row.textContent = entry.text;
    list.append(row);
    list.scrollTop = list.scrollHeight;
  }

  async complete() {
    this.running = false;
    this.status = this.stopped ? "Stopped by the GM"
      : this.status === "Running" ? "Simulation complete" : this.status;
    await this.render({ force: true });
  }

  isPaused() {
    return this.paused;
  }

  isStopped() {
    return this.stopped;
  }

  static async togglePause() {
    if (!this.running || this.stopped) return;
    this.paused = !this.paused;
    this.status = this.paused ? "Paused" : "Running";
    await this.render({ force: true });
  }

  static async stop() {
    if (!this.running) return;
    this.stopped = true;
    this.paused = false;
    this.status = "Stopping";
    await this.render({ force: true });
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

const LS_CREATURE_XP = new Map([
  [-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40],
  [1, 60], [2, 80], [3, 120], [4, 160],
]);

const LS_DIFFICULTY_BUDGETS = [
  { name: "Trivial", xp: 40 },
  { name: "Low", xp: 60 },
  { name: "Moderate", xp: 80 },
  { name: "Severe", xp: 120 },
  { name: "Extreme", xp: 160 },
];

function lsInterpolatedDifficulty(xp) {
  if (xp < LS_DIFFICULTY_BUDGETS[0].xp) return "Trivial-";
  for (let index = 0; index < LS_DIFFICULTY_BUDGETS.length; index += 1) {
    const current = LS_DIFFICULTY_BUDGETS[index];
    if (xp === current.xp) return current.name;
    const next = LS_DIFFICULTY_BUDGETS[index + 1];
    if (!next || xp > next.xp) continue;
    const progress = (xp - current.xp) / (next.xp - current.xp);
    if (progress < 0.25) return current.name;
    if (progress < 0.58) return `${current.name}+`;
    return `${next.name}-`;
  }
  return "Extreme+";
}

function lsEncounterDifficulty(sides) {
  const party = sides.tokens.filter((token) => sides.partyIds.has(token.id));
  const enemies = sides.tokens.filter((token) => sides.enemyIds.has(token.id));
  const partyLevel = Math.round(party.reduce((sum, token) =>
    sum + lsNumber(token.actor?.system?.details?.level, 0), 0) / Math.max(1, party.length));
  const creatureXp = enemies.reduce((sum, token) => {
    const difference = lsNumber(token.actor?.system?.details?.level, 0) - partyLevel;
    if (difference > 4) return sum + 240;
    if (difference < -4) return sum;
    return sum + (LS_CREATURE_XP.get(difference) ?? 0);
  }, 0);
  const adjustedXp = creatureXp * 4 / Math.max(1, party.length);
  return {
    label: lsInterpolatedDifficulty(adjustedXp),
    creatureXp,
    adjustedXp: Math.round(adjustedXp),
    partyLevel,
    partySize: party.length,
  };
}

function lsRunEncounterSample(sides, iterations, captureCount = 0) {
  let wins = 0;
  let rounds = 0;
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = game.loreSmith.simulateEncounter(sides.tokens, sides.partyIds, sides.enemyIds, {
      captureLog: index < captureCount,
    });
    if (result.partyWon) wins += 1;
    rounds += result.rounds;
    if (index < captureCount) samples.push(result);
  }
  return {
    wins,
    iterations,
    victoryRate: ((wins / iterations) * 100).toFixed(1),
    averageRounds: (rounds / iterations).toFixed(1),
    samples,
    difficulty: lsEncounterDifficulty(sides),
  };
}

async function lsRunIterations() {
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    return ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
  }
  const iterations = Math.max(1, Math.min(1000, game.settings.get(LS_MODULE_ID, "combatIterations")));
  const report = lsRunEncounterSample(sides, iterations, 20);
  const logHtml = report.samples.map((sample, index) => `
    <details ${index === 0 ? "open" : ""}>
      <summary>Iteration ${index + 1} · ${sample.partyWon ? "Characters win" : "Opposition wins"} · ${sample.rounds} rounds</summary>
      ${sample.log.map((entry) => `<p class="${entry.kind}">${foundry.utils.escapeHTML(entry.text)}</p>`).join("")}
    </details>`).join("");
  const content = `<div class="ls-combat-report">
    <header>
      <article><span>Character victory</span><strong>${report.victoryRate}%</strong><small>${report.wins}/${iterations} combats</small></article>
      <article><span>Rules-based difficulty</span><strong>${report.difficulty.label}</strong><small>${report.difficulty.creatureXp} creature XP · ${report.difficulty.adjustedXp} party-adjusted XP · party level ${report.difficulty.partyLevel}</small></article>
      <article><span>Average duration</span><strong>${report.averageRounds}</strong><small>rounds</small></article>
    </header>
    <p>Victory is a randomized simulation estimate. Difficulty is calculated separately from PF2e encounter XP, adjusted for a ${report.difficulty.partySize}-character party.</p>
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
  const log = new LoreSmithLiveLog({
    id: `lore-smith-live-log-${foundry.utils.randomID(6)}`,
  });
  await log.render(true);
  await log.add({ text: "Preparing the current Combat Tracker encounter...", kind: "round" });
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    log.status = "Cannot start";
    await log.add({ text: "Add at least one friendly and one hostile combatant to the active Combat Tracker, then press Live Combat again.", kind: "error" });
    await log.complete();
    ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
    return;
  }
  try {
    const previewIterations = Math.max(20, Math.min(200, game.settings.get(LS_MODULE_ID, "combatIterations")));
    const preview = lsRunEncounterSample(sides, previewIterations);
    log.summary = {
      victoryRate: `${preview.victoryRate}%`,
      difficulty: preview.difficulty.label,
      difficultyDetail: `${preview.difficulty.creatureXp} creature XP · ${preview.difficulty.adjustedXp} adjusted XP`,
      averageRounds: preview.averageRounds,
      iterations: previewIterations,
    };
    if (!sides.combat.started) await sides.combat.startCombat();
    const liveCombat = game.combat ?? sides.combat;
    const missingInitiative = liveCombat.combatants.filter((combatant) => combatant.initiative === null).map((combatant) => combatant.id);
    if (missingInitiative.length) await liveCombat.rollInitiative(missingInitiative);
    log.status = "Running";
    await log.render({ force: true });
    ui.notifications.info("Lore Smith live combat started. Use the separate window to read the log and change its speed.");
    await game.loreSmith.runLiveReplay(sides.tokens, sides.partyIds, sides.enemyIds, {
      combat: liveCombat,
      onLog: (entry) => log.add(entry),
      delay: () => game.settings.get(LS_MODULE_ID, "liveActionDelay"),
      control: log,
    });
  } catch (error) {
    console.error(`${LS_MODULE_ID} | Live combat failed`, error);
    log.status = "Stopped by an error";
    await log.add({ text: `Live combat stopped: ${error.message}`, kind: "error" });
    ui.notifications.error(`Lore Smith live combat stopped: ${error.message}`);
  } finally {
    await log.complete();
  }
}

function lsActivateJournalWikiLinks(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(".ls-journal-wiki-link, [contenteditable='true'], script, style, textarea")) {
        return NodeFilter.FILTER_REJECT;
      }
      return /\[\[[^\]\n]{1,100}\]\]/.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/\[\[([^\]\n]{1,100})\]\]/g)) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const name = match[1].trim();
      const link = document.createElement("a");
      link.className = "ls-journal-wiki-link";
      link.dataset.pageName = name;
      link.href = "#";
      link.tabIndex = 0;
      link.title = `Open or create page "${name}" in this Journal`;
      link.textContent = name;
      fragment.append(link);
      cursor = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

function lsEmbedNativeJournalEditor(pageSheet, html) {
  const page = pageSheet.object ?? pageSheet.document;
  const journal = page?.parent;
  if (!pageSheet.isEditable || journal?.documentName !== "JournalEntry") return;
  const journalSheet = journal.sheet;
  const journalRoot = lsRoot(journalSheet?.element);
  const pageNode = journalRoot?.querySelector(`.journal-entry-page[data-page-id="${page.id}"]`);
  const wrapper = lsRoot(pageSheet.element) ?? lsRoot(html)?.closest?.(".window-app, .application");
  if (!pageNode || !wrapper || wrapper.dataset.loreSmithEmbeddedEditor === "ready") return;

  wrapper.dataset.loreSmithEmbeddedEditor = "ready";
  wrapper.classList.add("ls-inline-journal-page-sheet");
  const host = document.createElement("section");
  host.className = "ls-inline-journal-editor";
  const toolbar = document.createElement("header");
  toolbar.className = "ls-inline-journal-editor-header";
  toolbar.innerHTML = `
    <strong><i class="fa-solid fa-feather-pointed"></i> Editing ${foundry.utils.escapeHTML(page.name)}</strong>
    <button type="button"><i class="fa-solid fa-arrow-left"></i> Back to page</button>`;
  toolbar.querySelector("button").addEventListener("click", async () => {
    await pageSheet.close();
    await journalSheet.render(true, { pageId: page.id });
  });
  host.append(toolbar, wrapper);
  pageNode.replaceChildren(host);
  wrapper.style.removeProperty("left");
  wrapper.style.removeProperty("top");
  wrapper.style.removeProperty("width");
  wrapper.style.removeProperty("height");
  journalSheet.bringToTop?.();
}

function lsEnhanceNativeJournal(app, html) {
  const journal = app.document;
  const root = lsRoot(html);
  if (journal?.documentName !== "JournalEntry" || !root) return;
  const containers = [
    ...root.querySelectorAll(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content"),
  ];
  for (const container of new Set(containers)) lsActivateJournalWikiLinks(container);
  if (root.dataset.loreSmithWikiLinks === "ready") return;
  root.dataset.loreSmithWikiLinks = "ready";
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.matches(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content")) {
          lsActivateJournalWikiLinks(added);
        }
        for (const container of added.querySelectorAll?.(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content") ?? []) {
          lsActivateJournalWikiLinks(container);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", async (event) => {
    const link = event.target.closest?.(".ls-journal-wiki-link");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const pageName = link.dataset.pageName?.trim();
    if (!pageName) return;
    let page = journal.pages.find((candidate) =>
      candidate.name.localeCompare(pageName, undefined, { sensitivity: "accent" }) === 0);
    if (!page) {
      [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: pageName,
        type: "text",
        text: { content: "" },
        sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
      }]);
      ui.notifications.info(`Created page "${pageName}" inside ${journal.name}.`);
    }
    await app.render(true);
    if (typeof app.goToPage === "function") await app.goToPage(page.id);
    else {
      const pageControl = app.element?.querySelector(`[data-page-id="${page.id}"]`);
      pageControl?.click();
      pageControl?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
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
  if (!root) return;
  const header = root.closest(".app")?.querySelector(".window-header") ?? root.querySelector(".window-header");
  if (!header) return;
  const existing = [...header.querySelectorAll(`[data-lore-smith-builder="${kind}"]`)];
  if (existing.length) {
    for (const duplicate of existing.slice(1)) duplicate.remove();
    return;
  }
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
  game.settings.register(LS_MODULE_ID, "liveActionDelay", {
    name: "Live combat action delay",
    hint: "Milliseconds between live actions. This can also be changed while the live combat window is open.",
    scope: "world",
    config: true,
    type: Number,
    default: 1750,
    range: { min: 250, max: 10000, step: 250 },
  });
  game.settings.register(LS_MODULE_ID, "mirrorLiveToChat", {
    name: "Copy live combat to Chat",
    hint: "Disabled by default. Enable this only if you also want Lore Smith actions copied to Foundry Chat.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
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

Hooks.on("renderJournalSheet", (app, html) => {
  lsEnhanceNativeJournal(app, html);
});

Hooks.on("renderJournalPageSheet", lsEmbedNativeJournalEditor);
Hooks.on("renderJournalTextPageSheet", lsEmbedNativeJournalEditor);

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
  } else if (document?.documentName === "JournalEntry") {
    lsEnhanceNativeJournal(app, html);
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
