const MODULE_ID = "lore-smith";
const FLAG_SCOPE = MODULE_ID;

const ITEM_TYPE_LABELS = {
  action: "Action",
  affliction: "Affliction",
  ancestry: "Ancestry",
  armor: "Armor",
  background: "Background",
  backpack: "Container",
  class: "Class",
  condition: "Condition",
  consumable: "Consumable",
  effect: "Effect",
  equipment: "Equipment",
  feat: "Feat",
  heritage: "Heritage",
  kit: "Kit",
  lore: "Lore",
  melee: "NPC Strike",
  shield: "Shield",
  spell: "Spell",
  spellcastingEntry: "Spellcasting Entry",
  treasure: "Treasure",
  weapon: "Weapon",
};

function numeric(value, fallback = 0) {
  const result = Number(value?.value ?? value?.mod ?? value?.modifier ?? value);
  return Number.isFinite(result) ? result : fallback;
}

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function actorLevel(actor) {
  return numeric(actor?.system?.details?.level, 0);
}

function actorHp(actor) {
  const hp = actor?.system?.attributes?.hp ?? {};
  return { value: numeric(hp.value), max: Math.max(1, numeric(hp.max, numeric(hp.value, 1))) };
}

function actorAc(actor) {
  return numeric(actor?.system?.attributes?.ac, 10);
}

function actorInitiative(actor) {
  return numeric(actor?.perception ?? actor?.system?.perception, actorLevel(actor) + 2);
}

function averagePartyLevel(combatants) {
  if (!combatants.length) return 0;
  return Math.round(combatants.reduce((sum, combatant) => sum + combatant.level, 0) / combatants.length);
}

function creatureXp(level, partyLevel) {
  const table = new Map([[-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40], [1, 60], [2, 80], [3, 120], [4, 160]]);
  const difference = Math.max(-4, Math.min(4, level - partyLevel));
  return table.get(difference) ?? 0;
}

function encounterDifficulty(xp, partySize) {
  const extra = partySize - 4;
  const budgets = [
    ["Trivial", 40 + extra * 10],
    ["Low", 60 + extra * 15],
    ["Moderate", 80 + extra * 20],
    ["Severe", 120 + extra * 30],
    ["Extreme", 160 + extra * 40],
  ];
  if (xp < budgets[0][1]) return { label: "Trivial−", budgets };
  let closest = budgets[0];
  for (const budget of budgets) {
    if (xp >= budget[1]) closest = budget;
  }
  const index = budgets.indexOf(closest);
  const next = budgets[index + 1];
  if (!next) return { label: xp > closest[1] ? "Extreme+" : "Extreme", budgets };
  const progress = (xp - closest[1]) / Math.max(1, next[1] - closest[1]);
  return { label: `${closest[0]}${progress >= 0.66 ? "+" : progress < 0.2 ? "−" : ""}`, budgets };
}

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * Math.max(1, sides));
}

function rollFormula(formula = "1") {
  const clean = String(formula).replace(/\s+/g, "").replace(/\[[^\]]*]/g, "");
  let total = 0;
  let matched = false;
  const terms = clean.match(/[+-]?(?:\d+d\d+|\d+(?:\.\d+)?)/gi) ?? [];
  for (const raw of terms) {
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    const dice = term.match(/^(\d+)d(\d+)$/i);
    if (dice) {
      matched = true;
      for (let index = 0; index < Number(dice[1]); index += 1) total += sign * rollDie(Number(dice[2]));
    } else if (Number.isFinite(Number(term))) {
      matched = true;
      total += sign * Number(term);
    }
  }
  return matched ? Math.floor(total) : 1;
}

function degreeOfSuccess(total, dc, natural) {
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) degree = Math.min(3, degree + 1);
  if (natural === 1) degree = Math.max(0, degree - 1);
  return degree;
}

function degreeLabel(degree) {
  return ["critical failure", "failure", "success", "critical success"][degree] ?? "failure";
}

