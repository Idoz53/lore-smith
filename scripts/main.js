import {
  actionTargets,
  actionCoverageReport,
  applyConditions,
  buildActionCatalog,
  checkDegree,
  chooseAction as chooseCatalogAction,
  consumeUse,
  degreeText,
  rollFormulaValue,
  saveModifier,
  templateData,
} from "./combat-engine.js";
import {
  adjustDamageForIwr,
  applyNativeDefense,
  consumeNativeResource,
  applyNativeStructuredEffects,
  clickNativeCardEffect,
  postNativeActionCard,
  resolveModeledCheck,
  rollNativeDamage,
  resolveNativeCheck,
} from "./simulation-adapters.js";
import { getTacticalProfile } from "./tactical-profiles.js";

const MODULE_ID = "lore-smith";
const FLAG_SCOPE = MODULE_ID;

const ITEM_TYPE_LABELS = {
  action: "Action",
  ammo: "Ammunition",
  affliction: "Affliction",
  ancestry: "Ancestry",
  armor: "Armor",
  background: "Background",
  backpack: "Container",
  book: "Book",
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

function getHtmlRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
}

function escapeHtml(value = "") {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function activateWikiLinks(editor) {
  if (!editor) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(".ls-wiki-link")) return NodeFilter.FILTER_REJECT;
      return /\[\[[^\]\n]{1,100}\]\]/.test(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
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
      const link = document.createElement("span");
      link.className = "ls-wiki-link";
      link.dataset.noteName = match[1].trim();
      link.contentEditable = "false";
      link.tabIndex = 0;
      link.title = `Open or create “${match[1].trim()}”`;
      link.textContent = match[1].trim();
      fragment.append(link);
      cursor = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

function insertCompletedWikiPair() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer;
  const before = textNode.nodeValue?.slice(0, range.startOffset) ?? "";
  if (!before.endsWith("[")) return false;
  textNode.insertData(range.startOffset, "[]]");
  range.setStart(textNode, range.startOffset + 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

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
    if (!["spell", "action", "feat", "consumable"].includes(item.type)) return false;
    const traits = item.system?.traits?.value ?? [];
    const description = item.system?.description?.value ?? "";
    const damageEntries = Object.values(item.system?.damage ?? {});
    return damageEntries.some((entry) => entry?.kind === "healing" || entry?.kinds?.includes?.("healing") || entry?.type === "healing")
      || traits.includes("healing") && /@Damage\[[^\]]*\[healing\]/i.test(description);
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
  const options = buildActionCatalog(actor);
  const uses = new Map();
  for (const option of options) {
    if (option.limitedUses === null) continue;
    const key = option.useKey ?? option.id;
    if (!uses.has(key)) uses.set(key, option.limitedUses);
  }
  const conditions = new Map();
  for (const condition of actor.conditions ?? []) {
    const conditionSlug = condition.slug ?? condition.system?.slug;
    if (conditionSlug) conditions.set(conditionSlug, numeric(condition.value ?? condition.system?.value, 1));
  }
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
    options,
    uses,
    turnUses: new Set(),
    actionHistory: new Map(),
    targetUses: new Set(),
    cooldowns: new Map(),
    conditions,
    profile: getTacticalProfile(actor),
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

function applyVirtualStructuredEffects(option, attacker, target) {
  const notes = [];
  if (option.selfEffect) {
    const key = `effect:${slug(option.selfEffect.name ?? option.name)}`;
    attacker.conditions.set(key, 1);
    notes.push(option.selfEffect.name ?? option.name);
  }
  for (const operation of option.conditionOperations ?? []) {
    const recipient = operation.target === "self" ? attacker : target;
    if (operation.operation === "remove") {
      recipient.conditions.delete(operation.slug);
      notes.push(`removed ${operation.slug}`);
    } else if (operation.operation === "apply") {
      recipient.conditions.set(operation.slug, Math.max(recipient.conditions.get(operation.slug) ?? 0, operation.value ?? 1));
      notes.push(`${operation.slug}${Number(operation.value) > 1 ? ` ${operation.value}` : ""}`);
    }
  }
  return notes;
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
      attacker.turnUses.clear();
      attacker.conditions.delete("defended");
      for (const [key, roundsLeft] of attacker.cooldowns) {
        attacker.cooldowns.set(key, Math.max(0, roundsLeft - 1));
      }
      let actionsRemaining = 3;
      let map = 0;
      while (actionsRemaining > 0) {
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map, rounds);
        if (!choice) break;
        const { option, target, cost } = choice;
        actionsRemaining -= cost;
        consumeUse(attacker, option, target);
        if (option.healing) {
          const amount = Math.max(1, rollFormulaValue(option.healing));
          const before = target.hp;
          target.hp = Math.min(target.maxHp, target.hp + amount);
          target.defeated = false;
          push(`${attacker.name} uses ${option.name} on ${target.name}, restoring ${target.hp - before} HP; ${target.name} has ${target.hp}/${target.maxHp} HP.`, "heal");
          continue;
        }
        if (option.defensive && !option.damage) {
          attacker.conditions.set("defended", 1);
          push(`${attacker.name} uses ${option.name} and adopts a defensive stance; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "action");
          continue;
        }
        const targets = actionTargets(option, target, combatants);
        const outcomes = [];
        for (const affected of targets) {
          const modeledCheck = resolveModeledCheck({
            option,
            attacker,
            target: affected,
            mapPenalty: map,
            ac: (candidate) => {
              const penalty = (candidate.conditions.has("off-guard") || candidate.conditions.has("prone") ? 2 : 0)
                + Math.max(candidate.conditions.get("frightened") ?? 0, candidate.conditions.get("sickened") ?? 0);
              return Math.max(0, candidate.ac - penalty);
            },
            saveModifier,
            rollDie,
            checkDegree,
          });
          const multiplier = modeledCheck.multiplier;
          const effectApplies = option.save ? modeledCheck.degree <= 1 : option.automatic || modeledCheck.degree >= 2;
          const outcome = option.save
            ? `${affected.name} rolls ${option.save}: ${modeledCheck.total} vs DC ${modeledCheck.dc}, ${degreeText(modeledCheck.degree)} [explicit adapter]`
            : option.automatic
              ? `${affected.name}: no check is required by the PF2e entry`
              : `${affected.name}: ${modeledCheck.total} vs AC ${modeledCheck.dc}, ${degreeText(modeledCheck.degree)} [explicit adapter]`;
          let damage = 0;
          let damageNotes = [];
          if (option.damage && multiplier > 0) {
            const rolledDamage = Math.max(1, Math.floor(rollFormulaValue(option.damage) * multiplier));
            const adjusted = adjustDamageForIwr(rolledDamage, option.damageType, affected);
            damage = adjusted.amount;
            damageNotes = adjusted.notes;
            affected.hp = Math.max(0, affected.hp - damage);
            affected.defeated = affected.hp <= 0;
          }
          if (option.conditions.length && effectApplies) {
            for (const condition of option.conditions) {
              affected.conditions.set(condition.slug, Math.max(affected.conditions.get(condition.slug) ?? 0, condition.value));
            }
          }
          const structured = effectApplies ? applyVirtualStructuredEffects(option, attacker, affected) : [];
          outcomes.push(`${outcome}${option.damage && multiplier > 0 ? `; ${damage} ${option.damageType || ""} damage${damageNotes.length ? ` (${damageNotes.join(", ")})` : ""}, HP ${affected.hp}/${affected.maxHp}` : ""}${option.conditions.length && effectApplies ? `; ${option.conditions.map((condition) => `${condition.slug} ${condition.value}`).join(", ")}` : ""}${structured.length ? `; ${structured.join(", ")}` : ""}`);
        }
        push(`${attacker.name} uses ${option.name}${option.kind === "spell" ? " (spell)" : ""}, spending ${cost} action${cost === 1 ? "" : "s"}: ${outcomes.join(" | ")}.`, option.damage ? "damage" : "action");
        if (option.attackTrait) map += 5;
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

function simulateEncounterLegacy(tokens, partyIds, enemyIds, { captureLog = false } = {}) {
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

async function postPrivateGmRoll(roll, flavor) {
  const whisper = ChatMessage.getWhisperRecipients?.("GM")?.map((user) => user.id) ?? [];
  await roll.toMessage({
    speaker: { alias: "Lore Smith" },
    flavor,
    whisper,
  }, { rollMode: "gmroll" });
}

function liveRollSummary(roll) {
  const expression = roll.result ?? roll.formula ?? "roll";
  return `${expression} = ${Number(roll.total) || 0}`;
}

function liveCheckSummary(check) {
  if (!Number.isFinite(Number(check?.natural))) return String(check?.total ?? "automatic");
  const natural = Number(check.natural);
  const modifier = Number(check.total) - natural;
  return `d20 ${natural} ${modifier >= 0 ? "+" : "-"} ${Math.abs(modifier)} = ${check.total}`;
}

async function applyLiveDamage(target, formula, degree, multiplierOverride = null) {
  const before = actorHp(target.actor).value;
  const multiplier = multiplierOverride ?? (degree === 3 ? 2 : 1);
  const DamageRollClass = CONFIG.Dice.rolls?.find((RollClass) => RollClass.name === "DamageRoll");
  if (DamageRollClass && typeof target.actor.applyDamage === "function") {
    try {
      const damage = await new DamageRollClass(`{(${formula}) * ${multiplier}}`).evaluate();
      await postPrivateGmRoll(damage, `Damage roll against ${target.name}`);
      await target.actor.applyDamage({
        damage,
        token: target.token.object,
        item: null,
        rollOptions: new Set(["lore-smith", "action:live-combat"]),
        outcome: degree === 3 ? "criticalSuccess" : degree === 2 ? "success" : degree === 1 ? "failure" : "criticalFailure",
      });
      const after = actorHp(target.actor).value;
      target.hp = after;
      target.maxHp = actorHp(target.actor).max;
      target.defeated = after <= 0;
      return { amount: Math.max(0, before - after), roll: damage, summary: liveRollSummary(damage) };
    } catch (error) {
      console.warn(`${MODULE_ID} | PF2e damage application failed; using HP fallback.`, error);
    }
  }
  const damage = await new Roll(`(${formula}) * ${multiplier}`).evaluate();
  await postPrivateGmRoll(damage, `Damage roll against ${target.name}`);
  const rolled = Math.max(1, Number(damage.total) || 0);
  const after = Math.max(0, before - rolled);
  await target.actor.update({ "system.attributes.hp.value": after });
  target.hp = after;
  target.defeated = after <= 0;
  return { amount: Math.max(0, before - after), roll: damage, summary: liveRollSummary(damage) };
}

async function applyLiveHealing(target, formula) {
  const hp = actorHp(target.actor);
  const DamageRollClass = CONFIG.Dice.rolls?.find((RollClass) => RollClass.name === "DamageRoll");
  if (DamageRollClass && typeof target.actor.applyDamage === "function") {
    try {
      const healing = await new DamageRollClass(`{${formula}[healing]}`).evaluate();
      await postPrivateGmRoll(healing, `Healing roll for ${target.name}`);
      await target.actor.applyDamage({
        damage: healing,
        token: target.token.object,
        item: null,
        rollOptions: new Set(["lore-smith", "action:live-combat", "healing"]),
      });
      const afterNative = actorHp(target.actor);
      target.hp = afterNative.value;
      target.maxHp = afterNative.max;
      target.defeated = false;
      return { amount: Math.max(0, afterNative.value - hp.value), roll: healing, summary: liveRollSummary(healing) };
    } catch (error) {
      console.warn(`${MODULE_ID} | PF2e healing application failed; using HP fallback.`, error);
    }
  }
  const healing = await new Roll(formula).evaluate();
  await postPrivateGmRoll(healing, `Healing roll for ${target.name}`);
  const amount = Math.max(1, Number(healing.total) || 0);
  const after = Math.min(hp.max, hp.value + amount);
  await target.actor.update({ "system.attributes.hp.value": after });
  target.hp = after;
  target.maxHp = hp.max;
  target.defeated = false;
  return { amount: after - hp.value, roll: healing, summary: liveRollSummary(healing) };
}

async function applyNativeDamageOrHealing(target, roll, degree, option) {
  const nativeRoll = roll?.roll ?? roll?.rolls?.[0] ?? roll;
  if (!nativeRoll || typeof target.actor?.applyDamage !== "function") return null;
  const before = actorHp(target.actor);
  const outcome = option.healing
    ? null
    : degree === 3 ? "criticalSuccess"
      : degree === 2 ? "success"
        : degree === 1 ? "failure"
          : "criticalFailure";
  await target.actor.applyDamage({
    damage: nativeRoll,
    token: target.token.object,
    item: option.item ?? null,
    rollOptions: new Set(["lore-smith", "action:live-combat", option.healing ? "healing" : "damage"]),
    ...(outcome ? { outcome } : {}),
  });
  const after = actorHp(target.actor);
  target.hp = after.value;
  target.maxHp = after.max;
  target.defeated = after.value <= 0;
  return {
    amount: option.healing
      ? Math.max(0, after.value - before.value)
      : Math.max(0, before.value - after.value),
    roll: nativeRoll,
    summary: liveRollSummary(nativeRoll),
  };
}

async function sceneDistance(left, right) {
  const grid = canvas.grid;
  const leftCenter = left.center ?? { x: left.x + left.w / 2, y: left.y + left.h / 2 };
  const rightCenter = right.center ?? { x: right.x + right.w / 2, y: right.y + right.h / 2 };
  return grid.measurePath([leftCenter, rightCenter]).distance;
}

function combatantInsideTemplate(templateDocument, combatant) {
  const template = templateDocument?.object ?? canvas.templates?.get?.(templateDocument?.id);
  const token = combatant.token?.object;
  if (!template?.shape || !token) return false;
  const grid = canvas.grid;
  if (grid.type === CONST.GRID_TYPES.GRIDLESS) return template.testPoint(token.center);
  const [i0, j0, i1, j1] = grid.getOffsetRange(token.bounds);
  for (let i = i0; i < i1; i += 1) {
    for (let j = j0; j < j1; j += 1) {
      if (template.testPoint(grid.getCenterPoint({ i, j }))) return true;
    }
  }
  return false;
}

async function waitForTemplateShape(templateDocument) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const template = templateDocument?.object ?? canvas.templates?.get?.(templateDocument?.id);
    if (template?.shape) return true;
    await pause(25);
  }
  return false;
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

async function runLiveReplay(tokens, partyIds, enemyIds, {
  combat = game.combat,
  onLog = null,
  delay = game.settings.settings.has(`${MODULE_ID}.liveActionDelay`) ? game.settings.get(MODULE_ID, "liveActionDelay") : 1500,
  control = null,
} = {}) {
  const actionDelay = () => Math.max(100, Number(typeof delay === "function" ? delay() : delay) || 1500);
  const waitForControl = async () => {
    while (control?.isPaused?.() && !control?.isStopped?.()) await pause(100);
    return Boolean(control?.isStopped?.());
  };
  const activeCombat = () => {
    const candidate = (combat?.id && game.combats?.get(combat.id)) ?? game.combat;
    return candidate?.id && game.combats?.get(candidate.id) ? candidate : null;
  };
  const combatants = tokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  const order = [];
  for (const combatant of combatants) {
    const tracked = combat?.combatants?.find((entry) => entry.tokenId === combatant.id);
    let score = Number(tracked?.initiative);
    if (!Number.isFinite(score) && tracked && typeof combat?.rollInitiative === "function") {
      await combat.rollInitiative([tracked.id], {
        updateTurn: false,
        messageOptions: { rollMode: "gmroll" },
      });
      score = Number(combat.combatants?.get?.(tracked.id)?.initiative ?? tracked.initiative);
    }
    if (!Number.isFinite(score)) {
      const initiativeSlug = combatant.actor.system?.initiative?.statistic ?? "perception";
      const statistic = combatant.actor.getStatistic?.(initiativeSlug);
      const result = await statistic?.check?.roll?.({
        createMessage: true,
        skipDialog: true,
        rollMode: "gmroll",
        options: ["lore-smith", "action:roll-initiative"],
      });
      score = Number(result?.roll?.total ?? result?.total);
    }
    if (!Number.isFinite(score)) score = 0;
    order.push({ combatant, score, tracked });
  }
  order.sort((left, right) => right.score - left.score);
  const emit = async (text, kind = "action") => {
    await onLog?.({ text, kind, timestamp: Date.now() });
    if (game.settings.settings.has(`${MODULE_ID}.mirrorLiveToChat`) && game.settings.get(MODULE_ID, "mirrorLiveToChat")) {
      await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<p>${escapeHtml(text)}</p>` });
    }
  };
  await emit(`Initiative: ${order.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}.`, "round");
  for (let round = 1; round <= 20; round += 1) {
    if (await waitForControl()) {
      await emit("Live combat stopped by the GM.", "round");
      return { stopped: true, round };
    }
    const roundCombat = activeCombat();
    if (roundCombat) await roundCombat.update({ round, turn: 0 });
    await emit(`Round ${round}`, "round");
    for (const entry of order) {
      if (await waitForControl()) {
        await emit("Live combat stopped by the GM.", "round");
        return { stopped: true, round };
      }
      const attacker = entry.combatant;
      if (attacker.defeated) continue;
      attacker.turnUses.clear();
      attacker.conditions.delete("defended");
      for (const [key, roundsLeft] of attacker.cooldowns) {
        attacker.cooldowns.set(key, Math.max(0, roundsLeft - 1));
      }
      if (attacker.actor.system?.attributes?.shield?.raised) {
        await attacker.actor.update({ "system.attributes.shield.raised": false });
      }
      const turnCombat = activeCombat();
      if (turnCombat && entry.tracked) {
        const actualIndex = turnCombat.turns.findIndex((candidate) => candidate.id === entry.tracked.id);
        if (actualIndex >= 0) await turnCombat.update({ round, turn: actualIndex });
      }
      let actionsRemaining = 3;
      let map = 0;
      while (actionsRemaining > 0) {
        if (await waitForControl()) {
          await emit("Live combat stopped by the GM.", "round");
          return { stopped: true, round };
        }
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map, round);
        if (!choice) break;
        let temporaryTemplate = null;
        try {
        const { option, target, cost } = choice;
        if (!option.defensive && target !== attacker) {
          const currentDistance = await sceneDistance(attacker.token.object, target.token.object);
          if (currentDistance > option.range) {
            const moved = await moveToward(attacker, target);
            if (!moved) {
              await emit(`${attacker.name} cannot find a legal path or line of movement toward ${target.name}.`, "action");
              break;
            }
            actionsRemaining -= 1;
            await emit(`${attacker.name} Strides toward ${target.name}; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "move");
            await pause(actionDelay());
            continue;
          }
        }
        const nativeUse = await consumeNativeResource(option, attacker.actor);
        if (!nativeUse.available) {
          const key = option.useKey ?? option.id;
          attacker.uses.set(key, 0);
          await emit(`${attacker.name} cannot use ${option.name}: ${nativeUse.source}. The action is not spent.`, "error");
          continue;
        }
        actionsRemaining -= cost;
        consumeUse(attacker, option, target);
        const nativeActionCard = nativeUse.message ?? await postNativeActionCard(option);
        if (option.healing) {
          const healingRoll = await rollNativeDamage(option, attacker, target, 2, map, nativeActionCard);
          const healing = await applyNativeDamageOrHealing(target, healingRoll, 2, option);
          if (!healing) {
            await emit(`${attacker.name} uses ${option.name}, but PF2e exposed no native healing button for this entry. Lore Smith did not invent a healing formula.`, "error");
            await pause(actionDelay());
            continue;
          }
          await emit(`${attacker.name} uses ${option.name} through ${nativeUse.source} on ${target.name}; PF2e rolls ${healing.summary}; restores ${healing.amount} HP. ${target.name} has ${target.hp}/${target.maxHp} HP.`, "heal");
          await pause(actionDelay());
          continue;
        }
        if (option.defensive && !option.damage) {
          const nativeDefense = await applyNativeDefense(option, attacker.actor);
          const applied = await applyConditions(attacker, option.conditions);
          await emit(`${attacker.name} uses ${option.name}${applied.length ? ` and gains ${applied.join(", ")}` : ""} [${nativeDefense.source}]; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "action");
          await pause(actionDelay());
          continue;
        }
        const templateSource = templateData(option, attacker.token.object, target.token.object);
        if (templateSource && canvas.scene) {
          const cleanTemplate = Object.fromEntries(Object.entries(templateSource).filter(([, value]) => value !== undefined));
          [temporaryTemplate] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [cleanTemplate]);
          await waitForTemplateShape(temporaryTemplate);
        }
        const targetList = actionTargets(
          option,
          target,
          combatants,
          temporaryTemplate ? (candidate) => combatantInsideTemplate(temporaryTemplate, candidate) : null,
        );
        const outcomes = [];
        const nativeRolls = new Map();
        for (const affected of targetList) {
          const nativeCheck = option.automatic ? null : await resolveNativeCheck({
            option,
            attacker,
            target: affected,
            nativeMessage: nativeActionCard,
            mapPenalty: map,
            dc: option.save ? option.dc : actorAc(affected.actor),
            checkDegree,
          });
          if (!option.automatic && !nativeCheck) {
            outcomes.push(`${affected.name}: PF2e's native control did not return a readable roll; no modeled roll was substituted`);
            continue;
          }
          const check = nativeCheck ?? { degree: 2, total: null, dc: null, natural: null };
          const degree = check.degree;
          const outcome = nativeCheck
            ? option.save
              ? `${affected.name} rolls ${option.save}: ${liveCheckSummary(nativeCheck)} vs DC ${option.dc}, ${degreeText(degree)} [PF2e native]`
              : `${affected.name}: ${liveCheckSummary(nativeCheck)} vs ${option.defenseStatistic ?? "AC"} ${nativeCheck.dc}, ${degreeText(degree)} [PF2e native]`
            : `${affected.name}: the PF2e entry requires no check`;
          const effectApplies = option.save ? degree <= 1 : option.automatic || degree >= 2;
          let damage = null;
          if (option.damage && (option.save || degree >= 2)) {
            const rollKey = option.save ? "save" : degree === 3 ? "critical" : "success";
            let damageRoll = nativeRolls.get(rollKey);
            if (!damageRoll) {
              damageRoll = await rollNativeDamage(option, attacker, affected, degree, map, nativeActionCard);
              if (damageRoll) nativeRolls.set(rollKey, damageRoll);
            }
            damage = await applyNativeDamageOrHealing(affected, damageRoll, degree, option);
          }
          const conditions = effectApplies ? await applyConditions(affected, option.conditions) : [];
          const clickedCardEffect = effectApplies && nativeActionCard
            ? await clickNativeCardEffect(nativeActionCard)
            : false;
          const structured = effectApplies && !clickedCardEffect
            ? await applyNativeStructuredEffects(option, attacker, affected)
            : [];
          const missingDamage = option.damage && (option.save || degree >= 2) && !damage
            ? "; PF2e's native damage control did not return a roll, so no formula was invented"
            : "";
          outcomes.push(`${outcome}${damage ? `; native damage roll ${damage.summary}; ${damage.amount} ${option.damageType || ""} damage applied, HP ${affected.hp}/${affected.maxHp}` : ""}${missingDamage}${conditions.length || structured.length || clickedCardEffect ? `; ${[...conditions, ...structured, ...(clickedCardEffect ? ["native card effect"] : [])].join(", ")}` : ""}`);
          if (affected.defeated) {
            const trackedTarget = activeCombat()?.combatants?.find((candidate) => candidate.tokenId === affected.id);
            await trackedTarget?.update({ defeated: true });
          }
        }
        const resolution = outcomes.length ? outcomes.join(" | ") : "no tokens occupy the highlighted area";
        await emit(`${attacker.name} uses ${option.name}${option.kind === "spell" ? ` through ${nativeUse.source}` : ""}, spending ${cost} action${cost === 1 ? "" : "s"}: ${resolution}.`, option.damage ? "damage" : "action");
        target.token.object?.control({ releaseOthers: true });
        await canvas.animatePan({ x: target.token.object?.center.x, y: target.token.object?.center.y, duration: Math.min(500, actionDelay() / 3) });
        await pause(actionDelay());
        if (temporaryTemplate) await temporaryTemplate.delete();
        if (option.attackTrait) map += 5;
        } catch (error) {
          if (temporaryTemplate) await temporaryTemplate.delete().catch(() => {});
          console.error(`${MODULE_ID} | Could not resolve ${attacker.name}'s selected action.`, error);
          await emit(`${attacker.name}'s selected action could not be resolved safely and was skipped: ${error.message ?? error}.`, "error");
          break;
        }
      }
      if (!combatants.some((candidate) => candidate.team === "party" && !candidate.defeated)
        || !combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated)) {
        const winner = combatants.some((candidate) => candidate.team === "party" && !candidate.defeated) ? "Characters" : "Opposition";
        await emit(`${winner} win the encounter.`, "victory");
        return { stopped: false, round, winner };
      }
    }
  }
  return { stopped: false, round: 20, winner: null };
}