function strikeDamageFormula(action) {
  const rolls = action?.damageRolls ?? action?.damage ?? {};
  const first = Object.values(rolls)[0];
  const prepared = first?.formula ?? first?.damage ?? (typeof first === "string" ? first : "");
  if (prepared) return prepared;
  const damage = action?.item?.system?.damage ?? {};
  if (damage.dice && damage.die) return `${damage.dice}${damage.die}+${numeric(damage.modifier, 0)}`;
  return "1d6";
}

function actorStrikes(actor) {
  const prepared = [...(actor?.system?.actions ?? [])].filter((action) =>
    action.type === "strike" || action.item?.type === "weapon" || action.item?.type === "melee");
  if (prepared.length) {
    return prepared.map((action) => ({
      name: action.label ?? action.name ?? action.item?.name ?? "Strike",
      modifier: numeric(action.variants?.[0] ?? action, actorLevel(actor) + 6),
      damage: strikeDamageFormula(action),
      range: numeric(action.range?.increment ?? action.item?.system?.range, 5),
    }));
  }
  return [{
    name: "Unarmed Strike",
    modifier: actorLevel(actor) + 6,
    damage: actorLevel(actor) >= 4 ? "2d4+3" : "1d4+2",
    range: 5,
  }];
}

function healingOptions(actor) {
  return [...(actor?.items ?? [])].filter((item) => {
    const traits = item.system?.traits?.value ?? [];
    return traits.includes("healing") || /\bheal|lay on hands|soothe\b/i.test(item.name);
  }).map((item) => {
    const damages = Object.values(item.system?.damage ?? {});
    const formula = damages.find((damage) => damage?.formula)?.formula
      ?? (/lay on hands/i.test(item.name) ? `${Math.max(1, Math.ceil(actorLevel(actor) / 2)) * 6}` : "1d8+8");
    return { name: item.name, formula };
  });
}

function virtualCombatant(token, team) {
  const actor = token.actor;
  const hp = actorHp(actor);
  return {
    id: token.id,
    token,
    actor,
    name: token.name || actor.name,
    team,
    level: actorLevel(actor),
    hp: hp.value || hp.max,
    maxHp: hp.max,
    ac: actorAc(actor),
    initiative: actorInitiative(actor),
    strikes: actorStrikes(actor),
    heals: healingOptions(actor),
    defeated: false,
  };
}

function chooseTarget(actor, combatants) {
  const enemies = combatants.filter((candidate) => candidate.team !== actor.team && !candidate.defeated);
  return enemies.sort((left, right) => left.hp - right.hp || left.ac - right.ac)[0] ?? null;
}

function chooseHealingTarget(actor, combatants) {
  return combatants
    .filter((candidate) => candidate.team === actor.team && !candidate.defeated && candidate.hp / candidate.maxHp <= 0.35)
    .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0] ?? null;
}

function simulateEncounter(tokens, partyIds, enemyIds, { captureLog = false } = {}) {
  const combatants = tokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  const log = [];
  const push = (text, kind = "action") => captureLog && log.push({ text, kind });
  const initiatives = combatants
    .map((combatant) => ({ combatant, score: rollDie(20) + combatant.initiative }))
    .sort((left, right) => right.score - left.score);
  push(`Initiative: ${initiatives.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}.`, "round");

  let rounds = 0;
  while (rounds < 30) {
    rounds += 1;
    push(`Round ${rounds}`, "round");
    for (const turn of initiatives) {
      const attacker = turn.combatant;
      if (attacker.defeated) continue;
      const healingTarget = attacker.heals.length ? chooseHealingTarget(attacker, combatants) : null;
      if (healingTarget) {
        const healing = attacker.heals[0];
        const amount = Math.max(1, rollFormula(healing.formula));
        const before = healingTarget.hp;
        healingTarget.hp = Math.min(healingTarget.maxHp, healingTarget.hp + amount);
        push(`${attacker.name} uses ${healing.name} on ${healingTarget.name}, restoring ${healingTarget.hp - before} HP; ${healingTarget.name} has ${healingTarget.hp}/${healingTarget.maxHp} HP.`, "heal");
      }
      let map = 0;
      for (let action = healingTarget ? 1 : 0; action < 3; action += 1) {
        const target = chooseTarget(attacker, combatants);
        if (!target) break;
        const strike = attacker.strikes[0];
        const natural = rollDie(20);
        const modifier = strike.modifier - map;
        const total = natural + modifier;
        const degree = degreeOfSuccess(total, target.ac, natural);
        if (degree >= 2) {
          const rolled = Math.max(1, rollFormula(strike.damage));
          const damage = degree === 3 ? rolled * 2 : rolled;
          target.hp = Math.max(0, target.hp - damage);
          target.defeated = target.hp <= 0;
          push(`${attacker.name} targets ${target.name} with ${strike.name}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs AC ${target.ac}, ${degreeLabel(degree)}; ${damage} damage. ${target.name} has ${target.hp}/${target.maxHp} HP.`, "damage");
        } else {
          push(`${attacker.name} targets ${target.name} with ${strike.name}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs AC ${target.ac}, ${degreeLabel(degree)}.`, "action");
        }
        map += 5;
      }
      if (!combatants.some((candidate) => candidate.team === "party" && !candidate.defeated)
        || !combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated)) break;
    }
    if (!combatants.some((candidate) => candidate.team === "party" && !candidate.defeated)
      || !combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated)) break;
  }
  const partyAlive = combatants.some((candidate) => candidate.team === "party" && !candidate.defeated);
  const enemyAlive = combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated);
  return { partyWon: partyAlive && !enemyAlive, rounds, log };
}

async function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sceneDistance(left, right) {
  const grid = canvas.grid;
  const leftCenter = left.center ?? { x: left.x + left.w / 2, y: left.y + left.h / 2 };
  const rightCenter = right.center ?? { x: right.x + right.w / 2, y: right.y + right.h / 2 };
  return grid.measurePath([leftCenter, rightCenter]).distance;
}

async function moveToward(attacker, target) {
  const token = attacker.token.object;
  const targetToken = target.token.object;
  if (!token || !targetToken) return false;
  const distance = await sceneDistance(token, targetToken);
  if (distance <= 5) return false;
  const speed = numeric(attacker.actor.system?.attributes?.speed, 25);
  const pixelsPerFoot = canvas.grid.size / canvas.grid.distance;
  const start = token.center;
  const end = targetToken.center;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const travel = Math.min(speed * pixelsPerFoot, Math.max(0, length - canvas.grid.size));
  const destination = {
    x: start.x + (dx / length) * travel,
    y: start.y + (dy / length) * travel,
  };
  const snapped = canvas.grid.getSnappedPoint(destination, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
  const topLeft = { x: snapped.x - token.w / 2, y: snapped.y - token.h / 2 };
  const collision = token.checkCollision?.(snapped, { origin: start, type: "move", mode: "any" });
  if (collision) return false;
  await attacker.token.update(topLeft, { animate: true, animation: { duration: 650 } });
  return true;
}

async function runLiveReplay(tokens, partyIds, enemyIds) {
  const combatants = tokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  const order = combatants
    .map((combatant) => ({ combatant, score: rollDie(20) + combatant.initiative }))
    .sort((left, right) => right.score - left.score);
  await ChatMessage.create({
    speaker: { alias: "Lore Smith" },
    content: `<h3>Lore Smith live encounter</h3><p><strong>Initiative</strong> ${order.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}</p>`,
  });
  for (let round = 1; round <= 20; round += 1) {
    await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<h3>Round ${round}</h3>` });
    for (const entry of order) {
      const attacker = entry.combatant;
      if (attacker.defeated) continue;
      const target = chooseTarget(attacker, combatants);
      if (!target) return;
      const moved = await moveToward(attacker, target);
      if (moved) {
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }), content: `<p><strong>${attacker.name}</strong> Strides toward ${target.name}.</p>` });
        await pause(500);
      }
      const strike = attacker.strikes[0];
      const natural = rollDie(20);
      const total = natural + strike.modifier;
      const degree = degreeOfSuccess(total, target.ac, natural);
      let content = `<p><strong>${attacker.name}</strong> targets <strong>${target.name}</strong> with ${strike.name}: [[${natural} + ${strike.modifier}]] = ${total} vs AC ${target.ac}, <strong>${degreeLabel(degree)}</strong>.</p>`;
      if (degree >= 2) {
        const rolled = Math.max(1, rollFormula(strike.damage));
        const damage = degree === 3 ? rolled * 2 : rolled;
        target.hp = Math.max(0, target.hp - damage);
        target.defeated = target.hp <= 0;
        content += `<p>${target.name} takes <strong>${damage} damage</strong> and has ${target.hp}/${target.maxHp} virtual HP.</p>`;
      }
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }), content });
      target.token.object?.control({ releaseOthers: true });
      await canvas.animatePan({ x: target.token.object?.center.x, y: target.token.object?.center.y, duration: 350 });
      await pause(650);
      if (!combatants.some((candidate) => candidate.team === "party" && !candidate.defeated)
        || !combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated)) {
        const winner = combatants.some((candidate) => candidate.team === "party" && !candidate.defeated) ? "Characters" : "Opposition";
        await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<h2>${winner} win the encounter</h2>` });
        return;
      }
    }
  }
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class LoreSmithDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-dashboard",
    classes: ["lore-smith-app"],
    tag: "section",
    position: { width: 1120, height: 760 },
    window: { title: "Lore Smith", icon: "fa-solid fa-book-sparkles", resizable: true },
    actions: {
      tab: LoreSmithDashboard.changeTab,
      createNote: LoreSmithDashboard.createNote,
      openNote: LoreSmithDashboard.openNote,
      searchCreatures: LoreSmithDashboard.searchCreatures,
      cloneCreature: LoreSmithDashboard.cloneCreature,
      blankCreature: LoreSmithDashboard.blankCreature,
      searchItems: LoreSmithDashboard.searchItems,
      cloneItem: LoreSmithDashboard.cloneItem,
      blankItem: LoreSmithDashboard.blankItem,
      refreshEncounter: LoreSmithDashboard.refreshEncounter,
      runEstimate: LoreSmithDashboard.runEstimate,
      runLive: LoreSmithDashboard.runLive,
    },
  };

  static PARTS = {
    dashboard: { template: `modules/${MODULE_ID}/templates/dashboard.hbs` },
  };

  activeTab = "notes";
  creatureSearch = "";
  itemSearch = "";
  itemType = "";
  creatureResults = [];
  itemResults = [];
  partyIds = new Set();
  enemyIds = new Set();
  iterations = 100;
  result = null;

  async _prepareContext(options) {
    const sceneTokens = (canvas?.scene?.tokens?.contents ?? []).filter((token) => token.actor).map((token) => {
      const actor = token.actor;
      const hp = actorHp(actor);
      return {
        id: token.id,
        name: token.name || actor.name,
        img: token.texture?.src || actor.img,
        level: actorLevel(actor),
        hp: `${hp.value}/${hp.max}`,
        ac: actorAc(actor),
        isCharacter: actor.type === "character",
        party: this.partyIds.has(token.id),
        enemy: this.enemyIds.has(token.id),
      };
    });
    const notes = game.journal
      .filter((entry) => entry.getFlag(FLAG_SCOPE, "note"))
      .map((entry) => ({ id: entry.id, name: entry.name, pages: entry.pages.size }));
    return {
      ...await super._prepareContext(options),
      tabs: { [this.activeTab]: true },
      notes,
      creatureSearch: this.creatureSearch,
      itemSearch: this.itemSearch,
      itemTypes: Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label, selected: value === this.itemType })),
      creatureResults: this.creatureResults,
      itemResults: this.itemResults,
      sceneReady: Boolean(canvas?.scene),
      sceneTokens,
      iterations: this.iterations,
      result: this.result,
    };
  }

  captureEncounterSelection() {
    const root = this.element;
    if (!root) return;
    this.partyIds = new Set([...root.querySelectorAll('input[name="partyToken"]:checked')].map((input) => input.value));
    this.enemyIds = new Set([...root.querySelectorAll('input[name="enemyToken"]:checked')].map((input) => input.value));
    this.iterations = Math.max(1, Math.min(1000, numeric(root.querySelector('input[name="iterations"]')?.value, 100)));
  }

  static async changeTab(event, target) {
    this.captureEncounterSelection();
    this.activeTab = target.dataset.tab;
    await this.render();
  }

  static async createNote() {
    const response = await foundry.applications.api.DialogV2.input({
      window: { title: "New Lore Smith Note" },
      content: '<label>Note name <input type="text" name="name" value="New Note" autofocus></label>',
      ok: { label: "Create note" },
      rejectClose: false,
    });
    if (!response) return;
    const noteName = response.name?.trim() || "New Note";
    const journal = await JournalEntry.create({
      name: noteName,
      flags: { [FLAG_SCOPE]: { note: true } },
      pages: [{ name: noteName, type: "text", text: { content: "" } }],
    });
    journal.sheet.render(true);
    await this.render();
  }

  static async openNote(_event, target) {
    game.journal.get(target.dataset.id)?.sheet.render(true);
  }

  static async searchCreatures() {
    this.creatureSearch = this.element.querySelector('[name="creatureSearch"]')?.value.trim() ?? "";
    if (this.creatureSearch.length < 2) {
      ui.notifications.warn("Enter at least two letters to search creatures.");
      return;
    }
    const query = this.creatureSearch.toLowerCase();
    const results = [];
    for (const pack of game.packs.filter((candidate) => candidate.documentName === "Actor")) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", "system.details.level.value"] });
      for (const entry of index) {
        if (entry.type !== "npc" || !entry.name.toLowerCase().includes(query)) continue;
        results.push({
          name: entry.name,
          img: entry.img,
          level: numeric(entry.system?.details?.level, 0),
          packLabel: pack.metadata.label,
          uuid: entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`,
        });
        if (results.length >= 80) break;
      }
      if (results.length >= 80) break;
    }
    this.creatureResults = results.sort((left, right) => left.name.localeCompare(right.name));
    await this.render();
  }

  static async cloneCreature(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e creature.");
    const data = source.toObject();
    delete data._id;
    data.name = `${data.name} (Lore Smith)`;
    data.folder = null;
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [FLAG_SCOPE]: { created: true, sourceUuid: source.uuid } });
    const actor = await Actor.create(data);
    actor.sheet.render(true);
    ui.notifications.info(`Created editable PF2e actor: ${actor.name}.`);
  }

  static async blankCreature() {
    const actor = await Actor.create({
      name: "New Creature",
      type: "npc",
      flags: { [FLAG_SCOPE]: { created: true } },
      system: {
        details: { level: { value: 0 }, publication: { license: "ORC", remaster: true, title: "Lore Smith" } },
        traits: { rarity: "common", size: { value: "med" }, value: [] },
      },
    });
    actor.sheet.render(true);
  }

  static async searchItems() {
    this.itemSearch = this.element.querySelector('[name="itemSearch"]')?.value.trim() ?? "";
    this.itemType = this.element.querySelector('[name="itemType"]')?.value ?? "";
    if (this.itemSearch.length < 2) {
      ui.notifications.warn("Enter at least two letters to search items.");
      return;
    }
    const query = this.itemSearch.toLowerCase();
    const results = [];
    for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", "system.level.value"] });
      for (const entry of index) {
        if (this.itemType && entry.type !== this.itemType) continue;
        if (!entry.name.toLowerCase().includes(query)) continue;
        results.push({
          name: entry.name,
          img: entry.img,
          type: ITEM_TYPE_LABELS[entry.type] ?? entry.type,
          level: numeric(entry.system?.level, 0),
          packLabel: pack.metadata.label,
          uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`,
        });
        if (results.length >= 100) break;
      }
      if (results.length >= 100) break;
    }
    this.itemResults = results.sort((left, right) => left.name.localeCompare(right.name));
    await this.render();
  }

  static async cloneItem(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e item.");
    const data = source.toObject();
    delete data._id;
    data.name = `${data.name} (Lore Smith)`;
    data.folder = null;
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [FLAG_SCOPE]: { created: true, sourceUuid: source.uuid } });
    const item = await Item.create(data);
    item.sheet.render(true);
    ui.notifications.info(`Created editable PF2e item: ${item.name}.`);
  }

  static async blankItem() {
    const response = await foundry.applications.api.DialogV2.input({
      window: { title: "Create Blank PF2e Item" },
      content: `<label>Item type <select name="type">${["equipment", "consumable", "weapon", "armor", "shield", "action", "effect"].map((type) => `<option value="${type}">${ITEM_TYPE_LABELS[type]}</option>`).join("")}</select></label>`,
      ok: { label: "Create item" },
      rejectClose: false,
    });
    if (!response?.type) return;
    const item = await Item.create({
      name: "New Item",
      type: response.type,
      flags: { [FLAG_SCOPE]: { created: true } },
      system: {
        level: { value: 0 },
        publication: { license: "ORC", remaster: true, title: "Lore Smith" },
        traits: { rarity: "common", value: [] },
      },
    });
    item.sheet.render(true);
  }

  static async refreshEncounter() {
    this.captureEncounterSelection();
    await this.render();
  }

  selectedSceneTokens() {
    const tokens = canvas?.scene?.tokens?.contents ?? [];
    return tokens.filter((token) => this.partyIds.has(token.id) || this.enemyIds.has(token.id));
  }

  validateEncounter() {
    this.captureEncounterSelection();
    if (!canvas?.scene) return ui.notifications.error("Open a Foundry Scene first.");
    if (!this.partyIds.size || !this.enemyIds.size) return ui.notifications.error("Choose at least one character and one opponent.");
    return true;
  }

  static async runEstimate() {
    if (!this.validateEncounter()) return;
    const tokens = this.selectedSceneTokens();
    let wins = 0;
    let rounds = 0;
    let sample = null;
    for (let index = 0; index < this.iterations; index += 1) {
      const result = simulateEncounter(tokens, this.partyIds, this.enemyIds, { captureLog: index === 0 });
      if (result.partyWon) wins += 1;
      rounds += result.rounds;
      if (index === 0) sample = result;
    }
    const party = tokens.filter((token) => this.partyIds.has(token.id)).map((token) => virtualCombatant(token, "party"));
    const enemies = tokens.filter((token) => this.enemyIds.has(token.id)).map((token) => virtualCombatant(token, "enemy"));
    const partyLevel = averagePartyLevel(party);
    const xp = enemies.reduce((sum, enemy) => sum + creatureXp(enemy.level, partyLevel), 0);
    this.result = {
      winRate: ((wins / this.iterations) * 100).toFixed(1),
      wins,
      iterations: this.iterations,
      averageRounds: (rounds / this.iterations).toFixed(1),
      partyLevel,
      xp,
      difficulty: encounterDifficulty(xp, party.length).label,
      log: sample?.log ?? [],
    };
    await this.render();
  }

  static async runLive() {
    if (!this.validateEncounter()) return;
    ui.notifications.info("Lore Smith live replay started. Watch the Scene canvas and Chat log.");
    this.minimize();
    try {
      await runLiveReplay(this.selectedSceneTokens(), this.partyIds, this.enemyIds);
    } catch (error) {
      console.error(`${MODULE_ID} | Live replay failed`, error);
      ui.notifications.error(`Live replay stopped: ${error.message}`);
    } finally {
      this.maximize();
    }
  }
}

let dashboard;

function openLoreSmith() {
  dashboard ??= new LoreSmithDashboard();
  dashboard.render(true);
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "openDashboard", {
    name: "Open Lore Smith",
    label: "Open Lore Smith",
    hint: "Open the Lore Smith PF2e Game Master workspace.",
    icon: "fa-solid fa-book-sparkles",
    type: LoreSmithDashboard,
    restricted: true,
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error("Lore Smith requires the Pathfinder Second Edition system.");
    return;
  }
  game.loreSmith = { open: openLoreSmith, simulateEncounter, runLiveReplay };
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM || game.system.id !== "pf2e") return;
  const tokenControls = controls.tokens ?? controls.find?.((control) => control.name === "token");
  const tools = tokenControls?.tools;
  if (!tools) return;
  const tool = {
    name: "lore-smith",
    title: "Lore Smith",
    icon: "fa-solid fa-book-sparkles",
    button: true,
    onClick: openLoreSmith,
  };
  if (Array.isArray(tools)) tools.push(tool);
  else tools["lore-smith"] = tool;
});

Hooks.on("renderSceneControls", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  root?.querySelector('[data-tool="lore-smith"]')?.classList.add("lore-smith-scene-control");
});