async function runLiveReplayLegacy(tokens, partyIds, enemyIds, { combat = game.combat } = {}) {
  const combatants = tokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  const order = combatants.map((combatant) => {
    const tracked = combat?.combatants?.find((entry) => entry.tokenId === combatant.id);
    return { combatant, score: tracked?.initiative ?? rollDie(20) + combatant.initiative, tracked };
  }).sort((left, right) => right.score - left.score);
  await ChatMessage.create({
    speaker: { alias: "Lore Smith" },
    content: `<h3>Lore Smith live encounter</h3><p><strong>Initiative</strong> ${order.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}</p>`,
  });
  for (let round = 1; round <= 20; round += 1) {
    if (combat) await combat.update({ round, turn: 0 });
    await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<h3>Round ${round}</h3>` });
    for (let turnIndex = 0; turnIndex < order.length; turnIndex += 1) {
      const entry = order[turnIndex];
      const attacker = entry.combatant;
      if (attacker.defeated) continue;
      if (combat && entry.tracked) {
        const actualIndex = combat.turns.findIndex((candidate) => candidate.id === entry.tracked.id);
        if (actualIndex >= 0) await combat.update({ round, turn: actualIndex });
      }
      let actions = 3;
      let map = 0;
      const healingTarget = attacker.heals.length ? chooseHealingTarget(attacker, combatants) : null;
      if (healingTarget && actions > 0) {
        const healing = attacker.heals[0];
        const restored = await applyLiveHealing(healingTarget, healing.formula);
        actions -= 1;
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }),
          content: `<p><strong>${attacker.name}</strong> uses <strong>${healing.name}</strong> on ${healingTarget.name}, restoring <strong>${restored.amount} HP</strong>. ${healingTarget.name} has ${healingTarget.hp}/${healingTarget.maxHp} HP.</p>`,
        });
      }
      while (actions > 0) {
        const target = chooseTarget(attacker, combatants);
        if (!target) return;
        const strike = attacker.strikes[0];
        const distance = await sceneDistance(attacker.token.object, target.token.object);
        if (distance > Math.max(5, strike.range)) {
          const moved = await moveToward(attacker, target);
          actions -= 1;
          if (!moved) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }),
              content: `<p><strong>${attacker.name}</strong> cannot find a legal path toward ${target.name}; the action is not spent.</p>`,
            });
            actions += 1;
            break;
          }
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }),
            content: `<p><strong>${attacker.name}</strong> Strides toward ${target.name}. <em>${actions} actions remaining.</em></p>`,
          });
          await pause(450);
          continue;
        }
        const natural = rollDie(20);
        const modifier = strike.modifier - map;
        const total = natural + modifier;
        const degree = degreeOfSuccess(total, actorAc(target.actor), natural);
        actions -= 1;
        let content = `<p><strong>${attacker.name}</strong> targets <strong>${target.name}</strong> with ${strike.name}: [[1d20 + ${modifier}]] → ${total} vs AC ${actorAc(target.actor)}, <strong>${degreeLabel(degree)}</strong>.</p>`;
        if (degree >= 2) {
          const damage = await applyLiveDamage(target, strike.damage, degree);
          content += `<p>${target.name} takes <strong>${damage.amount} damage</strong> and has ${target.hp}/${target.maxHp} HP.</p>`;
          if (target.defeated) {
            const trackedTarget = combat?.combatants?.find((candidate) => candidate.tokenId === target.id);
            await trackedTarget?.update({ defeated: true });
          }
        }
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker.actor, token: attacker.token }), content });
        target.token.object?.control({ releaseOthers: true });
        await canvas.animatePan({ x: target.token.object?.center.x, y: target.token.object?.center.y, duration: 300 });
        await pause(500);
        map += 5;
      }
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

function newSessionLocation() {
  return { id: foundry.utils.randomID(), name: "", image: "", purpose: "", sight: "", hearing: "", smell: "", touch: "", taste: "" };
}

function newSessionPrep() {
  return {
    title: "", goal: "", opening: "", ending: "",
    locations: [newSessionLocation(), newSessionLocation(), newSessionLocation()],
    people: "", opposition: "", scenes: "", rewards: "", reminders: "",
  };
}

function sessionHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function sessionBlock(title, value) {
  const content = String(value ?? "").trim();
  return content ? `<h2>${escapeHtml(title)}</h2><p>${sessionHtml(content)}</p>` : "";
}

function sessionLocationPage(location) {
  const senses = [["Sight", location.sight], ["Hearing", location.hearing], ["Smell", location.smell], ["Touch", location.touch], ["Taste", location.taste]]
    .filter(([, value]) => String(value ?? "").trim())
    .map(([sense, value]) => `<p><strong>${sense}</strong> ${sessionHtml(value)}</p>`).join("");
  const image = String(location.image ?? "").trim()
    ? `<figure><img src="${escapeHtml(location.image)}" alt="${escapeHtml(location.name)}"></figure>` : "";
  return `${image}${sessionBlock("Why this place matters", location.purpose)}${senses ? `<hr><h2>Five senses</h2>${senses}` : ""}` || "<p>Describe this location before play.</p>";
}

function sessionJournalPages(prep) {
  const placeNames = prep.locations.map((location, index) => location.name.trim() || `Important Place ${index + 1}`);
  const overview = [
    sessionBlock("Main goal", prep.goal), sessionBlock("Opening situation", prep.opening), sessionBlock("Likely ending or cliffhanger", prep.ending),
    `<hr><h2>Important places</h2><ul>${placeNames.map((name) => `<li>[[Place — ${escapeHtml(name)}]]</li>`).join("")}</ul>`,
    "<p><em>Use the linked pages for sensory descriptions and table-ready details.</em></p>",
  ].filter(Boolean).join("");
  const pages = [{ name: "Session Overview", content: overview }];
  for (const [index, location] of prep.locations.entries()) pages.push({ name: `Place — ${placeNames[index]}`, content: sessionLocationPage({ ...location, name: placeNames[index] }) });
  pages.push(
    { name: "People & Opposition", content: `${sessionBlock("NPCs and factions", prep.people)}${sessionBlock("Opposition, hazards, and encounters", prep.opposition)}` || "<p>Who can help, hinder, or surprise the party?</p>" },
    { name: "Scenes, Clues & Rewards", content: `${sessionBlock("Likely scenes and clues", prep.scenes)}${sessionBlock("Rewards, consequences, and changes", prep.rewards)}` || "<p>Prepare situations, clues, and consequences here.</p>" },
    { name: "GM Reminders & Secrets", content: sessionBlock("GM-only notes", prep.reminders) || "<p>Private reminders, secrets, and contingencies.</p>" },
  );
  return pages;
}

class LoreSmithDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-dashboard",
    classes: ["lore-smith-app"],
    tag: "section",
    position: { width: 1120, height: 760 },
    window: { title: "Lore Smith", icon: "fa-solid fa-book-sparkles", resizable: true },
    actions: {
      tab: LoreSmithDashboard.changeTab,
      newSessionPrep: LoreSmithDashboard.newSessionPrep,
      previousSessionStep: LoreSmithDashboard.previousSessionStep,
      nextSessionStep: LoreSmithDashboard.nextSessionStep,
      goToSessionStep: LoreSmithDashboard.goToSessionStep,
      addLocation: LoreSmithDashboard.addLocation,
      removeLocation: LoreSmithDashboard.removeLocation,
      browseLocationImage: LoreSmithDashboard.browseLocationImage,
      createSessionJournal: LoreSmithDashboard.createSessionJournal,
      openLastSessionJournal: LoreSmithDashboard.openLastSessionJournal,
      createNote: LoreSmithDashboard.createNote,
      openNote: LoreSmithDashboard.openNote,
      openNotebook: LoreSmithDashboard.openNotebook,
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

  activeTab = "session";
  activeNoteId = null;
  creatureSearch = "";
  itemSearch = "";
  itemType = "";
  creatureResults = [];
  itemResults = [];
  partyIds = new Set();
  enemyIds = new Set();
  iterations = 100;
  result = null;
  sessionStep = 0;
  sessionPrep = newSessionPrep();
  lastSessionJournalId = null;

  async getNotebook(create = false) {
    let journal = game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "notebook"));
    if (!journal) {
      journal = game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "note"));
      if (journal) await journal.setFlag(FLAG_SCOPE, "notebook", true);
    }
    if (!journal && create) {
      journal = await JournalEntry.create({
        name: "Campaign Journal",
        flags: { [FLAG_SCOPE]: { note: true, notebook: true } },
        pages: [],
      });
    }
    return journal;
  }

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
    const notebook = await this.getNotebook(false);
    const notePages = notebook?.pages?.contents
      ?.filter((page) => page.type === "text")
      .sort((left, right) => left.sort - right.sort) ?? [];
    if (!notePages.some((page) => page.id === this.activeNoteId)) this.activeNoteId = notePages[0]?.id ?? null;
    const notes = notePages.map((page) => ({
      id: page.id,
      name: page.name,
      active: page.id === this.activeNoteId,
    }));
    const activePage = notebook?.pages?.get(this.activeNoteId) ?? null;
    const activeNote = activePage ? {
      id: activePage.id,
      name: activePage.name,
      content: activePage.text?.content ?? "",
    } : null;
    if (!this.lastSessionJournalId) {
      const latestSession = game.journal.contents
        .filter((entry) => entry.getFlag(FLAG_SCOPE, "sessionPrep"))
        .sort((left, right) => String(right.getFlag(FLAG_SCOPE, "createdAt") ?? "").localeCompare(String(left.getFlag(FLAG_SCOPE, "createdAt") ?? "")))[0];
      this.lastSessionJournalId = latestSession?.id ?? null;
    }
    const locationViews = this.sessionPrep.locations.map((location, index) => ({ ...location, number: index + 1, canRemove: this.sessionPrep.locations.length > 3 }));
    const sessionValidation = [];
    if (!this.sessionPrep.title.trim()) sessionValidation.push("Add a session title.");
    if (!this.sessionPrep.goal.trim()) sessionValidation.push("Add the session's main goal.");
    if (this.sessionPrep.locations.length < 3) sessionValidation.push("Prepare at least three important places.");
    for (const [index, location] of this.sessionPrep.locations.entries()) {
      if (!location.name.trim()) sessionValidation.push(`Name important place ${index + 1}.`);
      if (!location.image.trim()) sessionValidation.push(`Choose an image for important place ${index + 1}.`);
    }
    const sessionStepEntries = [["goal", "Goal"], ["locations", "Places"], ["people", "People"], ["scenes", "Scenes"], ["review", "Review"]];
    const sessionSteps = Object.fromEntries(sessionStepEntries.map(([key, label], index) => [key, { index, number: index + 1, label, active: this.sessionStep === index }]));
    return {
      ...await super._prepareContext(options),
      tabs: { [this.activeTab]: true },
      notes,
      activeNote,
      notebookName: notebook?.name ?? "Campaign Journal",
      creatureSearch: this.creatureSearch,
      itemSearch: this.itemSearch,
      itemTypes: Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label, selected: value === this.itemType })),
      creatureResults: this.creatureResults,
      itemResults: this.itemResults,
      sceneReady: Boolean(canvas?.scene),
      sceneTokens,
      iterations: game.settings.settings.has(`${MODULE_ID}.combatIterations`)
        ? game.settings.get(MODULE_ID, "combatIterations")
        : this.iterations,
      result: this.result,
      sessionPrep: { ...this.sessionPrep, locations: locationViews },
      sessionSteps,
      sessionValidation,
      canSessionBack: this.sessionStep > 0,
      lastSessionJournalId: this.lastSessionJournalId,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this.activeTab !== "notes") return;
    const editor = this.element?.querySelector('[data-role="note-editor"]');
    const title = this.element?.querySelector('[data-role="note-title"]');
    activateWikiLinks(editor);
    const scheduleSave = () => {
      window.clearTimeout(this._noteSaveTimer);
      this._noteSaveTimer = window.setTimeout(() => this.saveActiveNote(), 350);
    };
    editor?.addEventListener("input", () => {
      activateWikiLinks(editor);
      scheduleSave();
    });
    editor?.addEventListener("keydown", (event) => {
      if (event.key === "[" && insertCompletedWikiPair()) {
        event.preventDefault();
        scheduleSave();
      }
    });
    editor?.addEventListener("click", (event) => {
      const link = event.target.closest?.(".ls-wiki-link");
      if (!link) return;
      event.preventDefault();
      if (event.detail > 1) return;
      window.clearTimeout(this._wikiClickTimer);
      this._wikiClickTimer = window.setTimeout(() => this.openOrCreateLinkedNote(link.dataset.noteName), 240);
    });
    editor?.addEventListener("dblclick", (event) => {
      const link = event.target.closest?.(".ls-wiki-link");
      if (!link) return;
      event.preventDefault();
      window.clearTimeout(this._wikiClickTimer);
      const text = document.createTextNode(`[[${link.dataset.noteName}]]`);
      link.replaceWith(text);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.focus();
    });
    title?.addEventListener("input", scheduleSave);
    title?.addEventListener("change", () => this.saveActiveNote());
  }

  async saveActiveNote() {
    const journal = await this.getNotebook(false);
    const page = journal?.pages?.get(this.activeNoteId);
    if (!journal || !page) return;
    const title = this.element?.querySelector('[data-role="note-title"]')?.value.trim() || "Untitled Note";
    const content = this.element?.querySelector('[data-role="note-editor"]')?.innerHTML ?? "";
    if (page.name !== title || page.text?.content !== content) {
      await page.update({ name: title, "text.content": content });
    }
  }

  async openOrCreateLinkedNote(name) {
    const noteName = String(name ?? "").trim();
    if (!noteName) return;
    await this.saveActiveNote();
    const journal = await this.getNotebook(true);
    let page = journal.pages.find((candidate) =>
      candidate.name.localeCompare(noteName, undefined, { sensitivity: "accent" }) === 0);
    if (!page) {
      [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: noteName,
        type: "text",
        text: { content: "" },
        sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
      }]);
      ui.notifications.info(`Created page "${noteName}" inside ${journal.name}.`);
    }
    this.activeNoteId = page.id;
    await this.render();
  }

  captureEncounterSelection() {
    const root = this.element;
    if (!root) return;
    this.partyIds = new Set([...root.querySelectorAll('input[name="partyToken"]:checked')].map((input) => input.value));
    this.enemyIds = new Set([...root.querySelectorAll('input[name="enemyToken"]:checked')].map((input) => input.value));
    this.iterations = game.settings.settings.has(`${MODULE_ID}.combatIterations`)
      ? Math.max(1, Math.min(1000, game.settings.get(MODULE_ID, "combatIterations")))
      : 100;
  }

  syncSessionPrepForm() {
    const root = this.element;
    if (!root || this.activeTab !== "session") return;
    const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
    Object.assign(this.sessionPrep, {
      title: value("sessionTitle").trim(), goal: value("sessionGoal").trim(), opening: value("sessionOpening").trim(), ending: value("sessionEnding").trim(),
      people: value("sessionPeople").trim(), opposition: value("sessionOpposition").trim(), scenes: value("sessionScenes").trim(), rewards: value("sessionRewards").trim(), reminders: value("sessionReminders").trim(),
    });
    const previous = new Map(this.sessionPrep.locations.map((location) => [location.id, location]));
    const cards = [...root.querySelectorAll("[data-location-id]")];
    if (cards.length) this.sessionPrep.locations = cards.map((card) => {
      const id = card.dataset.locationId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previous.get(id), id, name: field("locationName"), image: field("locationImage"), purpose: field("locationPurpose"), sight: field("locationSight"), hearing: field("locationHearing"), smell: field("locationSmell"), touch: field("locationTouch"), taste: field("locationTaste") };
    });
  }

  static async changeTab(event, target) {
    this.captureEncounterSelection();
    this.syncSessionPrepForm();
    this.activeTab = target.dataset.tab;
    await this.render();
  }

  static async newSessionPrep() {
    this.sessionStep = 0;
    this.sessionPrep = newSessionPrep();
    await this.render();
  }

  static async previousSessionStep() {
    this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, this.sessionStep - 1);
    await this.render();
  }

  static async nextSessionStep() {
    this.syncSessionPrepForm();
    this.sessionStep = Math.min(4, this.sessionStep + 1);
    await this.render();
  }

  static async goToSessionStep(_event, target) {
    this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, Math.min(4, Number(target.dataset.step) || 0));
    await this.render();
  }

  static async addLocation() {
    this.syncSessionPrepForm();
    this.sessionPrep.locations.push(newSessionLocation());
    await this.render();
  }

  static async removeLocation(_event, target) {
    this.syncSessionPrepForm();
    if (this.sessionPrep.locations.length <= 3) return;
    this.sessionPrep.locations = this.sessionPrep.locations.filter((location) => location.id !== target.dataset.id);
    await this.render();
  }

  static async browseLocationImage(_event, target) {
    this.syncSessionPrepForm();
    const location = this.sessionPrep.locations.find((entry) => entry.id === target.dataset.id);
    if (!location) return;
    new FilePicker({ type: "imagevideo", current: location.image, callback: async (path) => {
      location.image = path;
      await this.render();
    } }).browse();
  }

  static async createSessionJournal() {
    this.syncSessionPrepForm();
    const invalid = !this.sessionPrep.title.trim() || !this.sessionPrep.goal.trim()
      || this.sessionPrep.locations.length < 3 || this.sessionPrep.locations.some((location) => !location.name.trim() || !location.image.trim());
    if (invalid) {
      this.sessionStep = 4;
      await this.render();
      return ui.notifications.warn("Complete the title, goal, and all three important places before creating the Journal.");
    }
    const journal = await JournalEntry.create({
      name: this.sessionPrep.title.trim(),
      flags: { [FLAG_SCOPE]: { sessionPrep: true, createdAt: new Date().toISOString(), sessionGoal: this.sessionPrep.goal.trim() } },
      pages: [],
    });
    const pages = sessionJournalPages(this.sessionPrep).map((page, index) => ({ name: page.name, type: "text", text: { content: page.content }, sort: (index + 1) * 100000 }));
    await journal.createEmbeddedDocuments("JournalEntryPage", pages);
    this.lastSessionJournalId = journal.id;
    this.activeNoteId = null;
    this.sessionPrep = newSessionPrep();
    this.sessionStep = 0;
    ui.notifications.info(`Created session Journal: ${journal.name}.`);
    journal.sheet.render(true);
    await this.render();
  }

  static async openLastSessionJournal() {
    const journal = game.journal.get(this.lastSessionJournalId);
    if (journal) journal.sheet.render(true);
  }

  static async createNote() {
    await this.saveActiveNote();
    const journal = await this.getNotebook(true);
    const existing = new Set(journal.pages.map((page) => page.name.toLowerCase()));
    let noteName = "New Note";
    let suffix = 2;
    while (existing.has(noteName.toLowerCase())) noteName = `New Note ${suffix++}`;
    const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: noteName,
      type: "text",
      text: { content: "" },
      sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
    }]);
    this.activeNoteId = page.id;
    await this.render();
  }

  static async openNote(_event, target) {
    await this.saveActiveNote();
    this.activeNoteId = target.dataset.id;
    await this.render();
  }

  static async openNotebook() {
    const journal = await this.getNotebook(true);
    journal.sheet.render(true);
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
    if (game.loreSmith?.openItemBuilder && ["ammo", "armor", "backpack", "book", "consumable", "equipment", "kit", "shield", "treasure", "weapon"].includes(item.type)) game.loreSmith.openItemBuilder(item);
    else item.sheet.render(true);
    ui.notifications.info(`Created editable PF2e item: ${item.name}.`);
  }

  static async blankItem() {
    const response = await foundry.applications.api.DialogV2.input({
      window: { title: "Create Blank PF2e Item" },
      content: `<label>Item type <select name="type">${["equipment", "consumable", "ammo", "weapon", "armor", "shield", "backpack", "kit", "book", "treasure"].map((type) => `<option value="${type}">${ITEM_TYPE_LABELS[type] ?? game.i18n.localize(`TYPES.Item.${type}`)}</option>`).join("")}</select></label>`,
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
    if (game.loreSmith?.openItemBuilder) game.loreSmith.openItemBuilder(item);
    else item.sheet.render(true);
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
    if (typeof game.loreSmith?.runLiveCombat === "function") {
      await game.loreSmith.runLiveCombat();
      return;
    }
    ui.notifications.warn("Open the Combat Tracker and start an encounter before running live combat.");
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
  game.loreSmith = {
    open: openLoreSmith,
    simulateEncounter,
    runLiveReplay,
    buildCoverageReport: (tokens, partyIds = null, enemyIds = null) =>
      actionCoverageReport(tokens, partyIds, enemyIds),
  };
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
