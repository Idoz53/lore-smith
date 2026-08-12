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
import { decisionFlowStatus, getTacticalProfile, initializeDecisionFlows } from "./tactical-profiles.js";

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
    baseConditions: new Set(conditions.keys()),
    flankedBy: null,
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
  push(`Tactical flows: ${combatants.map((combatant) => `${combatant.name} — ${combatant.profile.flow?.name ?? "General Tactical AI"}`).join("; ")}.`, "action");

  let rounds = 0;
  while (rounds < 30) {
    rounds += 1;
    push(`Round ${rounds}`, "round");
    for (const turn of initiatives) {
      const attacker = turn.combatant;
      if (attacker.defeated) continue;
      refreshVirtualFlanking(combatants);
      attacker.turnUses.clear();
      attacker.damageActionsThisTurn = 0;
      attacker.utilityActionsThisTurn = 0;
      attacker.conditions.delete("defended");
      for (const [key, roundsLeft] of attacker.cooldowns) {
        attacker.cooldowns.set(key, Math.max(0, roundsLeft - 1));
      }
      if (["unconscious", "paralyzed", "petrified"].some((slug) => attacker.conditions.has(slug))) {
        push(`${attacker.name} cannot act because of ${["unconscious", "paralyzed", "petrified"].find((slug) => attacker.conditions.has(slug))}.`, "condition");
        continue;
      }
      const slowed = Math.max(0, Number(attacker.conditions.get("slowed") ?? 0));
      const stunned = Math.max(0, Number(attacker.conditions.get("stunned") ?? 0));
      let actionsRemaining = Math.max(0, 3 - slowed - Math.min(3, stunned));
      if (stunned) attacker.conditions.delete("stunned");
      if (attacker.conditions.has("prone") && actionsRemaining > 0) {
        actionsRemaining -= 1;
        attacker.conditions.delete("prone");
        push(`${attacker.name} spends 1 action to Stand and is no longer prone.`, "condition");
      }
      let map = 0;
      while (actionsRemaining > 0) {
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map, rounds);
        if (!choice) break;
        const { option, target, cost } = choice;
        actionsRemaining -= cost;
        consumeUse(attacker, option, target);
        if (option.damage) attacker.damageActionsThisTurn += 1;
        else if (!option.healing) attacker.utilityActionsThisTurn += 1;
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
  let total = null;
  try {
    total = Number(roll.total);
  } catch (_error) {
    total = Number(roll._total ?? roll.toJSON?.()?.total);
  }
  return `${expression} = ${Number.isFinite(total) ? total : 0}`;
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
  // PF2e's IWR application expects every DamageRoll to carry a complete
  // bypass structure. Some chat-card controls return a deserialized native
  // roll without that optional object, so normalize it before handing the roll
  // back to PF2e instead of letting applyDamage fail while reading `bypass`.
  nativeRoll.options ??= {};
  nativeRoll.options.bypass ??= {
    immunity: { ignore: [], downgrade: [], redirect: [] },
    resistance: { ignore: [], redirect: [] },
  };
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

function applyIsolatedDamageOrHealing(target, roll, degree, option) {
  const nativeRoll = roll?.roll ?? roll?.rolls?.[0] ?? roll;
  if (!nativeRoll) return null;
  let total = null;
  try {
    total = Number(nativeRoll.total);
  } catch (_error) {
    total = Number(nativeRoll._total ?? nativeRoll.toJSON?.()?.total);
  }
  if (!Number.isFinite(total)) return null;
  const rolled = Math.max(0, Math.abs(total));
  if (option.healing) {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + Math.max(1, rolled));
    target.defeated = false;
    return { amount: target.hp - before, roll: nativeRoll, summary: liveRollSummary(nativeRoll) };
  }
  const multiplier = option.save ? [2, 1, 0.5, 0][degree] ?? 0
    : option.kind === "strike" ? 1
      : degree === 3 ? 2 : degree >= 2 ? 1 : 0;
  const scaled = multiplier > 0 ? Math.max(1, Math.floor(rolled * multiplier)) : 0;
  const adjusted = adjustDamageForIwr(scaled, option.damageType, target);
  const before = target.hp;
  target.hp = Math.max(0, target.hp - adjusted.amount);
  target.defeated = target.hp <= 0;
  return {
    amount: before - target.hp,
    roll: nativeRoll,
    summary: `${liveRollSummary(nativeRoll)}${adjusted.notes.length ? ` (${adjusted.notes.join(", ")})` : ""}`,
  };
}

function sceneDistance(left, right) {
  const grid = canvas.grid;
  const leftCenter = left.center ?? { x: left.x + left.w / 2, y: left.y + left.h / 2 };
  const rightCenter = right.center ?? { x: right.x + right.w / 2, y: right.y + right.h / 2 };
  const centerDistance = grid.measurePath([leftCenter, rightCenter]).distance;
  const occupiedRadius = Math.max(0, ((Math.max(left.w, left.h) + Math.max(right.w, right.h)) / 2 - grid.size)
    * grid.distance / grid.size);
  return Math.max(0, centerDistance - occupiedRadius);
}

function randomUnit() {
  try {
    const value = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(value);
    if (value[0]) return value[0] / 0x100000000;
  } catch (_error) {
    // Math.random remains suitably non-deterministic for tactical tie-breaking.
  }
  return Math.random();
}

function effectiveActionRange(option) {
  const stated = Number(option?.range);
  if (Number.isFinite(stated) && stated > 0) return stated;
  // PF2e exposes many melee Strikes and touch actions as range 0. On a grid,
  // their legal reach is the adjacent 5-foot square, not literally zero feet.
  return option?.targetMode === "self" || option?.defensive ? 0 : 5;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function flankingPairFor(target, combatants) {
  const targetToken = target.token?.object;
  if (!targetToken) return null;
  const opponents = combatants.filter((candidate) => candidate.team !== target.team && !candidate.defeated
    && candidate.token?.object && sceneDistance(candidate.token.object, targetToken) <= 5);
  const center = targetToken.center;
  const tolerance = Math.max(2, Math.min(targetToken.w, targetToken.h) * 0.2);
  for (let leftIndex = 0; leftIndex < opponents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < opponents.length; rightIndex += 1) {
      const left = opponents[leftIndex];
      const right = opponents[rightIndex];
      const leftCenter = left.token.object.center;
      const rightCenter = right.token.object.center;
      const leftVector = { x: leftCenter.x - center.x, y: leftCenter.y - center.y };
      const rightVector = { x: rightCenter.x - center.x, y: rightCenter.y - center.y };
      const oppositeSides = leftVector.x * rightVector.x + leftVector.y * rightVector.y < 0;
      if (oppositeSides && distanceToSegment(center, leftCenter, rightCenter) <= tolerance) return [left, right];
    }
  }
  return null;
}

function refreshVirtualFlanking(combatants) {
  for (const target of combatants) {
    if (target.defeated) continue;
    const pair = flankingPairFor(target, combatants);
    if (pair) {
      target.flankedBy = pair.map((combatant) => combatant.name);
      target.conditions.set("off-guard", Math.max(1, target.conditions.get("off-guard") ?? 0));
      continue;
    }
    if (!target.flankedBy) continue;
    target.flankedBy = null;
    const independentlyOffGuard = target.baseConditions?.has("off-guard")
      || ["prone", "grabbed", "restrained", "unconscious"].some((slug) => target.conditions.has(slug));
    if (!independentlyOffGuard) target.conditions.delete("off-guard");
  }
}

async function rollVirtualEscape(attacker, target) {
  const escapeStatistic = [attacker.actor.getStatistic?.("acrobatics"), attacker.actor.getStatistic?.("athletics")]
    .filter(Boolean).sort((left, right) => Number(right.mod ?? right.check?.mod ?? 0) - Number(left.mod ?? left.check?.mod ?? 0))[0];
  const fallbackDc = Number(target?.level ?? 0) + 10;
  const escapeDc = Math.max(10, Number(target?.actor?.getStatistic?.("athletics")?.dc?.value
    ?? target?.actor?.getStatistic?.("athletics")?.dc ?? fallbackDc));
  const result = await escapeStatistic?.check?.roll?.({
    dc: { value: escapeDc, slug: "escape" },
    createMessage: true,
    skipDialog: true,
    rollMode: "gmroll",
    options: ["lore-smith", "action:escape"],
  });
  const total = Number(result?.roll?.total ?? result?.total);
  const success = Number.isFinite(total) && total >= escapeDc;
  if (success) {
    attacker.conditions.delete("immobilized");
    attacker.conditions.delete("grabbed");
    attacker.conditions.delete("restrained");
  }
  return { total, dc: escapeDc, success };
}

function lsBoundsAt(token, topLeft) {
  return { x: topLeft.x, y: topLeft.y, width: token.w, height: token.h };
}

function lsBoundsOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function lsTopLeftForOffset(offset) {
  return canvas.grid.getTopLeftPoint({ i: offset.i, j: offset.j });
}

function lsCenterFor(token, topLeft) {
  return { x: topLeft.x + token.w / 2, y: topLeft.y + token.h / 2 };
}

function lsOffsetKey(offset) {
  return `${offset.i},${offset.j}`;
}

function lsOccupiedAt(token, topLeft) {
  const candidate = lsBoundsAt(token, topLeft);
  const occupants = token._loreSmithWorld?.tokens?.map((document) => document.object)
    ?? (canvas.tokens?.placeables ?? []);
  return occupants.some((other) => {
    if (other === token || other.document?.id === token.document?.id) return false;
    if (!other.document?.actor && !other.document?.actorId) return false;
    if (other.document?.hidden && !game.user.isGM) return false;
    return lsBoundsOverlap(candidate, { x: other.x, y: other.y, width: other.w, height: other.h });
  });
}

function lsInsideScene(token, topLeft) {
  const dimensions = canvas.dimensions;
  return topLeft.x >= dimensions.sceneX && topLeft.y >= dimensions.sceneY
    && topLeft.x + token.w <= dimensions.sceneX + dimensions.sceneWidth
    && topLeft.y + token.h <= dimensions.sceneY + dimensions.sceneHeight;
}

function lsStepBlocked(token, fromTopLeft, toTopLeft) {
  const origin = lsCenterFor(token, fromTopLeft);
  const destination = lsCenterFor(token, toTopLeft);
  return Boolean(token.checkCollision?.(destination, { origin, type: "move", mode: "any" }));
}

function lsLineBlocked(token, targetToken, fromTopLeft = { x: token.x, y: token.y }, type = "sight") {
  if (!token || !targetToken) return true;
  const origin = lsCenterFor(token, fromTopLeft);
  return Boolean(token.checkCollision?.(targetToken.center, { origin, type, mode: "any" }));
}

function lsGridPath(token, {
  maxSteps,
  isGoal,
  score = () => 0,
  allowBest = false,
} = {}) {
  if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  const start = canvas.grid.getOffset({ x: token.x + 1, y: token.y + 1 });
  const queue = [{ offset: start, path: [], topLeft: { x: token.x, y: token.y } }];
  const visited = new Set([lsOffsetKey(start)]);
  let best = null;
  const directions = [
    { i: -1, j: 0 }, { i: 1, j: 0 }, { i: 0, j: -1 }, { i: 0, j: 1 },
    { i: -1, j: -1 }, { i: -1, j: 1 }, { i: 1, j: -1 }, { i: 1, j: 1 },
  ];
  while (queue.length) {
    const node = queue.shift();
    const value = score(node.topLeft, node.path);
    if (!best || value > best.score) best = { ...node, score: value };
    if (node.path.length > 0 && isGoal(node.topLeft, node.path)) return node.path;
    if (node.path.length >= maxSteps) continue;
    const sortedDirections = directions.map((direction) => ({ direction, tie: randomUnit() })).sort((left, right) => {
      const leftTop = lsTopLeftForOffset({ i: node.offset.i + left.direction.i, j: node.offset.j + left.direction.j });
      const rightTop = lsTopLeftForOffset({ i: node.offset.i + right.direction.i, j: node.offset.j + right.direction.j });
      return score(rightTop, node.path) - score(leftTop, node.path) || left.tie - right.tie;
    });
    for (const { direction } of sortedDirections) {
      const offset = { i: node.offset.i + direction.i, j: node.offset.j + direction.j };
      const key = lsOffsetKey(offset);
      if (visited.has(key)) continue;
      visited.add(key);
      const topLeft = lsTopLeftForOffset(offset);
      if (!lsInsideScene(token, topLeft) || lsOccupiedAt(token, topLeft) || lsStepBlocked(token, node.topLeft, topLeft)) continue;
      queue.push({ offset, topLeft, path: [...node.path, topLeft] });
    }
  }
  return allowBest ? best?.path ?? null : null;
}

async function lsMoveTokenAlong(attacker, path) {
  if (!path?.length) return false;
  const destination = path.at(-1);
  if (lsOccupiedAt(attacker.token.object, destination)) return false;
  const world = attacker.token.object?._loreSmithWorld;
  for (const [index, square] of path.entries()) {
    if (lsOccupiedAt(attacker.token.object, square)) return false;
    await attacker.token.update(square);
    if (index < path.length - 1) await pause(world?.movementDelay?.() ?? 140);
  }
  return true;
}

function createIsolatedToken(document, world) {
  const original = document.object;
  const sourcePosition = { x: Number(document.x ?? original?.x ?? 0), y: Number(document.y ?? original?.y ?? 0) };
  const snappedPosition = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS
    ? sourcePosition
    : canvas.grid.getTopLeftPoint(canvas.grid.getOffset({ x: sourcePosition.x + 1, y: sourcePosition.y + 1 }));
  const state = {
    id: document.id,
    actor: document.actor,
    actorId: document.actorId ?? document.actor?.id,
    name: document.name ?? document.actor?.name ?? "Combatant",
    hidden: false,
    texture: { src: document.texture?.src ?? document.actor?.img ?? "icons/svg/mystery-man.svg" },
    x: Number(snappedPosition.x),
    y: Number(snappedPosition.y),
    width: Number(document.width ?? 1),
    height: Number(document.height ?? 1),
    _loreSmithIsolated: true,
    async update(changes = {}) {
      const requested = {
        x: Number.isFinite(Number(changes.x)) ? Number(changes.x) : state.x,
        y: Number.isFinite(Number(changes.y)) ? Number(changes.y) : state.y,
      };
      const position = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS
        ? requested
        : canvas.grid.getTopLeftPoint(canvas.grid.getOffset({ x: requested.x + 1, y: requested.y + 1 }));
      state.x = Number(position.x);
      state.y = Number(position.y);
      await world.onChange?.(state);
      return state;
    },
  };
  const object = {
    document: state,
    _loreSmithWorld: world,
    original,
    get x() { return state.x; },
    get y() { return state.y; },
    get w() { return Number(original?.w ?? state.width * canvas.grid.size); },
    get h() { return Number(original?.h ?? state.height * canvas.grid.size); },
    get center() { return { x: state.x + this.w / 2, y: state.y + this.h / 2 }; },
    get bounds() { return { x: state.x, y: state.y, width: this.w, height: this.h }; },
    checkCollision(destination, options = {}) {
      return original?.checkCollision?.(destination, options) ?? false;
    },
  };
  state.object = object;
  return state;
}

function createIsolatedWorld(tokens) {
  const world = { tokens: [], onChange: null };
  world.tokens = tokens.map((token) => createIsolatedToken(token, world));
  return world;
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

function pointDistanceFeet(left, right) {
  return canvas.grid.measurePath([left, right]).distance;
}

function angularDifference(left, right) {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function combatantInsideVirtualArea(template, combatant) {
  const token = combatant.token?.object;
  if (!template || !token) return false;
  const point = token.center;
  const origin = { x: template.x, y: template.y };
  const distance = pointDistanceFeet(origin, point);
  if (template.t === "circle") return distance <= Number(template.distance);
  const angle = Math.atan2(point.y - origin.y, point.x - origin.x) * 180 / Math.PI;
  if (template.t === "cone") {
    return distance <= Number(template.distance)
      && angularDifference(angle, Number(template.direction)) <= Number(template.angle ?? 90) / 2;
  }
  if (template.t === "ray") {
    const radians = Number(template.direction) * Math.PI / 180;
    const dxFeet = (point.x - origin.x) * canvas.grid.distance / canvas.grid.size;
    const dyFeet = (point.y - origin.y) * canvas.grid.distance / canvas.grid.size;
    const along = dxFeet * Math.cos(radians) + dyFeet * Math.sin(radians);
    const across = Math.abs(-dxFeet * Math.sin(radians) + dyFeet * Math.cos(radians));
    return along >= 0 && along <= Number(template.distance)
      && across <= Number(template.width ?? 5) / 2;
  }
  if (template.t === "rect") return distance <= Number(template.distance);
  return false;
}

function applyVirtualConditions(target, conditions) {
  const applied = [];
  for (const condition of conditions ?? []) {
    target.conditions.set(condition.slug, Math.max(target.conditions.get(condition.slug) ?? 0, condition.value ?? 1));
    applied.push(`${condition.slug}${Number(condition.value) > 1 ? ` ${condition.value}` : ""}`);
  }
  return applied;
}

async function waitForTemplateShape(templateDocument) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const template = templateDocument?.object ?? canvas.templates?.get?.(templateDocument?.id);
    if (template?.shape) return true;
    await pause(25);
  }
  return false;
}

async function moveToward(attacker, target, desiredRange = 5) {
  const token = attacker.token.object;
  const targetToken = target.token.object;
  if (!token || !targetToken) return { moved: false, reason: "missing token" };
  const distance = await sceneDistance(token, targetToken);
  const hasLineOfSight = (topLeft) => !lsLineBlocked(token, targetToken, topLeft, "sight");
  if (distance <= desiredRange && hasLineOfSight({ x: token.x, y: token.y })) {
    return { moved: false, reason: "already in range with line of sight" };
  }
  const speed = numeric(attacker.actor.system?.attributes?.speed, 25);
  const maxSteps = Math.max(1, Math.floor(speed / Math.max(5, canvas.grid.distance)));
  const targetCenter = targetToken.center;
  const distanceAt = (topLeft) => {
    const center = lsCenterFor(token, topLeft);
    const centerDistance = canvas.grid.measurePath([center, targetCenter]).distance;
    const radius = Math.max(0, ((Math.max(token.w, token.h) + Math.max(targetToken.w, targetToken.h)) / 2 - canvas.grid.size)
      * canvas.grid.distance / canvas.grid.size);
    return Math.max(0, centerDistance - radius);
  };
  const path = lsGridPath(token, {
    maxSteps,
    isGoal: (topLeft) => distanceAt(topLeft) <= desiredRange && hasLineOfSight(topLeft),
    score: (topLeft) => -distanceAt(topLeft) - (hasLineOfSight(topLeft) ? 0 : 10000),
    allowBest: true,
  });
  const startingTopLeft = { x: token.x, y: token.y };
  const startingScore = -distanceAt(startingTopLeft) - (hasLineOfSight(startingTopLeft) ? 0 : 10000);
  const destinationScore = path?.length
    ? -distanceAt(path.at(-1)) - (hasLineOfSight(path.at(-1)) ? 0 : 10000)
    : Number.NEGATIVE_INFINITY;
  if (!path?.length || destinationScore <= startingScore) {
    return { moved: false, reason: "no unoccupied grid square within one Stride improves range and line of sight around the Scene walls" };
  }
  return await lsMoveTokenAlong(attacker, path)
    ? { moved: true, distance: distanceAt(path.at(-1)), path }
    : { moved: false, reason: "destination became occupied" };
}

async function moveAwayFromThreats(attacker, target, combatants, desiredRange = 30) {
  const token = attacker.token.object;
  if (!token) return false;
  const speed = numeric(attacker.actor.system?.attributes?.speed, 25);
  const maxSteps = Math.max(1, Math.floor(speed / Math.max(5, canvas.grid.distance)));
  const enemies = combatants.filter((candidate) => candidate.team !== attacker.team && !candidate.defeated && candidate.token?.object);
  const distanceScore = (topLeft) => {
    const center = lsCenterFor(token, topLeft);
    const nearest = Math.min(...enemies.map((enemy) => canvas.grid.measurePath([center, enemy.token.object.center]).distance));
    const targetDistance = canvas.grid.measurePath([center, target.token.object.center]).distance;
    return nearest - Math.max(0, targetDistance - 0.9 * Math.max(30, desiredRange));
  };
  const startingScore = distanceScore({ x: token.x, y: token.y });
  const path = lsGridPath(token, {
    maxSteps,
    isGoal: () => false,
    score: distanceScore,
    allowBest: true,
  });
  if (!path?.length || distanceScore(path.at(-1)) < startingScore + canvas.grid.distance) return false;
  return lsMoveTokenAlong(attacker, path);
}

async function moveToSafeFlank(attacker, target, combatants) {
  const token = attacker.token.object;
  const targetToken = target.token.object;
  if (!token || !targetToken || canvas.grid.type !== CONST.GRID_TYPES.SQUARE) return false;
  const targetOffset = canvas.grid.getOffset(targetToken.center);
  const allies = combatants.filter((candidate) => candidate.team === attacker.team && candidate !== attacker && !candidate.defeated && candidate.token?.object);
  const ally = allies.find((candidate) => sceneDistance(candidate.token.object, targetToken) <= 5);
  if (!ally) return false;
  const allyOffset = canvas.grid.getOffset(ally.token.object.center);
  const deltaI = Math.sign(targetOffset.i - allyOffset.i);
  const deltaJ = Math.sign(targetOffset.j - allyOffset.j);
  if (!deltaI && !deltaJ) return false;
  const destinationOffset = { i: targetOffset.i + deltaI, j: targetOffset.j + deltaJ };
  const destination = lsTopLeftForOffset(destinationOffset);
  if (lsOccupiedAt(token, destination)) return false;
  const speed = numeric(attacker.actor.system?.attributes?.speed, 25);
  const maxSteps = Math.max(1, Math.floor(speed / Math.max(5, canvas.grid.distance)));
  const path = lsGridPath(token, {
    maxSteps,
    isGoal: (topLeft) => Math.abs(topLeft.x - destination.x) < 1 && Math.abs(topLeft.y - destination.y) < 1,
    score: (topLeft) => -Math.hypot(topLeft.x - destination.x, topLeft.y - destination.y),
  });
  return lsMoveTokenAlong(attacker, path);
}

async function separateOverlappingCombatants(combatants) {
  for (const combatant of combatants) {
    const token = combatant.token?.object;
    if (!token || !lsOccupiedAt(token, { x: token.x, y: token.y })) continue;
    const path = lsGridPath(token, {
      maxSteps: 4,
      isGoal: (topLeft) => !lsOccupiedAt(token, topLeft),
      score: (_topLeft, pathSteps) => -pathSteps.length,
    });
    if (path?.length) await lsMoveTokenAlong(combatant, path);
  }
}

function liveStateSnapshot(combatants, overlay = null) {
  const dimensions = canvas.dimensions;
  return {
    scene: {
      id: canvas.scene?.id ?? "",
      x: dimensions.sceneX,
      y: dimensions.sceneY,
      width: dimensions.sceneWidth,
      height: dimensions.sceneHeight,
      background: canvas.scene?.background?.src ?? canvas.scene?.img ?? "",
      gridSize: canvas.grid.size,
      gridDistance: canvas.grid.distance,
      gridType: canvas.grid.type,
      walls: [...(canvas.scene?.walls ?? [])].map((wall) => ({
        coordinates: [...(wall.c ?? [])],
        door: Number(wall.door ?? 0),
        doorState: Number(wall.ds ?? 0),
        movement: Number(wall.move ?? wall.movement ?? 0),
        sight: Number(wall.sight ?? 0),
      })).filter((wall) => wall.coordinates.length === 4),
    },
    overlay,
    tokens: combatants.map((combatant) => ({
      actorId: combatant.actor?.id ?? null,
      tokenId: combatant.token?.id ?? null,
      name: combatant.name,
      image: combatant.token?.texture?.src ?? combatant.actor?.img ?? "icons/svg/mystery-man.svg",
      team: combatant.team,
      x: combatant.token?.x ?? combatant.token?.object?.x ?? 0,
      y: combatant.token?.y ?? combatant.token?.object?.y ?? 0,
      width: combatant.token?.object?.w ?? canvas.grid.size,
      height: combatant.token?.object?.h ?? canvas.grid.size,
      hp: combatant.hp,
      maxHp: combatant.maxHp,
      defeated: Boolean(combatant.defeated),
      conditions: [...(combatant.conditions?.entries?.() ?? [])].map(([slug, value]) => ({
        slug,
        value,
        reason: slug === "off-guard" && combatant.flankedBy?.length
          ? `flanked by ${combatant.flankedBy.join(" and ")}`
          : "",
      })),
    })),
  };
}

async function runLiveReplay(tokens, partyIds, enemyIds, {
  combat = game.combat,
  onLog = null,
  delay = game.settings.settings.has(`${MODULE_ID}.liveActionDelay`) ? game.settings.get(MODULE_ID, "liveActionDelay") : 1500,
  control = null,
  isolated = true,
} = {}) {
  const actionDelay = () => Math.max(100, Number(typeof delay === "function" ? delay() : delay) || 1500);
  const waitForControl = async () => {
    while (control?.isPaused?.() && !control?.isStopped?.()) await pause(100);
    return Boolean(control?.isStopped?.());
  };
  const activeCombat = () => {
    if (isolated) return null;
    const candidate = (combat?.id && game.combats?.get(combat.id)) ?? game.combat;
    return candidate?.id && game.combats?.get(candidate.id) ? candidate : null;
  };
  const isolatedWorld = isolated ? createIsolatedWorld(tokens) : null;
  const replayTokens = isolatedWorld?.tokens ?? tokens;
  const combatants = replayTokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  await separateOverlappingCombatants(combatants);
  let activeOverlay = null;
  if (isolatedWorld) {
    isolatedWorld.movementDelay = () => Math.max(90, Math.min(320, actionDelay() / 4));
    isolatedWorld.onChange = async (movingToken) => {
      await control?.showMovementFrame?.(
        liveStateSnapshot(combatants, activeOverlay),
        `${movingToken?.name ?? "Combatant"} moves one grid square along the collision-checked path.`,
      );
    };
  }
  const order = [];
  for (const combatant of combatants) {
    const tracked = combat?.combatants?.find((entry) => entry.tokenId === combatant.id);
    let score = Number(tracked?.initiative);
    if (!isolated && !Number.isFinite(score) && tracked && typeof combat?.rollInitiative === "function") {
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
    await onLog?.({ text, kind, timestamp: Date.now(), snapshot: liveStateSnapshot(combatants, activeOverlay) });
    if (game.settings.settings.has(`${MODULE_ID}.mirrorLiveToChat`) && game.settings.get(MODULE_ID, "mirrorLiveToChat")) {
      await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<p>${escapeHtml(text)}</p>` });
    }
  };
  await emit(`Initiative: ${order.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}.`, "round");
  await emit(`Tactical flows: ${combatants.map((combatant) => `${combatant.name} — ${combatant.profile.flow?.name ?? "General Tactical AI"}`).join("; ")}.`, "action");
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
      attacker.damageActionsThisTurn = 0;
      attacker.utilityActionsThisTurn = 0;
      attacker.tacticalRepositioned = false;
      attacker.conditions.delete("defended");
      for (const [key, roundsLeft] of attacker.cooldowns) {
        attacker.cooldowns.set(key, Math.max(0, roundsLeft - 1));
      }
      if (!isolated && attacker.actor.system?.attributes?.shield?.raised) {
        await attacker.actor.update({ "system.attributes.shield.raised": false });
      }
      const turnCombat = activeCombat();
      if (turnCombat && entry.tracked) {
        const actualIndex = turnCombat.turns.findIndex((candidate) => candidate.id === entry.tracked.id);
        if (actualIndex >= 0) await turnCombat.update({ round, turn: actualIndex });
      }
      refreshVirtualFlanking(combatants);
      if (["unconscious", "paralyzed", "petrified"].some((slug) => attacker.conditions.has(slug))) {
        const preventing = ["unconscious", "paralyzed", "petrified"].find((slug) => attacker.conditions.has(slug));
        await emit(`${attacker.name} cannot act because they are ${preventing}.`, "condition");
        continue;
      }
      const slowed = Math.max(0, Number(attacker.conditions.get("slowed") ?? 0));
      const stunned = Math.max(0, Number(attacker.conditions.get("stunned") ?? 0));
      const stunnedActions = Math.min(3, stunned);
      let actionsRemaining = Math.max(0, 3 - slowed - stunnedActions);
      if (stunnedActions) {
        const remainingStunned = stunned - stunnedActions;
        if (remainingStunned > 0) attacker.conditions.set("stunned", remainingStunned);
        else attacker.conditions.delete("stunned");
      }
      if (slowed || stunnedActions) {
        await emit(`${attacker.name} begins the turn with ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} because of ${[
          slowed ? `slowed ${slowed}` : "",
          stunnedActions ? `stunned ${stunned}` : "",
        ].filter(Boolean).join(" and ")}.`, "condition");
      }
      if (attacker.conditions.has("prone") && actionsRemaining > 0) {
        actionsRemaining -= 1;
        attacker.conditions.delete("prone");
        refreshVirtualFlanking(combatants);
        await emit(`${attacker.name} uses the PF2e Stand action and is no longer prone; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "condition");
        await pause(actionDelay());
      }
      if (attacker.conditions.has("restrained") && actionsRemaining > 0) {
        const restrainer = chooseTarget(attacker, combatants);
        while (attacker.conditions.has("restrained") && actionsRemaining > 0) {
          const escape = await rollVirtualEscape(attacker, restrainer);
          actionsRemaining -= 1;
          await emit(`${attacker.name} is restrained and must use the PF2e Escape action: ${Number.isFinite(escape.total) ? escape.total : "no readable roll"} vs DC ${escape.dc}, ${escape.success ? "success; restrained ends" : "failure; restrained remains"}.`, "condition");
          await pause(actionDelay());
        }
        if (attacker.conditions.has("restrained")) continue;
      }
      if (attacker.conditions.has("fleeing") && actionsRemaining > 0) {
        const threat = chooseTarget(attacker, combatants);
        while (actionsRemaining > 0 && threat) {
          const moved = await moveAwayFromThreats(attacker, threat, combatants, 60);
          actionsRemaining -= 1;
          refreshVirtualFlanking(combatants);
          await emit(`${attacker.name} is fleeing and ${moved ? "Strides away from" : "cannot move farther from"} ${threat.name}; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "condition");
          await pause(actionDelay());
          if (!moved) break;
        }
        continue;
      }
      let map = 0;
      while (actionsRemaining > 0) {
        if (await waitForControl()) {
          await emit("Live combat stopped by the GM.", "round");
          return { stopped: true, round };
        }
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map, round);
        if (!choice) break;
        let temporaryTemplate = null;
        let selectedOption = choice.option;
        let selectedTarget = choice.target;
        let resolutionStage = "tactical selection";
        try {
        const { option, target, cost } = choice;
        selectedOption = option;
        selectedTarget = target;
        if (!option.defensive && target !== attacker) {
          resolutionStage = "range and movement validation";
          const currentDistance = sceneDistance(attacker.token.object, target.token.object);
          const effectiveRange = effectiveActionRange(option);
          const lineOfSightBlocked = lsLineBlocked(attacker.token.object, target.token.object, undefined, "sight");
          const positioning = String(attacker.profile.positioning ?? "").toLowerCase();
          const prefersRange = effectiveRange > 10 && (
            attacker.profile.roles.includes("caster") || attacker.profile.roles.includes("ranged")
            || /backline|midline|at range|protected/.test(positioning)
          );
          if (prefersRange && currentDistance <= 10 && actionsRemaining > cost && !attacker.tacticalRepositioned) {
            const movedAway = await moveAwayFromThreats(attacker, target, combatants, effectiveRange);
            if (movedAway) {
              actionsRemaining -= 1;
              attacker.tacticalRepositioned = true;
              await emit(`${attacker.name} Strides away from melee pressure to preserve a clear ${option.name} firing lane; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "move");
              await pause(actionDelay());
              continue;
            }
          }
          const frontline = attacker.profile.roles.includes("frontline") || /frontline|melee flank|anchor/.test(positioning);
          const targetOffGuard = target.conditions?.has?.("off-guard") || target.conditions?.has?.("prone") || target.conditions?.has?.("grabbed");
          if (frontline && option.damage && effectiveRange <= 10 && currentDistance <= effectiveRange
            && !targetOffGuard && actionsRemaining > cost && !attacker.tacticalRepositioned && randomUnit() < 0.55) {
            const flanked = await moveToSafeFlank(attacker, target, combatants);
            if (flanked) {
              actionsRemaining -= 1;
              attacker.tacticalRepositioned = true;
              refreshVirtualFlanking(combatants);
              await emit(`${attacker.name} Strides to the opposite side of ${target.name} for a rules-legal flank; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "move");
              await pause(actionDelay());
              continue;
            }
          }
          if (currentDistance > effectiveRange || lineOfSightBlocked) {
            if (["immobilized", "grabbed", "restrained"].some((slug) => attacker.conditions.has(slug))) {
              const preventing = ["restrained", "grabbed", "immobilized"].find((slug) => attacker.conditions.has(slug));
              actionsRemaining -= 1;
              const escape = await rollVirtualEscape(attacker, target);
              await emit(`${attacker.name} uses the PF2e Escape action: ${Number.isFinite(escape.total) ? escape.total : "no readable roll"} vs DC ${escape.dc}, ${escape.success ? `success; ${preventing} ends` : `failure; ${preventing} remains`}.`, "condition");
              await pause(actionDelay());
              continue;
            }
            const movement = await moveToward(attacker, target, effectiveRange);
            if (!movement.moved) {
              const requirement = lineOfSightBlocked ? "range and an unobstructed line of sight" : "range";
              await emit(`${attacker.name} cannot reach ${option.name}'s ${effectiveRange}-foot ${requirement} from an unoccupied square with one Stride (${movement.reason}).`, "action");
              break;
            }
            actionsRemaining -= 1;
            attacker.tacticalRepositioned = true;
            refreshVirtualFlanking(combatants);
            await emit(`${attacker.name} Strides along an unoccupied grid path toward ${target.name}; now ${movement.distance} feet away, with ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "move");
            await pause(actionDelay());
            continue;
          }
        }
        resolutionStage = "PF2e resource and Cast/use control";
        const nativeUse = await consumeNativeResource(option, attacker.actor, { isolated });
        if (!nativeUse.available) {
          const key = option.useKey ?? option.id;
          attacker.uses.set(key, 0);
          await emit(`${attacker.name} cannot use ${option.name}: ${nativeUse.source}. The action is not spent.`, "error");
          continue;
        }
        actionsRemaining -= cost;
        consumeUse(attacker, option, target);
        if (option.damage) attacker.damageActionsThisTurn += 1;
        else if (!option.healing) attacker.utilityActionsThisTurn += 1;
        resolutionStage = "PF2e action card";
        const nativeActionCard = nativeUse.message ?? (isolated ? null : await postNativeActionCard(option));
        if (option.healing) {
          resolutionStage = "PF2e healing roll button";
          const healingRoll = await rollNativeDamage(option, attacker, target, 2, map, nativeActionCard, { isolated });
          resolutionStage = "PF2e healing application";
          const healing = isolated
            ? applyIsolatedDamageOrHealing(target, healingRoll, 2, option)
            : await applyNativeDamageOrHealing(target, healingRoll, 2, option);
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
          resolutionStage = "PF2e defensive effect";
          const nativeDefense = isolated
            ? { applied: true, source: "isolated defensive state" }
            : await applyNativeDefense(option, attacker.actor);
          if (isolated) attacker.conditions.set("defended", 1);
          const applied = isolated
            ? applyVirtualConditions(attacker, option.conditions)
            : await applyConditions(attacker, option.conditions);
          await emit(`${attacker.name} uses ${option.name}${applied.length ? ` and gains ${applied.join(", ")}` : ""} [${nativeDefense.source}]; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "action");
          await pause(actionDelay());
          continue;
        }
        resolutionStage = "measured-template placement";
        const templateSource = templateData(option, attacker.token.object, target.token.object);
        if (templateSource && isolated) {
          activeOverlay = templateSource;
        } else if (templateSource && canvas.scene) {
          const cleanTemplate = Object.fromEntries(Object.entries(templateSource).filter(([, value]) => value !== undefined));
          [temporaryTemplate] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [cleanTemplate]);
          await waitForTemplateShape(temporaryTemplate);
        }
        const targetList = actionTargets(
          option,
          target,
          combatants,
          isolated && templateSource ? (candidate) => combatantInsideVirtualArea(templateSource, candidate)
            : temporaryTemplate ? (candidate) => combatantInsideTemplate(temporaryTemplate, candidate) : null,
        );
        const outcomes = [];
        const nativeRolls = new Map();
        for (const affected of targetList) {
          refreshVirtualFlanking(combatants);
          const baseAc = actorAc(affected.actor);
          const offGuardPenalty = option.attackTrait && affected.conditions.has("off-guard") ? 2 : 0;
          const defenseDc = baseAc - offGuardPenalty;
          resolutionStage = `PF2e check/save button for ${affected.name}`;
          const nativeCheck = option.automatic ? null : await resolveNativeCheck({
            option,
            attacker,
            target: affected,
            nativeMessage: nativeActionCard,
            mapPenalty: map,
            dc: option.save ? option.dc : defenseDc,
            checkDegree,
            isolated,
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
              : `${affected.name}: ${liveCheckSummary(nativeCheck)} vs ${option.defenseStatistic ?? "AC"} ${nativeCheck.dc}${offGuardPenalty ? ` (base AC ${baseAc}; off-guard because ${affected.flankedBy?.length ? `flanked by ${affected.flankedBy.join(" and ")}` : "of a condition"})` : ""}, ${degreeText(degree)} [PF2e native]`
            : `${affected.name}: the PF2e entry requires no check`;
          const effectApplies = option.save ? degree <= 1 : option.automatic || degree >= 2;
          let damage = null;
          if (option.damage && (option.save || degree >= 2)) {
            const rollKey = option.save ? "save" : degree === 3 ? "critical" : "success";
            let damageRoll = nativeRolls.get(rollKey);
            if (!damageRoll) {
              resolutionStage = `PF2e damage roll button for ${affected.name}`;
              damageRoll = await rollNativeDamage(option, attacker, affected, degree, map, nativeActionCard, { isolated });
              if (damageRoll) nativeRolls.set(rollKey, damageRoll);
            }
            resolutionStage = `PF2e damage application to ${affected.name}`;
            damage = isolated
              ? applyIsolatedDamageOrHealing(affected, damageRoll, degree, option)
              : await applyNativeDamageOrHealing(affected, damageRoll, degree, option);
          }
          resolutionStage = `PF2e conditions and effects for ${affected.name}`;
          const conditions = effectApplies
            ? isolated ? applyVirtualConditions(affected, option.conditions) : await applyConditions(affected, option.conditions)
            : [];
          if (effectApplies) {
            for (const condition of option.conditions) {
              affected.conditions.set(condition.slug, Math.max(affected.conditions.get(condition.slug) ?? 0, condition.value));
            }
          }
          const clickedCardEffect = !isolated && effectApplies && nativeActionCard
            ? await clickNativeCardEffect(nativeActionCard)
            : false;
          const structured = effectApplies && !clickedCardEffect
            ? isolated ? applyVirtualStructuredEffects(option, attacker, affected) : await applyNativeStructuredEffects(option, attacker, affected)
            : [];
          const missingDamage = option.damage && (option.save || degree >= 2) && !damage
            ? "; PF2e's native damage control did not return a roll, so no formula was invented"
            : "";
          outcomes.push(`${outcome}${damage ? `; native damage roll ${damage.summary}; ${damage.amount} ${option.damageType || ""} damage applied, HP ${affected.hp}/${affected.maxHp}` : ""}${missingDamage}${conditions.length || structured.length || clickedCardEffect ? `; ${[...conditions, ...structured, ...(clickedCardEffect ? ["native card effect"] : [])].join(", ")}` : ""}`);
          if (!isolated && affected.defeated) {
            const trackedTarget = activeCombat()?.combatants?.find((candidate) => candidate.tokenId === affected.id);
            await trackedTarget?.update({ defeated: true });
          }
        }
        const resolution = outcomes.length ? outcomes.join(" | ") : "no tokens occupy the highlighted area";
        await emit(`${attacker.name} uses ${option.name}${option.kind === "spell" ? ` through ${nativeUse.source}` : ""}, spending ${cost} action${cost === 1 ? "" : "s"}: ${resolution}.`, option.damage ? "damage" : "action");
        if (!isolated) {
          target.token.object?.control({ releaseOthers: true });
          await canvas.animatePan({ x: target.token.object?.center.x, y: target.token.object?.center.y, duration: Math.min(500, actionDelay() / 3) });
        }
        await pause(actionDelay());
        if (temporaryTemplate) await temporaryTemplate.delete();
        activeOverlay = null;
        if (option.attackTrait) map += 5;
        } catch (error) {
          if (temporaryTemplate) await temporaryTemplate.delete().catch(() => {});
          activeOverlay = null;
          const actionName = selectedOption?.name ?? "unknown action";
          const targetName = selectedTarget?.name ? ` against ${selectedTarget.name}` : "";
          console.error(`${MODULE_ID} | Could not resolve ${attacker.name}'s ${actionName} during ${resolutionStage}.`, error);
          await emit(`${attacker.name}'s ${actionName}${targetName} failed during ${resolutionStage}: ${error.message ?? error}.`, "error");
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

function newSessionNpc() {
  return { id: foundry.utils.randomID(), name: "", image: "", role: "", motivation: "", secret: "" };
}

const SESSION_MUSIC_MOMENTS = ["Opening", "Exploration", "Social scene", "Tension", "Combat", "Revelation", "Victory", "Defeat", "Closing", "Custom"];

function newSessionMusicCue() {
  return { id: foundry.utils.randomID(), name: "", moment: "Opening", mood: "", playlistId: "", soundId: "", audio: "", notes: "" };
}

function newSessionPeopleEntry(description = "") {
  return { id: foundry.utils.randomID(), name: "", description };
}

function newSessionTextEntry(text = "") {
  return { id: foundry.utils.randomID(), text };
}

function newSessionEncounter() {
  return { id: foundry.utils.randomID(), type: "social", description: "", actors: [] };
}

function newSessionPrep() {
  return {
    title: "", goal: "", opening: "", ending: "",
    locations: [newSessionLocation(), newSessionLocation()],
    npcs: [newSessionNpc()],
    musicCues: [newSessionMusicCue()],
    peopleEntries: [newSessionPeopleEntry()], hazards: [], encounterEntries: [newSessionEncounter()],
    sceneEntries: [newSessionTextEntry()], clueEntries: [newSessionTextEntry()], rewardItems: [],
    consequenceEntries: [newSessionTextEntry()], changeEntries: [newSessionTextEntry()],
    people: "", opposition: "", scenes: "", rewards: "", reminders: "",
  };
}

function sessionHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function sessionBlock(title, value) {
  const content = String(value ?? "").trim();
  return content ? `<p><strong>${escapeHtml(title)}</strong></p><p>${sessionHtml(content)}</p>` : "";
}

function sessionLocationPage(location) {
  const senses = [["Sight", location.sight], ["Hearing", location.hearing], ["Smell", location.smell], ["Touch", location.touch], ["Taste", location.taste]]
    .filter(([, value]) => String(value ?? "").trim())
    .map(([sense, value]) => `<p><strong>${sense}</strong> ${sessionHtml(value)}</p>`).join("");
  const image = String(location.image ?? "").trim()
    ? `<figure><img src="${escapeHtml(location.image)}" alt="${escapeHtml(location.name)}"></figure>` : "";
  return `${image}${sessionBlock("Why this place matters", location.purpose)}${senses ? `<hr><p><strong>Description</strong></p>${senses}` : ""}` || "<p>Describe this location before play.</p>";
}

function sessionNpcPage(npc) {
  const image = String(npc.image ?? "").trim()
    ? `<figure><img src="${escapeHtml(npc.image)}" alt="${escapeHtml(npc.name)}"></figure>` : "";
  return `${image}${sessionBlock("Role in the session", npc.role)}${sessionBlock("Motivation", npc.motivation)}${sessionBlock("Secret or complication", npc.secret)}`
    || "<p>Add this NPC's role, motivation, and secrets here.</p>";
}

function sessionReferenceLink(reference) {
  return reference?.uuid ? `@UUID[${reference.uuid}]{${escapeHtml(reference.name || "Foundry document")}}` : escapeHtml(reference?.name || "Foundry document");
}

function sessionList(title, entries) {
  const rows = entries.filter((value) => String(value ?? "").trim());
  return rows.length ? `<p><strong>${escapeHtml(title)}</strong></p><ul>${rows.map((value) => `<li>${sessionHtml(value)}</li>`).join("")}</ul>` : "";
}

function normalizeSessionReference(reference = {}) {
  return {
    id: reference.id || foundry.utils.randomID(),
    uuid: String(reference.uuid ?? ""), name: String(reference.name ?? "Foundry document"),
    img: String(reference.img ?? "icons/svg/item-bag.svg"), type: String(reference.type ?? ""),
  };
}

function normalizeSessionTextEntries(entries, fallback = "") {
  const source = Array.isArray(entries) && entries.length ? entries : [newSessionTextEntry(fallback)];
  return source.map((entry) => ({ ...newSessionTextEntry(), ...entry, id: entry.id || foundry.utils.randomID() }));
}

const CAMPAIGN_LENGTHS = {
  short: { label: "Short campaign", scope: "A focused campaign with one central conflict, 3–5 major milestones, a compact setting, and a clear range of possible endings.", structureLabel: "Campaign milestones", structureSingular: "Milestone", structureSummaryLabel: "Situation or turning point", structureOutcomeLabel: "Possible outcomes and transition", resolutionLabel: "Possible campaign endings", structureMin: 3, locationMin: 2, factionMin: 2, threatMin: 2, peopleMin: 3 },
  long: { label: "Long campaign", scope: "A multi-arc campaign with evolving threats, several regions, recurring factions, character development, and 3 or more distinct story arcs.", structureLabel: "Story arcs", structureSingular: "Arc", structureSummaryLabel: "Central conflict and developments", structureOutcomeLabel: "How this reshapes later arcs", resolutionLabel: "Possible endings and lasting outcomes", structureMin: 3, locationMin: 4, factionMin: 4, threatMin: 3, peopleMin: 5 },
  open: { label: "Open-ended sandbox", scope: "A reactive campaign built from locations, opportunities, faction agendas, and threat clocks rather than a predetermined sequence or ending.", structureLabel: "Active situations and opportunities", structureSingular: "Situation", structureSummaryLabel: "Who wants what, and what is happening now?", structureOutcomeLabel: "What advances or changes if ignored?", resolutionLabel: "Ways the world can change through play", structureMin: 4, locationMin: 4, factionMin: 4, threatMin: 4, peopleMin: 4 },
};

const CAMPAIGN_STYLES = {
  adventure: {
    label: "Adventure",
    guidance: "Keep the objective visible, make each location present a meaningful choice, and let success change the situation.",
    people: ["A capable ally who can point toward the first objective", "An opponent actively advancing the central problem", "A witness who knows where the danger began"],
  },
  mystery: {
    label: "Mystery",
    guidance: "Define the true answer privately, then make every essential conclusion discoverable through multiple clues.",
    people: ["A witness who wants the truth discovered", "A suspect or obstructive authority", "An informed person who is hiding part of the truth"],
  },
  exploration: {
    label: "Exploration",
    guidance: "Give places distinct identities, discoveries, routes, and risks. Travel should reveal choices rather than consume time by itself.",
    people: ["A guide, patron, or survivor", "A rival explorer or territorial resident", "A scholar who understands one part of the destination"],
  },
  politics: {
    label: "Political intrigue",
    guidance: "Give every important person a public objective, a private need, and leverage that can change their position.",
    people: ["A potential ally with a price", "A rival representative with legitimate interests", "An intermediary who knows the relationships between factions"],
  },
  horror: {
    label: "Horror",
    guidance: "Establish boundaries first, reveal the threat gradually, and preserve meaningful choices even when the characters feel vulnerable.",
    people: ["A survivor or protector", "A person influenced by the threat", "A witness who understands one disturbing sign"],
  },
  sandbox: {
    label: "Sandbox",
    guidance: "Prepare active situations, not a sequence. The world should react consistently to whichever direction the party chooses.",
    people: ["A local contact offering an opportunity", "A rival pursuing their own objective", "A well-connected person who knows several possible directions"],
  },
};

const CAMPAIGN_TONES = {
  heroic: "Heroic and hopeful",
  "dark-heroic": "Dark but heroic",
  lighthearted: "Lighthearted",
  grim: "Grim and dangerous",
  mythic: "Mythic and wondrous",
};

function newCampaignPerson(slot, label) {
  return { id: foundry.utils.randomID(), slot, label, name: "", description: "", wants: "", knows: "", secret: "" };
}

function newCampaignCharacter() {
  return { id: foundry.utils.randomID(), name: "", involvement: "", npcConnection: "", desire: "", bond: "", complication: "", growth: "" };
}

function newCampaignStructure() {
  return { id: foundry.utils.randomID(), name: "", summary: "", outcome: "" };
}

function newCampaignLocation() {
  return {
    id: foundry.utils.randomID(), name: "", type: "settlement", x: null, y: null, image: "",
    description: "", importance: "", secret: "", currentSituation: "", people: "", services: "",
    reasonToLeave: "", ignored: "", relationship: "", reasonToVisit: "", opportunity: "",
    danger: "", lead: "", travel: "", knownFor: "", rumor: "", futureUse: "",
  };
}

function newCampaignRoute() {
  return { id: foundry.utils.randomID(), fromId: "", toId: "", type: "road", travel: "", feature: "", complication: "" };
}

const CAMPAIGN_POINT_TYPES = {
  settlement: "Settlement", city: "City", town: "Town", village: "Village", landmark: "Landmark",
  ruin: "Ruins", dungeon: "Dungeon", lake: "Lake", river: "River", mountains: "Mountains",
  forest: "Forest", road: "Road", pass: "Mountain pass", custom: "Custom",
};

const CAMPAIGN_POINT_ICONS = {
  settlement: "fa-house", city: "fa-city", town: "fa-building", village: "fa-house-chimney",
  landmark: "fa-monument", ruin: "fa-archway", dungeon: "fa-dungeon", lake: "fa-water",
  river: "fa-water", mountains: "fa-mountain", forest: "fa-tree", road: "fa-road",
  pass: "fa-mountain-sun", custom: "fa-location-dot",
};

function campaignMapRecoveryKey() {
  return `${MODULE_ID}.campaign-map-recovery.${game.world?.id ?? "world"}.${game.user?.id ?? "user"}`;
}

function readCampaignMapRecovery() {
  try {
    const raw = globalThis.localStorage?.getItem(campaignMapRecoveryKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Lore Smith | Could not read the emergency campaign-map recovery copy.", error);
    return null;
  }
}

function writeCampaignMapRecovery(serialized) {
  try {
    globalThis.localStorage?.setItem(campaignMapRecoveryKey(), serialized);
  } catch (error) {
    console.warn("Lore Smith | Could not write the emergency campaign-map recovery copy.", error);
  }
}

function parseStoredDraft(raw, label) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Lore Smith | Could not read the ${label} campaign-map draft.`, error);
    return null;
  }
}

const CAMPAIGN_ROUTE_TYPES = {
  road: "Road", trail: "Trail", river: "River route", ferry: "Ferry or sea route", pass: "Mountain pass",
  trade: "Trade connection", political: "Political relationship", conflict: "Conflict", mystery: "Shared mystery",
};

function newCampaignFaction() {
  return { id: foundry.utils.randomID(), name: "", goal: "", methods: "", resources: "", relationship: "", ignored: "" };
}

function newCampaignThreat() {
  return { id: foundry.utils.randomID(), name: "", goal: "", escalation: "", consequences: "" };
}

function newCampaignQuestion() {
  return { id: foundry.utils.randomID(), text: "" };
}

function newCampaignSecret() {
  return { id: foundry.utils.randomID(), secret: "", clues: "", knownBy: "" };
}

function newCampaignRumor() {
  return { id: foundry.utils.randomID(), text: "", truth: "" };
}

function newCampaignWorldEvent() {
  return { id: foundry.utils.randomID(), trigger: "", event: "", consequence: "" };
}

function newCampaignChapter(number = 1) {
  return {
    id: foundry.utils.randomID(), number, title: "", purpose: "", opening: "", information: "",
    locations: "", npcs: "", scenes: "", revelations: "", encounters: "", rewards: "",
    choices: "", consequences: "", transition: "",
  };
}

function campaignScope(campaign) {
  return CAMPAIGN_LENGTHS[campaign.length] ?? CAMPAIGN_LENGTHS.short;
}

function campaignSessionCount(campaign) {
  return Math.max(1, Math.min(100, Number(campaign.sessionCount) || 10));
}

function campaignPlanTargets(campaign) {
  const sessions = campaignSessionCount(campaign);
  if (campaign.length === "open") return {
    sessions, structure: Math.max(4, Math.ceil(sessions / 2)), locations: Math.max(4, Math.ceil(sessions * 0.6)),
    factions: Math.max(3, Math.ceil(sessions / 3)), threats: Math.max(4, Math.ceil(sessions / 2)),
    people: Math.max(4, Math.ceil(sessions * 0.5)), rumors: Math.max(6, Math.ceil(sessions * 1.2)), worldEvents: sessions,
  };
  if (campaign.length === "long") return {
    sessions, structure: Math.max(3, Math.ceil(sessions / 6)), locations: Math.max(4, Math.ceil(sessions / 4)),
    factions: Math.max(4, Math.ceil(sessions / 7)), threats: Math.max(3, Math.ceil(sessions / 8)),
    people: Math.max(5, Math.ceil(sessions / 4)), rumors: 0, worldEvents: 0,
  };
  return {
    sessions, structure: 3, locations: Math.max(2, Math.min(5, Math.ceil(sessions / 3))), factions: 2,
    threats: Math.max(2, Math.min(3, Math.ceil(sessions / 5))), people: Math.max(3, Math.min(5, Math.ceil(sessions / 3))),
    rumors: 0, worldEvents: 0,
  };
}

function campaignChapterGrouping(campaign, chapterIndex) {
  const count = campaignSessionCount(campaign);
  if (campaign.length === "short") {
    const firstActEnd = Math.max(1, Math.ceil(count * 0.2));
    const secondActEnd = Math.max(firstActEnd + 1, count - Math.max(1, Math.floor(count * 0.2)));
    if (chapterIndex < firstActEnd) return { group: 1, groupLabel: "Act I — Introduction" };
    if (chapterIndex < secondActEnd) return { group: 2, groupLabel: "Act II — Escalation" };
    return { group: 3, groupLabel: "Act III — Resolution" };
  }
  const arcCount = Math.max(2, Math.ceil(count / 6));
  const group = Math.min(arcCount, Math.floor((chapterIndex * arcCount) / count) + 1);
  return { group, groupLabel: group === arcCount ? `Final Arc ${group}` : `Arc ${group}` };
}

function ensureCampaignPlan(campaign) {
  const targets = campaignPlanTargets(campaign);
  campaign.sessionCount = targets.sessions;
  if (!Array.isArray(campaign.chapters)) campaign.chapters = [];
  if (campaign.length !== "open") {
    while (campaign.chapters.length < targets.sessions) campaign.chapters.push(newCampaignChapter(campaign.chapters.length + 1));
    campaign.chapters = campaign.chapters.map((chapter, index) => ({ ...newCampaignChapter(index + 1), ...chapter, number: index + 1, id: chapter.id || foundry.utils.randomID() }));
  }
  if (!Array.isArray(campaign.rumors)) campaign.rumors = [];
  if (!Array.isArray(campaign.worldEvents)) campaign.worldEvents = [];
  if (campaign.length === "open") {
    while (campaign.rumors.length < targets.rumors) campaign.rumors.push(newCampaignRumor());
    while (campaign.worldEvents.length < targets.worldEvents) campaign.worldEvents.push(newCampaignWorldEvent());
  }
  return campaign;
}

function campaignMarkerDistance(campaign, location) {
  const focus = campaign.map?.focus;
  if (!focus || !Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) return null;
  const aspect = Math.max(0.1, Number(focus.aspect) || 1);
  return Math.hypot(Number(location.x) - Number(focus.x), (Number(location.y) - Number(focus.y)) / aspect);
}

function campaignLocationBand(campaign, location) {
  if (location.id === campaign.map?.startLocationId) return "center";
  const distance = campaignMarkerDistance(campaign, location);
  const radius = Math.max(0.02, Number(campaign.map?.focus?.radius) || 0.25);
  if (distance === null || distance > radius) return "outside";
  return distance <= radius * 0.6 ? "nearby" : "distant";
}

function campaignLocationGuidance(location, band) {
  const type = CAMPAIGN_POINT_TYPES[location.type] ?? "Location";
  if (band === "center") return `Prepare ${location.name || "the starting location"} deeply. Establish what is happening now, who matters, what the characters can do here, and what pushes them toward the surrounding region.`;
  if (band === "nearby") return `Prepare this nearby ${type.toLowerCase()} enough to support a visit: its relationship with the starting area, a reason to travel there, an opportunity or danger, and a lead pointing toward it.`;
  if (band === "distant") return `Keep this distant ${type.toLowerCase()} light. Give it one memorable identity, one rumor, and one reason it might matter later. Expand it only when play moves toward it.`;
  return "This point is outside the current campaign focus. Name it for map context, but do not prepare it yet.";
}

function campaignMapView(campaign) {
  const start = campaign.locations.find((location) => location.id === campaign.map?.startLocationId);
  const focusX = Number(campaign.map?.focus?.x) || 0.5;
  const focusY = Number(campaign.map?.focus?.y) || 0.5;
  const radius = Math.max(0.02, Number(campaign.map?.focus?.radius) || 0.25);
  const aspect = Math.max(0.1, Number(campaign.map?.focus?.aspect) || 1);
  return {
    image: campaign.map?.image ?? "", hasImage: Boolean(campaign.map?.image), startLocationId: campaign.map?.startLocationId ?? "",
    focusX, focusY, radius, aspect, focusLeft: `${focusX * 100}%`, focusTop: `${focusY * 100}%`,
    focusSize: `${radius * 200}%`, focusHeight: `${radius * 200 * aspect}%`, startName: start?.name || "No starting point selected",
    zoom: Math.max(1, Math.min(5, Number(campaign.map?.view?.zoom) || 1)),
    panX: Number(campaign.map?.view?.panX) || 0,
    panY: Number(campaign.map?.view?.panY) || 0,
  };
}

function ensureCampaignMapScope(campaign) {
  if (!campaign.map || typeof campaign.map !== "object") campaign.map = { image: "", startLocationId: "", focus: { x: 0.5, y: 0.5, radius: 0.25, aspect: 2 }, view: { zoom: 1, panX: 0, panY: 0 } };
  campaign.map.focus = { x: 0.5, y: 0.5, radius: 0.25, aspect: 2, ...(campaign.map.focus ?? {}) };
  campaign.map.view = { zoom: 1, panX: 0, panY: 0, ...(campaign.map.view ?? {}) };
  if (!Array.isArray(campaign.routes)) campaign.routes = [];
  for (const property of ["structure", "locations", "factions", "threats"]) if (!Array.isArray(campaign[property])) campaign[property] = [];
  if (!Array.isArray(campaign.people)) campaign.people = [];
  if (!Array.isArray(campaign.openQuestions) || !campaign.openQuestions.length) campaign.openQuestions = [newCampaignQuestion()];
  if (!Array.isArray(campaign.secrets) || !campaign.secrets.length) campaign.secrets = [newCampaignSecret()];
  return ensureCampaignPlan(campaign);
}

function newCampaignMapBuild() {
  return ensureCampaignMapScope({
    journalId: "", name: "", premise: "", startingLevel: 1, finalLevel: 5, sessionCount: 10, sessionHours: 4,
    map: { image: "", startLocationId: "", focus: { x: 0.5, y: 0.5, radius: 0.25, aspect: 2 }, view: { zoom: 1, panX: 0, panY: 0 } }, routes: [],
    length: "short", style: "adventure", tone: "heroic",
    identity: { themes: "", playerPromise: "", boundaries: "" }, background: "", characterHooks: "",
    problem: { wrong: "", cause: "", stakes: "", involvement: "", distinction: "", resolution: "" },
    structure: [], locations: [], factions: [], threats: [], chapters: [], rumors: [], worldEvents: [], secrets: [newCampaignSecret()],
    setting: { history: "", cultures: "", magic: "", politics: "" },
    people: [
      newCampaignPerson("ally", "Someone who helps the party"),
      newCampaignPerson("opponent", "Someone who opposes the party"),
      newCampaignPerson("informant", "Someone who knows important information"),
    ],
    characters: [newCampaignCharacter()],
    progression: { leveling: "milestone", treasure: "", narrative: "", reputation: "", options: "" },
    consistency: { imagery: "", naming: "", rules: "", timeline: "", travel: "" },
    openQuestions: [newCampaignQuestion()],
  });
}

function normalizeCampaignMapBuild(stored = {}) {
  const fresh = newCampaignMapBuild();
  const people = Array.isArray(stored.people) ? stored.people : fresh.people;
  const characters = Array.isArray(stored.characters) ? stored.characters : [];
  const oldPlace = stored.place && [stored.place.name, stored.place.description, stored.place.image].some(Boolean)
    ? [{ ...newCampaignLocation(), name: stored.place.name ?? "", image: stored.place.image ?? "", description: stored.place.description ?? "", importance: stored.place.interest ?? "", secret: stored.place.problem ?? "" }]
    : [];
  const normalized = {
    ...fresh, ...stored,
    length: stored.length === "one-shot" ? "short" : (stored.length ?? fresh.length),
    identity: { ...fresh.identity, ...(stored.identity ?? {}) },
    problem: { ...fresh.problem, ...(stored.problem ?? {}) },
    structure: (Array.isArray(stored.structure) ? stored.structure : []).map((entry) => ({ ...newCampaignStructure(), ...entry, id: entry.id || foundry.utils.randomID() })),
    locations: (Array.isArray(stored.locations) && stored.locations.length ? stored.locations : oldPlace).map((entry) => ({ ...newCampaignLocation(), ...entry, id: entry.id || foundry.utils.randomID() })),
    factions: (Array.isArray(stored.factions) ? stored.factions : []).map((entry) => ({ ...newCampaignFaction(), ...entry, id: entry.id || foundry.utils.randomID() })),
    threats: (Array.isArray(stored.threats) ? stored.threats : []).map((entry) => ({ ...newCampaignThreat(), ...entry, id: entry.id || foundry.utils.randomID() })),
    map: { ...fresh.map, ...(stored.map ?? {}), focus: { ...fresh.map.focus, ...(stored.map?.focus ?? {}) } },
    routes: (Array.isArray(stored.routes) ? stored.routes : []).map((entry) => ({ ...newCampaignRoute(), ...entry, id: entry.id || foundry.utils.randomID() })),
    chapters: (Array.isArray(stored.chapters) ? stored.chapters : []).map((entry, index) => ({ ...newCampaignChapter(index + 1), ...entry, number: index + 1, id: entry.id || foundry.utils.randomID() })),
    rumors: (Array.isArray(stored.rumors) ? stored.rumors : []).map((entry) => ({ ...newCampaignRumor(), ...entry, id: entry.id || foundry.utils.randomID() })),
    worldEvents: (Array.isArray(stored.worldEvents) ? stored.worldEvents : []).map((entry) => ({ ...newCampaignWorldEvent(), ...entry, id: entry.id || foundry.utils.randomID() })),
    secrets: (Array.isArray(stored.secrets) ? stored.secrets : []).map((entry) => ({ ...newCampaignSecret(), ...entry, id: entry.id || foundry.utils.randomID() })),
    setting: { ...fresh.setting, ...(stored.setting ?? {}) },
    people: people.map((person, index) => ({ ...newCampaignPerson(person.slot ?? "person", person.label ?? `Important person ${index + 1}`), ...person, id: person.id || foundry.utils.randomID() })),
    characters: (characters.length ? characters : fresh.characters).map((character) => ({ ...newCampaignCharacter(), ...character, id: character.id || foundry.utils.randomID() })),
    progression: { ...fresh.progression, ...(stored.progression ?? {}) },
    consistency: { ...fresh.consistency, ...(stored.consistency ?? {}) },
    openQuestions: (Array.isArray(stored.openQuestions) ? stored.openQuestions : []).map((entry) => typeof entry === "string" ? { ...newCampaignQuestion(), text: entry } : { ...newCampaignQuestion(), ...entry, id: entry.id || foundry.utils.randomID() }),
  };
  delete normalized.firstSession;
  delete normalized.place;
  return ensureCampaignMapScope(normalized);
}

function ensureCampaignScope(campaign) {
  const targets = campaignPlanTargets(campaign);
  const factories = { structure: newCampaignStructure, locations: newCampaignLocation, factions: newCampaignFaction, threats: newCampaignThreat };
  const minimums = { structure: targets.structure, locations: targets.locations, factions: targets.factions, threats: targets.threats };
  for (const [property, minimum] of Object.entries(minimums)) {
    if (!Array.isArray(campaign[property])) campaign[property] = [];
    while (campaign[property].length < minimum) campaign[property].push(factories[property]());
  }
  if (!Array.isArray(campaign.people)) campaign.people = [];
  while (campaign.people.length < targets.people) campaign.people.push(newCampaignPerson("person", `Important person ${campaign.people.length + 1}`));
  if (!Array.isArray(campaign.openQuestions) || !campaign.openQuestions.length) campaign.openQuestions = [newCampaignQuestion()];
  if (!Array.isArray(campaign.secrets) || !campaign.secrets.length) campaign.secrets = [newCampaignSecret()];
  return ensureCampaignPlan(campaign);
}

function newCampaignBuild() {
  return ensureCampaignScope({
    journalId: "", name: "", premise: "", startingLevel: 1, finalLevel: 5, sessionCount: 10, sessionHours: 4,
    length: "short", style: "adventure", tone: "heroic", identity: { themes: "", playerPromise: "", boundaries: "" },
    background: "", characterHooks: "", problem: { wrong: "", cause: "", stakes: "", involvement: "", distinction: "", resolution: "" },
    structure: [], locations: [], factions: [], threats: [], chapters: [], rumors: [], worldEvents: [], secrets: [newCampaignSecret()],
    setting: { history: "", cultures: "", magic: "", politics: "" },
    people: [newCampaignPerson("ally", "Someone who helps the party"), newCampaignPerson("opponent", "Someone who opposes the party"), newCampaignPerson("informant", "Someone who knows important information")],
    characters: [newCampaignCharacter()], progression: { leveling: "milestone", treasure: "", narrative: "", reputation: "", options: "" },
    consistency: { imagery: "", naming: "", rules: "", timeline: "", travel: "" }, openQuestions: [newCampaignQuestion()],
  });
}

function normalizeCampaignBuild(stored = {}) {
  const fresh = newCampaignBuild();
  const normalized = {
    ...fresh, ...stored, length: stored.length === "one-shot" ? "short" : (stored.length ?? fresh.length),
    identity: { ...fresh.identity, ...(stored.identity ?? {}) }, problem: { ...fresh.problem, ...(stored.problem ?? {}) },
    setting: { ...fresh.setting, ...(stored.setting ?? {}) }, progression: { ...fresh.progression, ...(stored.progression ?? {}) }, consistency: { ...fresh.consistency, ...(stored.consistency ?? {}) },
    structure: (Array.isArray(stored.structure) ? stored.structure : []).map((entry) => ({ ...newCampaignStructure(), ...entry, id: entry.id || foundry.utils.randomID() })),
    locations: (Array.isArray(stored.locations) ? stored.locations : []).map((entry) => ({ ...newCampaignLocation(), ...entry, id: entry.id || foundry.utils.randomID() })),
    factions: (Array.isArray(stored.factions) ? stored.factions : []).map((entry) => ({ ...newCampaignFaction(), ...entry, id: entry.id || foundry.utils.randomID() })),
    threats: (Array.isArray(stored.threats) ? stored.threats : []).map((entry) => ({ ...newCampaignThreat(), ...entry, id: entry.id || foundry.utils.randomID() })),
    chapters: (Array.isArray(stored.chapters) ? stored.chapters : []).map((entry, index) => ({ ...newCampaignChapter(index + 1), ...entry, number: index + 1, id: entry.id || foundry.utils.randomID() })),
    rumors: (Array.isArray(stored.rumors) ? stored.rumors : []).map((entry) => ({ ...newCampaignRumor(), ...entry, id: entry.id || foundry.utils.randomID() })),
    worldEvents: (Array.isArray(stored.worldEvents) ? stored.worldEvents : []).map((entry) => ({ ...newCampaignWorldEvent(), ...entry, id: entry.id || foundry.utils.randomID() })),
    secrets: (Array.isArray(stored.secrets) ? stored.secrets : []).map((entry) => ({ ...newCampaignSecret(), ...entry, id: entry.id || foundry.utils.randomID() })),
    people: (Array.isArray(stored.people) ? stored.people : fresh.people).map((entry, index) => ({ ...newCampaignPerson(entry.slot ?? "person", entry.label ?? `Important person ${index + 1}`), ...entry, id: entry.id || foundry.utils.randomID() })),
    characters: (Array.isArray(stored.characters) && stored.characters.length ? stored.characters : fresh.characters).map((entry) => ({ ...newCampaignCharacter(), ...entry, id: entry.id || foundry.utils.randomID() })),
    openQuestions: (Array.isArray(stored.openQuestions) ? stored.openQuestions : []).map((entry) => typeof entry === "string" ? { ...newCampaignQuestion(), text: entry } : { ...newCampaignQuestion(), ...entry, id: entry.id || foundry.utils.randomID() }),
  };
  return ensureCampaignScope(normalized);
}

function campaignList(title, entries) {
  const values = entries.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  return values.length ? `<h2>${escapeHtml(title)}</h2><ul>${values.map((entry) => `<li>${sessionHtml(entry)}</li>`).join("")}</ul>` : "";
}

function legacyCampaignJournalPages(campaign) {
  ensureCampaignScope(campaign);
  const length = campaignScope(campaign);
  const targets = campaignPlanTargets(campaign);
  const overview = `${sessionBlock("Adventure summary", campaign.premise)}<p><strong>Format</strong> ${escapeHtml(length.label)}</p><p><strong>Expected length</strong> ${targets.sessions} sessions of about ${Number(campaign.sessionHours) || 4} hours</p><p><strong>Level range</strong> ${Number(campaign.startingLevel) || 1}–${Number(campaign.finalLevel) || Number(campaign.startingLevel) || 1}</p>${sessionBlock("What makes this campaign distinctive", campaign.problem.distinction)}`;
  const conflict = `${sessionBlock("What is happening now", campaign.problem.wrong)}${sessionBlock("Who or what is causing it", campaign.problem.cause)}${sessionBlock("What happens without intervention", campaign.problem.stakes)}${sessionBlock("Why the characters become involved", campaign.problem.involvement)}${sessionBlock("Possible endings", campaign.problem.resolution)}`;
  const background = `${sessionBlock("Background", campaign.background)}${sessionBlock("History that matters now", campaign.setting.history)}${sessionBlock("Cultures and communities", campaign.setting.cultures)}${sessionBlock("Magic, religion, and technology", campaign.setting.magic)}${sessionBlock("Political situation", campaign.setting.politics)}`;
  const locations = campaign.locations.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed location")}</h2>${entry.image ? `<figure><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}"></figure>` : ""}${sessionBlock("Description", entry.description)}${sessionBlock("Purpose in the adventure", entry.importance)}${sessionBlock("Secret or revelation", entry.secret)}</section>`).join("<hr>");
  const factions = campaign.factions.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed faction")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Methods", entry.methods)}${sessionBlock("Resources", entry.resources)}${sessionBlock("Relationship with the party", entry.relationship)}${sessionBlock("What happens if ignored", entry.ignored)}</section>`).join("<hr>");
  const threats = campaign.threats.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed threat")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Escalation", entry.escalation)}${sessionBlock("Consequences", entry.consequences)}</section>`).join("<hr>");
  const people = campaign.people.map((person) => `<section><h2>${escapeHtml(person.name || person.label || "Unnamed NPC")}</h2><p><em>${escapeHtml(person.label || "Important NPC")}</em></p>${sessionBlock("Description", person.description)}${sessionBlock("What they want", person.wants)}${sessionBlock("What they know", person.knows)}${sessionBlock("Secret or complication", person.secret)}</section>`).join("<hr>");
  const characters = `${sessionBlock("General character hooks", campaign.characterHooks)}${campaign.characters.map((character) => `<section><h2>${escapeHtml(character.name || "Player character")}</h2>${sessionBlock("Reason to become involved", character.involvement)}${sessionBlock("NPC or faction connection", character.npcConnection)}${sessionBlock("Personal goal", character.desire)}${sessionBlock("Party bond", character.bond)}${sessionBlock("Complication", character.complication)}${sessionBlock("Possible development", character.growth)}</section>`).join("<hr>")}`;
  const secrets = campaign.secrets.map((entry, index) => `<section><h2>Revelation ${index + 1}</h2>${sessionBlock("Truth", entry.secret)}${sessionBlock("Clues that reveal it", entry.clues)}${sessionBlock("Who already knows", entry.knownBy)}</section>`).join("<hr>");
  const structure = campaign.structure.map((entry, index) => `<section><h2>${escapeHtml(entry.name || `${length.structureSingular} ${index + 1}`)}</h2>${sessionBlock(length.structureSummaryLabel, entry.summary)}${sessionBlock(length.structureOutcomeLabel, entry.outcome)}</section>`).join("<hr>");
  const progression = `<p><strong>Leveling</strong> ${campaign.progression.leveling === "xp" ? "Experience Points" : "Milestone leveling"}</p>${sessionBlock("Important treasure", campaign.progression.treasure)}${sessionBlock("Narrative rewards", campaign.progression.narrative)}${sessionBlock("Reputation, allies, titles, or holdings", campaign.progression.reputation)}${sessionBlock("Campaign-specific character options", campaign.progression.options)}`;
  const reference = `${sessionBlock("Rules and setting conventions", campaign.consistency.rules)}${sessionBlock("Timeline", campaign.consistency.timeline)}${sessionBlock("Travel assumptions", campaign.consistency.travel)}${campaignList("Open questions", campaign.openQuestions.map((entry) => entry.text))}`;
  const pages = [
    { key: "overview", name: "1. Adventure Overview", content: overview },
    { key: "background", name: "2. Background", content: background },
    { key: "conflict", name: "3. Central Conflict", content: conflict },
    { key: "hooks", name: "4. Character Hooks", content: characters },
    { key: "factions", name: "5. Factions", content: factions },
    { key: "people", name: "6. Important NPCs", content: people },
    { key: "locations", name: "7. Important Locations", content: locations },
    { key: "secrets", name: "8. Secrets and Revelations", content: secrets },
    { key: "threats", name: "9. Threats and Conflicts", content: threats },
    { key: "structure", name: "10. Adventure Structure", content: structure },
  ];
  if (campaign.length === "open") {
    pages.push({ key: "sandbox-rumors", name: "11. Rumors and Leads", content: campaign.rumors.map((entry, index) => `<h2>Rumor ${index + 1}</h2>${sessionBlock("What people say", entry.text)}${sessionBlock("What is actually true", entry.truth)}`).join("<hr>") });
    pages.push({ key: "sandbox-events", name: "12. World Event Timeline", content: campaign.worldEvents.map((entry, index) => `<h2>Event ${index + 1}</h2>${sessionBlock("Trigger or timing", entry.trigger)}${sessionBlock("What happens", entry.event)}${sessionBlock("How the world changes", entry.consequence)}`).join("<hr>") });
  } else {
    let previousGroup = 0;
    for (const [index, chapter] of campaign.chapters.slice(0, targets.sessions).entries()) {
      const grouping = campaignChapterGrouping(campaign, index);
      if (grouping.group !== previousGroup) {
        pages.push({ key: `group-${grouping.group}`, name: grouping.groupLabel, content: `<h1>${escapeHtml(grouping.groupLabel)}</h1><p>This section contains the next part of the planned adventure. Outcomes should change later chapters rather than force the players back onto one path.</p>` });
        previousGroup = grouping.group;
      }
      const content = `${sessionBlock("Purpose", chapter.purpose)}${sessionBlock("Opening situation", chapter.opening)}${sessionBlock("Information the GM needs", chapter.information)}${sessionBlock("Locations", chapter.locations)}${sessionBlock("NPCs and factions", chapter.npcs)}${sessionBlock("Likely scenes", chapter.scenes)}${sessionBlock("Revelations and clues", chapter.revelations)}${sessionBlock("Encounters and hazards", chapter.encounters)}${sessionBlock("Rewards", chapter.rewards)}${sessionBlock("Meaningful choices", chapter.choices)}${sessionBlock("Consequences", chapter.consequences)}${sessionBlock("Transition to the next chapter", chapter.transition)}`;
      pages.push({ key: `chapter-${index + 1}`, name: `Session ${index + 1} — ${chapter.title || "Untitled Chapter"}`, content });
    }
  }
  pages.push({ key: "progression", name: "Progression and Rewards", content: progression });
  pages.push({ key: "reference", name: "GM Reference", content: reference });
  return pages;
}

function campaignJournalPages(campaign) {
  ensureCampaignMapScope(campaign);
  const map = campaignMapView(campaign);
  const positioned = campaign.locations.filter((entry) => Number.isFinite(Number(entry.x)) && Number.isFinite(Number(entry.y)));
  const byBand = (band) => positioned.filter((entry) => campaignLocationBand(campaign, entry) === band);
  const center = byBand("center")[0];
  const locationSection = (entry, fields) => `<section><h2>${escapeHtml(entry.name || "Unnamed location")}</h2><p><em>${escapeHtml(CAMPAIGN_POINT_TYPES[entry.type] ?? "Location")}</em></p>${entry.image ? `<figure><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}"></figure>` : ""}${fields.map(([label, key]) => sessionBlock(label, entry[key])).join("")}</section>`;
  const markers = positioned.map((entry) => `<span class="ls-journal-map-marker ${campaignLocationBand(campaign, entry)}" style="left:${Number(entry.x) * 100}%;top:${Number(entry.y) * 100}%" title="${escapeHtml(entry.name || "Unnamed point")}"></span>`).join("");
  const mapPage = `<div class="ls-journal-region-map"><img src="${escapeHtml(map.image)}" alt="${escapeHtml(campaign.name)} regional map"><span class="ls-journal-focus" style="left:${map.focusX * 100}%;top:${map.focusY * 100}%;width:${map.radius * 200}%;height:${map.radius * 200 * map.aspect}%"></span>${markers}</div><p><strong>Starting point:</strong> ${escapeHtml(map.startName)}</p><p>The focus circle records the region currently prepared for play. Center locations receive full detail, nearby locations are ready to visit, and distant locations remain light until the party travels toward them.</p>`;
  const overview = `${sessionBlock("Opening problem", campaign.problem.wrong)}${sessionBlock("Cause", campaign.problem.cause)}${sessionBlock("Stakes", campaign.problem.stakes)}${sessionBlock("Why the characters become involved", campaign.problem.involvement)}${sessionBlock("Sign that the problem reaches beyond the starting point", campaign.problem.distinction)}${sessionBlock("Rumor of the wider world", campaign.premise)}`;
  const centerPage = center ? locationSection(center, [["Description", "description"], ["What is happening now", "currentSituation"], ["Why the characters are here", "importance"], ["People who matter", "people"], ["Help, services, and resources", "services"], ["Immediate danger", "danger"], ["Reason to leave and explore", "reasonToLeave"], ["What happens if ignored", "ignored"]]) : "<p>No starting point has been prepared.</p>";
  const nearby = byBand("nearby").map((entry) => locationSection(entry, [[`Relationship with ${map.startName}`, "relationship"], ["Reason to travel here", "reasonToVisit"], ["Opportunity or useful resource", "opportunity"], ["Danger or mystery", "danger"], ["Lead pointing here", "lead"], ["Travel and route", "travel"]])).join("<hr>") || "<p>No nearby locations are currently inside the focus.</p>";
  const distant = byBand("distant").map((entry) => locationSection(entry, [["One-sentence identity", "description"], ["Known for", "knownFor"], ["Rumor or visible sign", "rumor"], ["Possible future use", "futureUse"]])).join("<hr>") || "<p>No distant locations are currently inside the focus.</p>";
  const nameFor = (id) => campaign.locations.find((entry) => entry.id === id)?.name || "Unnamed point";
  const routes = campaign.routes.map((route) => `<section><h2>${escapeHtml(nameFor(route.fromId))} to ${escapeHtml(nameFor(route.toId))}</h2><p><strong>Connection:</strong> ${escapeHtml(CAMPAIGN_ROUTE_TYPES[route.type] ?? "Route")}</p>${sessionBlock("Travel time", route.travel)}${sessionBlock("Memorable feature", route.feature)}${sessionBlock("Travel complication", route.complication)}</section>`).join("<hr>") || "<p>No regional connections have been prepared yet.</p>";
  const outside = campaign.locations.filter((entry) => campaignLocationBand(campaign, entry) === "outside").map((entry) => `<li>${escapeHtml(entry.name || "Unnamed point")} <em>(${escapeHtml(CAMPAIGN_POINT_TYPES[entry.type] ?? "location")})</em></li>`).join("");
  return [
    { key: "regional-map", name: "1. Regional Map", content: mapPage },
    { key: "opening-situation", name: "2. Opening Situation", content: overview },
    { key: "starting-point", name: `3. Starting Point - ${center?.name || "Unprepared"}`, content: centerPage },
    { key: "nearby-places", name: "4. Nearby Places", content: nearby },
    { key: "distant-places", name: "5. Distant Gazetteer", content: distant },
    { key: "regional-connections", name: "6. Routes and Connections", content: routes },
    { key: "outside-focus", name: "7. Beyond the Current Focus", content: outside ? `<p>These places exist on the map but deliberately require no preparation yet.</p><ul>${outside}</ul>` : "<p>No marked points lie outside the current focus.</p>" },
  ];
}

function adventureCampaignJournalPages(campaign) {
  ensureCampaignScope(campaign);
  const length = campaignScope(campaign); const targets = campaignPlanTargets(campaign);
  const pages = [
    { key: "overview", name: "1. Adventure Overview", content: `${sessionBlock("Adventure summary", campaign.premise)}<p><strong>Format</strong> ${escapeHtml(length.label)}</p><p><strong>Expected length</strong> ${targets.sessions} sessions of about ${Number(campaign.sessionHours) || 4} hours</p><p><strong>Level range</strong> ${Number(campaign.startingLevel) || 1}-${Number(campaign.finalLevel) || Number(campaign.startingLevel) || 1}</p>${sessionBlock("What makes this campaign distinctive", campaign.problem.distinction)}` },
    { key: "background", name: "2. Background", content: `${sessionBlock("Background", campaign.background)}${sessionBlock("History that matters now", campaign.setting.history)}${sessionBlock("Cultures and communities", campaign.setting.cultures)}${sessionBlock("Magic, religion, and technology", campaign.setting.magic)}${sessionBlock("Political situation", campaign.setting.politics)}` },
    { key: "conflict", name: "3. Central Conflict", content: `${sessionBlock("What is happening now", campaign.problem.wrong)}${sessionBlock("Who or what is causing it", campaign.problem.cause)}${sessionBlock("What happens without intervention", campaign.problem.stakes)}${sessionBlock("Why the characters become involved", campaign.problem.involvement)}${sessionBlock("Possible endings", campaign.problem.resolution)}` },
    { key: "factions", name: "4. Factions", content: campaign.factions.map((entry) => `<h2>${escapeHtml(entry.name || "Unnamed faction")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Methods", entry.methods)}${sessionBlock("Resources", entry.resources)}${sessionBlock("Relationship with the party", entry.relationship)}${sessionBlock("What happens if ignored", entry.ignored)}`).join("<hr>") },
    { key: "people", name: "5. Important NPCs", content: campaign.people.map((entry) => `<h2>${escapeHtml(entry.name || entry.label || "Unnamed NPC")}</h2>${sessionBlock("Description", entry.description)}${sessionBlock("What they want", entry.wants)}${sessionBlock("What they know", entry.knows)}${sessionBlock("Secret or complication", entry.secret)}`).join("<hr>") },
    { key: "locations", name: "6. Important Locations", content: campaign.locations.map((entry) => `<h2>${escapeHtml(entry.name || "Unnamed location")}</h2>${entry.image ? `<figure><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}"></figure>` : ""}${sessionBlock("Description", entry.description)}${sessionBlock("Purpose in the adventure", entry.importance)}${sessionBlock("Secret or revelation", entry.secret)}`).join("<hr>") },
    { key: "secrets", name: "7. Secrets and Revelations", content: campaign.secrets.map((entry, index) => `<h2>Revelation ${index + 1}</h2>${sessionBlock("Truth", entry.secret)}${sessionBlock("Clues that reveal it", entry.clues)}${sessionBlock("Who already knows", entry.knownBy)}`).join("<hr>") },
    { key: "threats", name: "8. Threats and Conflicts", content: campaign.threats.map((entry) => `<h2>${escapeHtml(entry.name || "Unnamed threat")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Escalation", entry.escalation)}${sessionBlock("Consequences", entry.consequences)}`).join("<hr>") },
    { key: "structure", name: "9. Adventure Structure", content: campaign.structure.map((entry, index) => `<h2>${escapeHtml(entry.name || `${length.structureSingular} ${index + 1}`)}</h2>${sessionBlock(length.structureSummaryLabel, entry.summary)}${sessionBlock(length.structureOutcomeLabel, entry.outcome)}`).join("<hr>") },
  ];
  if (campaign.length === "open") {
    pages.push({ key: "sandbox-rumors", name: "10. Rumors and Leads", content: campaign.rumors.map((entry, index) => `<h2>Rumor ${index + 1}</h2>${sessionBlock("What people say", entry.text)}${sessionBlock("What is actually true", entry.truth)}`).join("<hr>") });
    pages.push({ key: "sandbox-events", name: "11. World Event Timeline", content: campaign.worldEvents.map((entry, index) => `<h2>Event ${index + 1}</h2>${sessionBlock("Trigger or timing", entry.trigger)}${sessionBlock("What happens", entry.event)}${sessionBlock("How the world changes", entry.consequence)}`).join("<hr>") });
  } else {
    for (const [index, chapter] of campaign.chapters.slice(0, targets.sessions).entries()) pages.push({ key: `chapter-${index + 1}`, name: `Session ${index + 1} - ${chapter.title || "Untitled Chapter"}`, content: `${sessionBlock("Purpose", chapter.purpose)}${sessionBlock("Opening situation", chapter.opening)}${sessionBlock("Information the GM needs", chapter.information)}${sessionBlock("Locations", chapter.locations)}${sessionBlock("NPCs and factions", chapter.npcs)}${sessionBlock("Likely scenes", chapter.scenes)}${sessionBlock("Revelations and clues", chapter.revelations)}${sessionBlock("Encounters and hazards", chapter.encounters)}${sessionBlock("Rewards", chapter.rewards)}${sessionBlock("Meaningful choices", chapter.choices)}${sessionBlock("Consequences", chapter.consequences)}${sessionBlock("Transition to the next chapter", chapter.transition)}` });
  }
  pages.push({ key: "progression", name: "Progression and Rewards", content: `<p><strong>Leveling</strong> ${campaign.progression.leveling === "xp" ? "Experience Points" : "Milestone leveling"}</p>${sessionBlock("Important treasure", campaign.progression.treasure)}${sessionBlock("Narrative rewards", campaign.progression.narrative)}${sessionBlock("Reputation, allies, titles, or holdings", campaign.progression.reputation)}${sessionBlock("Campaign-specific character options", campaign.progression.options)}` });
  pages.push({ key: "reference", name: "GM Reference", content: `${sessionBlock("Rules and setting conventions", campaign.consistency.rules)}${sessionBlock("Timeline", campaign.consistency.timeline)}${sessionBlock("Travel assumptions", campaign.consistency.travel)}${campaignList("Open questions", campaign.openQuestions.map((entry) => entry.text))}` });
  return pages;
}

const LOOT_FILTER_MODES = {
  required: "Required", preferred: "Preferred", excluded: "Excluded",
};

const LOOT_DAMAGE_TYPES = ["acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic", "spirit", "vitality", "void"];
const LOOT_CONDITIONS = ["blinded", "clumsy", "concealed", "confused", "dazzled", "deafened", "doomed", "drained", "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "immobilized", "off-guard", "paralyzed", "persistent damage", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "wounded"];

const LOOT_MECHANICS = {
  resistance: { label: "Resistance", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "ac-bonus": { label: "AC bonus" },
  "saving-throw": { label: "Saving throw bonus", detailLabel: "Save", details: ["fortitude", "reflex", "will"] },
  healing: { label: "Healing" },
  vitality: { label: "Vitality" },
  "temporary-hp": { label: "Temporary Hit Points" },
  "condition-removal": { label: "Condition removal", detailLabel: "Condition", details: LOOT_CONDITIONS },
  counteract: { label: "Counteract or affliction protection" },
  "attack-bonus": { label: "Attack bonus" },
  "additional-damage": { label: "Additional damage", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "persistent-damage": { label: "Persistent damage", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "applies-condition": { label: "Applies a condition", detailLabel: "Condition", details: LOOT_CONDITIONS },
  "forced-movement": { label: "Forced movement" },
  "difficult-terrain": { label: "Difficult terrain" },
  "speed-bonus": { label: "Speed or movement" },
  "skill-bonus": { label: "Skill bonus" },
  perception: { label: "Perception or special senses" },
  shield: { label: "Shield, Hardness, or Shield Block" },
};

function newLootFilter() {
  return { id: foundry.utils.randomID(), mechanic: "resistance", detail: "", mode: "required" };
}

function lootPlainText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ").toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
}

function lootFilterCorpus(entry) {
  const traits = Array.isArray(entry.traits) ? entry.traits : entry.traits instanceof Set ? [...entry.traits] : [];
  const structured = lootPlainText(`${entry.documentType ?? entry.type ?? ""} ${entry.category ?? ""} ${traits.join(" ")} ${JSON.stringify(entry.rules ?? [])}`);
  const prose = lootPlainText(`${entry.name ?? ""} ${entry.description ?? ""}`);
  return { structured, prose, combined: `${structured} ${prose}`.trim() };
}

function lootMechanicPatterns(mechanic) {
  return {
    resistance: ["resistance", "resistant"],
    "ac-bonus": ["selector ac", "armor class", "bonus to ac", "bonus to your ac", " ac by"],
    "saving-throw": ["saving throw", "fortitude", "reflex", "will save", "saves against"],
    healing: ["healing", "restore hit points", "restores hit points", "regain hit points", "regains hit points", "recover hit points"],
    vitality: ["vitality"],
    "temporary-hp": ["temporary hit points", "temporary hp"],
    "condition-removal": ["remove the condition", "reduces the value", "reduce the value", "recover from", "end the condition", "counteract"],
    counteract: ["counteract", "antidote", "antiplague", "affliction"],
    "attack-bonus": ["attack roll", "bonus to attack", "item bonus to attack", "selector attack"],
    "additional-damage": ["damage dice", "additional damage", "extra damage", "damage die", "bonus to damage", "key damagedice"],
    "persistent-damage": ["persistent damage", "persistent"],
    "applies-condition": ["becomes", "is frightened", "is clumsy", "is enfeebled", "is stupefied", "is slowed", "is stunned", "is sickened", "knocked prone", "grantitem"],
    "forced-movement": ["forced movement", "push the target", "pull the target", "shove", "moves the target"],
    "difficult-terrain": ["difficult terrain", "greater difficult terrain"],
    "speed-bonus": ["speed bonus", "land speed", "fly speed", "swim speed", "climb speed", "burrow speed", "teleport"],
    "skill-bonus": ["skill check", "item bonus to", "bonus to checks"],
    perception: ["perception", "darkvision", "low light vision", "scent", "tremorsense", "echolocation"],
    shield: ["shield", "hardness", "shield block"],
  }[mechanic] ?? [];
}

function lootFilterMatch(entry, filter, flexible = true) {
  const definition = LOOT_MECHANICS[filter.mechanic];
  if (!definition) return { matched: false, reason: "", native: false };
  const corpus = lootFilterCorpus(entry);
  const patterns = lootMechanicPatterns(filter.mechanic);
  const type = String(entry.documentType ?? "").toLowerCase();
  const nativeTypeMatch = filter.mechanic === "shield" && type === "shield";
  const structuredMatch = nativeTypeMatch || patterns.some((pattern) => corpus.structured.includes(pattern));
  const proseMatch = flexible && patterns.some((pattern) => corpus.prose.includes(pattern));
  let matched = structuredMatch || proseMatch;
  const detail = lootPlainText(filter.detail);
  if (matched && detail) {
    const detailCorpus = structuredMatch ? corpus.structured : corpus.combined;
    matched = detailCorpus.includes(detail);
  }
  const detailLabel = detail ? `: ${detail}` : "";
  return {
    matched,
    native: matched && structuredMatch,
    reason: matched ? `${structuredMatch ? "Native" : "Description"}: ${definition.label}${detailLabel}` : "",
  };
}

function applyLootFilters(entry, filters, matchMode = "all", flexible = true) {
  const evaluations = filters.map((filter) => ({ filter, ...lootFilterMatch(entry, filter, flexible) }));
  if (evaluations.some((evaluation) => evaluation.filter.mode === "excluded" && evaluation.matched)) return null;
  const required = evaluations.filter((evaluation) => evaluation.filter.mode === "required");
  const requiredPass = !required.length || (matchMode === "any" ? required.some((evaluation) => evaluation.matched) : required.every((evaluation) => evaluation.matched));
  if (!requiredPass) return null;
  const preferredMatches = evaluations.filter((evaluation) => evaluation.filter.mode === "preferred" && evaluation.matched);
  const reasons = evaluations.filter((evaluation) => evaluation.filter.mode !== "excluded" && evaluation.matched).map((evaluation) => evaluation.reason);
  return {
    filterScore: preferredMatches.length * 10 + required.filter((evaluation) => evaluation.matched).length * 2,
    reasons: [...new Set(reasons)],
  };
}

function lootFamilyKey(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(lesser|moderate|greater|major|true|minor|standard|light|heavy)\b/g, " ")
    .replace(/\+\d+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function lootItemSourceKind(entry = {}) {
  const type = String(entry.documentType ?? entry.type ?? "").toLowerCase();
  const category = String(entry.category ?? entry.system?.category ?? "").toLowerCase();
  const rawTraits = entry.traits ?? entry.system?.traits?.value ?? [];
  const traitList = rawTraits instanceof Set ? [...rawTraits] : Array.isArray(rawTraits) ? rawTraits : rawTraits ? [rawTraits] : [];
  const traits = new Set(traitList.map((trait) => String(trait).toLowerCase()));
  if (type === "consumable" || type === "ammo" || category === "bomb" || traits.has("consumable") || traits.has("bomb")) return "consumable";
  return "permanent";
}

function lootSourceAllowed(entry, includePermanent, includeConsumable) {
  const sourceKind = lootItemSourceKind(entry);
  return (sourceKind === "permanent" && includePermanent) || (sourceKind === "consumable" && includeConsumable);
}

async function resolveTableResultDocument(result) {
  const uuid = result.documentUuid || (result.documentCollection && result.documentId
    ? (game.packs.get(result.documentCollection) ? `Compendium.${result.documentCollection}.${result.documentId}` : `${result.documentCollection}.${result.documentId}`)
    : "");
  try { return uuid ? await fromUuid(uuid) : null; } catch { return null; }
}

async function installedTreasureTables(kind, level) {
  const aliases = { permanent: ["permanent"], consumable: ["consumable"], gems: ["gem", "precious stone"], art: ["art object"] }[kind] ?? [];
  const matches = (name) => {
    const text = String(name ?? "").toLowerCase();
    const kindMatch = aliases.some((alias) => text.includes(alias));
    return kindMatch && (["gems", "art"].includes(kind) || new RegExp(`(^|\\D)${level}(\\D|$)`).test(text));
  };
  const tables = game.tables.contents.filter((table) => matches(table.name));
  for (const pack of game.packs.filter((candidate) => candidate.documentName === "RollTable")) {
    const index = await pack.getIndex({ fields: ["name"] });
    for (const entry of index.filter((candidate) => matches(candidate.name))) {
      const table = await pack.getDocument(entry._id);
      if (table) tables.push(table);
    }
  }
  return tables;
}

async function rollTreasureTable(kind, level) {
  const tables = await installedTreasureTables(kind, level);
  if (!tables.length) return null;
  const table = tables[Math.floor(Math.random() * tables.length)];
  const draw = await table.roll({ recursive: true });
  const result = draw?.results?.[0];
  if (!result) return null;
  const document = await resolveTableResultDocument(result);
  if (document?.documentName === "Item") return { document, table: table.name };
  return { text: result.text || result.name || "Treasure result", img: result.img || "icons/commodities/gems/gem-faceted-round-white.webp", table: table.name };
}

async function collectFilteredLoot(minLevel, maxLevel, { includePermanent, includeConsumable, rarities, filters, matchMode, flexible }) {
  const supportedTypes = new Set(["armor", "shield", "weapon", "equipment", "backpack", "kit", "book", "treasure", "consumable", "ammo"]);
  const entries = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["name", "img", "type", "system.level.value", "system.description.value", "system.traits.value", "system.traits.rarity", "system.category", "system.rules"] });
    for (const entry of index) {
      if (!supportedTypes.has(entry.type)) continue;
      const itemLevel = numeric(entry.system?.level, 0);
      if (itemLevel < minLevel || itemLevel > maxLevel) continue;
      const candidate = {
        name: entry.name, img: entry.img, type: ITEM_TYPE_LABELS[entry.type] ?? entry.type, level: itemLevel,
        description: entry.system?.description?.value ?? "", traits: entry.system?.traits?.value ?? [],
        rarity: String(entry.system?.traits?.rarity ?? "common").toLowerCase(), category: entry.system?.category ?? "", rules: entry.system?.rules ?? [],
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${entry._id}`, source: pack.metadata.label, documentType: entry.type,
      };
      if (!lootSourceAllowed(candidate, includePermanent, includeConsumable)) continue;
      if (!rarities[candidate.rarity]) continue;
      const filterResult = applyLootFilters(candidate, filters, matchMode, flexible);
      if (!filterResult) continue;
      candidate.filterScore = filterResult.filterScore;
      candidate.matchReasons = filterResult.reasons;
      entries.push(candidate);
    }
  }
  const roleMatches = entries.sort((left, right) => right.filterScore - left.filterScore || Math.random() - 0.5);
  const unique = new Map();
  for (const entry of roleMatches) {
    const key = lootFamilyKey(entry.name);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function activeSessionMusicCues(prep) {
  return (prep.musicCues ?? []).filter((cue) => [cue.name, cue.mood, cue.playlistId, cue.audio, cue.notes].some((value) => String(value ?? "").trim()));
}

async function getOrCreateSessionPlaylist(prep) {
  const title = String(prep.title ?? "").trim() || "Next Session";
  const name = `${title} — Music`;
  const existing = game.playlists.find((playlist) => playlist.name === name);
  if (existing) return existing;
  return Playlist.create({
    name,
    flags: { [FLAG_SCOPE]: { sessionMusic: true, sessionTitle: title } },
  });
}

async function ensureSessionPlaylistAvailable(prep) {
  if (game.playlists.size) return null;
  const playlist = await getOrCreateSessionPlaylist(prep);
  for (const cue of prep.musicCues ?? []) if (!cue.playlistId) cue.playlistId = playlist.id;
  return playlist;
}

async function materializeSessionMusic(prep) {
  const cues = activeSessionMusicCues(prep);
  let defaultPlaylist = null;
  if (!game.playlists.size || cues.some((cue) => !game.playlists.get(cue.playlistId))) {
    defaultPlaylist = await getOrCreateSessionPlaylist(prep);
  }
  for (const cue of cues) {
    const playlist = game.playlists.get(cue.playlistId) ?? defaultPlaylist;
    if (!playlist) continue;
    cue.playlistId = playlist.id;
    if (cue.soundId && playlist.sounds.get(cue.soundId)) continue;
    const audio = String(cue.audio ?? "").trim();
    if (!audio) continue;
    const existing = playlist.sounds.find((sound) => sound.path === audio);
    if (existing) { cue.soundId = existing.id; continue; }
    const [created] = await playlist.createEmbeddedDocuments("PlaylistSound", [{
      name: cue.name.trim() || `${cue.moment || "Music"} cue`,
      path: audio,
    }]);
    cue.soundId = created?.id ?? "";
  }
  return defaultPlaylist;
}

function sessionMusicPage(prep) {
  const cues = activeSessionMusicCues(prep);
  if (!cues.length) return "<p>Add music, ambience, and moments of deliberate silence here.</p>";
  return cues.map((cue, index) => {
    const playlist = game.playlists.get(cue.playlistId);
    const sound = playlist?.sounds?.get(cue.soundId);
    const title = cue.name.trim() || `${cue.moment || "Music"} cue ${index + 1}`;
    const source = playlist && sound
      ? `<p><strong>Song</strong> ${escapeHtml(sound.name)} <button type="button" class="ls-play-session-track" data-playlist-id="${playlist.id}" data-sound-id="${sound.id}"><i class="fa-solid fa-play"></i> Play this song</button></p><p><strong>Playlist</strong> @UUID[${playlist.uuid}]{${escapeHtml(playlist.name)}}</p>`
      : playlist
        ? `<p><strong>Foundry Playlist</strong> @UUID[${playlist.uuid}]{${escapeHtml(playlist.name)}}</p><p><em>Choose a specific song in Session Prep before creating the Journal.</em></p>`
      : (cue.audio ? `<p><strong>Audio file</strong> ${escapeHtml(cue.audio)}</p><audio controls src="${escapeHtml(cue.audio)}"></audio>` : "");
    return `<section><p><strong>${escapeHtml(title)}</strong></p>${sessionBlock("When to play", cue.moment)}${sessionBlock("Mood and purpose", cue.mood)}${source}${sessionBlock("Cue notes", cue.notes)}</section>`;
  }).join("<hr>");
}

function sessionJournalPages(prep) {
  const placeNames = prep.locations.map((location, index) => location.name.trim() || `Important Place ${index + 1}`);
  const npcs = (prep.npcs ?? []).filter((npc) => [npc.name, npc.image, npc.role, npc.motivation, npc.secret].some((value) => String(value ?? "").trim()));
  const npcNames = npcs.map((npc, index) => npc.name.trim() || `Important NPC ${index + 1}`);
  const overview = [
    sessionBlock("Main goal", prep.goal), sessionBlock("Opening situation", prep.opening), sessionBlock("Likely ending or cliffhanger", prep.ending),
    `<hr><p><strong>Important places</strong></p><ul>${placeNames.map((name) => `<li>Place — ${escapeHtml(name)}</li>`).join("")}</ul>`,
    "<p><em>See each place page for its description and table-ready details.</em></p>",
  ].filter(Boolean).join("");
  const pages = [{ name: "Session Overview", content: overview }];
  for (const [index, location] of prep.locations.entries()) pages.push({ name: `Place — ${placeNames[index]}`, content: sessionLocationPage({ ...location, name: placeNames[index] }) });
  const peopleRows = (prep.peopleEntries ?? []).filter((entry) => entry.name?.trim() || entry.description?.trim())
    .map((entry) => `<li><strong>${sessionHtml(entry.name || "Unnamed person or faction")}</strong>${entry.description ? ` — ${sessionHtml(entry.description)}` : ""}</li>`).join("");
  const hazardRows = (prep.hazards ?? []).map((entry) => `<li>${sessionReferenceLink(entry)}</li>`).join("");
  const encounterRows = (prep.encounterEntries ?? []).filter((entry) => entry.description?.trim() || entry.actors?.length).map((entry) => {
    const actors = (entry.actors ?? []).map(sessionReferenceLink).join(", ");
    return `<li><strong>${entry.type === "combat" ? "Combat encounter" : "Social encounter"}</strong>${actors ? ` — ${actors}` : ""}${entry.description ? `<br>${sessionHtml(entry.description)}` : ""}</li>`;
  }).join("");
  const peopleOverview = [
    npcNames.length ? `<p><strong>Important NPCs</strong></p><ul>${npcNames.map((name) => `<li>NPC - ${escapeHtml(name)}</li>`).join("")}</ul>` : "",
    peopleRows ? `<p><strong>Other people and factions</strong></p><ul>${peopleRows}</ul>` : "",
    hazardRows ? `<p><strong>Hazards</strong></p><ul>${hazardRows}</ul>` : "",
    encounterRows ? `<p><strong>Encounters</strong></p><ul>${encounterRows}</ul>` : "",
  ].filter(Boolean).join("") || "<p>Who can help, hinder, or surprise the party?</p>";
  pages.push({ name: "People, Hazards & Encounters", content: peopleOverview });
  for (const [index, npc] of npcs.entries()) pages.push({ name: `NPC - ${npcNames[index]}`, content: sessionNpcPage({ ...npc, name: npcNames[index] }) });
  pages.push({ name: "Music & Atmosphere", content: sessionMusicPage(prep) });
  const rewardRows = (prep.rewardItems ?? []).map((entry) => sessionReferenceLink(entry));
  pages.push(
    { name: "Scenes, Clues & Rewards", content: `${sessionList("Likely scenes", (prep.sceneEntries ?? []).map((entry) => entry.text))}${sessionList("Clues", (prep.clueEntries ?? []).map((entry) => entry.text))}${sessionList("Rewards", rewardRows)}${sessionList("Consequences", (prep.consequenceEntries ?? []).map((entry) => entry.text))}${sessionList("Changes", (prep.changeEntries ?? []).map((entry) => entry.text))}` || "<p>Prepare situations, clues, and consequences here.</p>" },
    { name: "GM Reminders & Secrets", content: sessionBlock("GM-only notes", prep.reminders) || "<p>Private reminders, secrets, and contingencies.</p>" },
  );
  return pages;
}

const SESSION_PREP_SECTION_LABELS = new Set([
  "Main goal", "Opening situation", "Likely ending or cliffhanger", "Important places",
  "Why this place matters", "Five senses", "Important NPCs", "NPCs and factions",
  "Other people and factions", "Opposition, hazards, and encounters", "Role in the session",
  "Motivation", "Secret or complication", "Likely scenes and clues",
  "Rewards, consequences, and changes", "GM-only notes",
]);

function cleanSessionPrepHeadings(content) {
  return String(content ?? "").replace(/<h2>([^<]+)<\/h2>/gi, (match, rawLabel) => {
    const label = String(rawLabel).trim();
    if (!SESSION_PREP_SECTION_LABELS.has(label)) return match;
    const cleanLabel = label === "Five senses" ? "Description" : label;
    return `<p><strong>${cleanLabel}</strong></p>`;
  }).replace(/\[\[([^\]\r\n]{1,200})\]\]/g, "$1");
}

async function migrateSessionPrepJournals() {
  if (!game.user.isGM) return;
  for (const journal of game.journal.contents.filter((entry) => entry.getFlag(FLAG_SCOPE, "sessionPrep"))) {
    if (Number(journal.getFlag(FLAG_SCOPE, "sessionPrepVersion") ?? 0) >= 3) continue;
    const updates = [];
    for (const page of journal.pages.contents.filter((entry) => entry.type === "text")) {
      const content = cleanSessionPrepHeadings(page.text?.content);
      if (content !== page.text?.content) updates.push({ _id: page.id, "text.content": content });
    }
    if (updates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
    await journal.setFlag(FLAG_SCOPE, "sessionPrepVersion", 3);
  }
}

class LoreSmithDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-dashboard",
    classes: ["lore-smith-app"],
    tag: "section",
    position: { width: 1120, height: 760 },
    window: { title: "Lore Smith", icon: "fa-solid fa-book-sparkles", resizable: true },
    actions: {
      dashboardTab: LoreSmithDashboard.changeTab,
      newSessionPrep: LoreSmithDashboard.newSessionPrep,
      previousSessionStep: LoreSmithDashboard.previousSessionStep,
      nextSessionStep: LoreSmithDashboard.nextSessionStep,
      goToSessionStep: LoreSmithDashboard.goToSessionStep,
      addLocation: LoreSmithDashboard.addLocation,
      removeLocation: LoreSmithDashboard.removeLocation,
      browseLocationImage: LoreSmithDashboard.browseLocationImage,
      addSessionNpc: LoreSmithDashboard.addSessionNpc,
      removeSessionNpc: LoreSmithDashboard.removeSessionNpc,
      browseSessionNpcImage: LoreSmithDashboard.browseSessionNpcImage,
      addMusicCue: LoreSmithDashboard.addMusicCue,
      removeMusicCue: LoreSmithDashboard.removeMusicCue,
      browseMusicAudio: LoreSmithDashboard.browseMusicAudio,
      addPeopleEntry: LoreSmithDashboard.addPeopleEntry,
      removePeopleEntry: LoreSmithDashboard.removePeopleEntry,
      addSessionEncounter: LoreSmithDashboard.addSessionEncounter,
      removeSessionEncounter: LoreSmithDashboard.removeSessionEncounter,
      addSessionTextEntry: LoreSmithDashboard.addSessionTextEntry,
      removeSessionTextEntry: LoreSmithDashboard.removeSessionTextEntry,
      removeSessionReference: LoreSmithDashboard.removeSessionReference,
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
      generateLoot: LoreSmithDashboard.generateLoot,
      addLootFilter: LoreSmithDashboard.addLootFilter,
      removeLootFilter: LoreSmithDashboard.removeLootFilter,
      clearLoot: LoreSmithDashboard.clearLoot,
      addLootToRewards: LoreSmithDashboard.addLootToRewards,
      openLootDocument: LoreSmithDashboard.openLootDocument,
      newCampaignBuild: LoreSmithDashboard.newCampaignBuild,
      previousCampaignStep: LoreSmithDashboard.previousCampaignStep,
      nextCampaignStep: LoreSmithDashboard.nextCampaignStep,
      goToCampaignStep: LoreSmithDashboard.goToCampaignStep,
      browseCampaignMap: LoreSmithDashboard.browseCampaignMap,
      activateCampaignMapTool: LoreSmithDashboard.activateCampaignMapTool,
      cancelCampaignMapTool: LoreSmithDashboard.cancelCampaignMapTool,
      resetCampaignMapView: LoreSmithDashboard.resetCampaignMapView,
      selectCampaignMarker: LoreSmithDashboard.selectCampaignMarker,
      removeCampaignMarker: LoreSmithDashboard.removeCampaignMarker,
      browseCampaignLocationImage: LoreSmithDashboard.browseCampaignLocationImage,
      addCampaignEntry: LoreSmithDashboard.addCampaignEntry,
      removeCampaignEntry: LoreSmithDashboard.removeCampaignEntry,
      addCampaignCharacter: LoreSmithDashboard.addCampaignCharacter,
      removeCampaignCharacter: LoreSmithDashboard.removeCampaignCharacter,
      createCampaignJournal: LoreSmithDashboard.createCampaignJournal,
      openCampaignJournal: LoreSmithDashboard.openCampaignJournal,
    },
  };

  static PARTS = {
    dashboard: { template: `modules/${MODULE_ID}/templates/dashboard.hbs` },
  };

  activeTab = "campaign";
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
  sessionDraftLoaded = false;
  sessionSaveTimer = null;
  lastSessionJournalId = null;
  sessionScrollTop = 0;
  lootResults = [];
  lootStatus = "";
  lootMinLevel = 1;
  lootMaxLevel = 1;
  lootCount = 6;
  lootSources = { permanent: true, consumable: true, gems: false, art: false };
  lootRarities = { common: true, uncommon: true, rare: false, unique: false };
  lootFilters = [];
  lootMatchMode = "all";
  lootFlexible = true;
  campaignStep = 0;
  campaign = newCampaignBuild();
  adventureCampaign = this.campaign;
  mapCampaign = newCampaignMapBuild();
  adventureCampaignStep = 0;
  mapCampaignStep = 0;
  campaignDraftLoaded = false;
  campaignSaveTimer = null;
  campaignSavePromise = Promise.resolve();
  campaignSaveRevision = 0;
  campaignDeletedLocationIds = new Set();
  campaignScrollTop = 0;
  campaignMapTool = "";

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
    if (!this.sessionDraftLoaded) {
      this.sessionDraftLoaded = true;
      try {
        const rawDraft = game.settings.get(MODULE_ID, "sessionPrepDraft");
        const stored = rawDraft ? JSON.parse(rawDraft) : null;
        const storedPrep = stored?.prep ?? stored;
        if (storedPrep && typeof storedPrep === "object") {
          const fresh = newSessionPrep();
          const storedLocations = Array.isArray(storedPrep.locations) ? storedPrep.locations : [];
          this.sessionPrep = {
            ...fresh,
            ...storedPrep,
            locations: storedLocations.length
              ? storedLocations.map((location) => ({ ...newSessionLocation(), ...location, id: location.id || foundry.utils.randomID() }))
              : fresh.locations,
            npcs: Array.isArray(storedPrep.npcs)
              ? storedPrep.npcs.map((npc) => ({ ...newSessionNpc(), ...npc, id: npc.id || foundry.utils.randomID() }))
              : fresh.npcs,
            musicCues: Array.isArray(storedPrep.musicCues)
              ? storedPrep.musicCues.map((cue) => ({ ...newSessionMusicCue(), ...cue, id: cue.id || foundry.utils.randomID() }))
              : fresh.musicCues,
            peopleEntries: Array.isArray(storedPrep.peopleEntries)
              ? storedPrep.peopleEntries.map((entry) => ({ ...newSessionPeopleEntry(), ...entry, id: entry.id || foundry.utils.randomID() }))
              : [newSessionPeopleEntry(storedPrep.people ?? "")],
            hazards: Array.isArray(storedPrep.hazards) ? storedPrep.hazards.map(normalizeSessionReference) : [],
            encounterEntries: Array.isArray(storedPrep.encounterEntries)
              ? storedPrep.encounterEntries.map((entry) => ({ ...newSessionEncounter(), ...entry, id: entry.id || foundry.utils.randomID(), actors: (entry.actors ?? []).map(normalizeSessionReference) }))
              : [newSessionEncounter()],
            sceneEntries: normalizeSessionTextEntries(storedPrep.sceneEntries, storedPrep.scenes ?? ""),
            clueEntries: normalizeSessionTextEntries(storedPrep.clueEntries),
            rewardItems: Array.isArray(storedPrep.rewardItems) ? storedPrep.rewardItems.map(normalizeSessionReference) : [],
            consequenceEntries: normalizeSessionTextEntries(storedPrep.consequenceEntries, storedPrep.rewards ?? ""),
            changeEntries: normalizeSessionTextEntries(storedPrep.changeEntries),
          };
          this.sessionStep = Math.max(0, Math.min(5, Number(stored?.step) || 0));
        }
      } catch (error) {
        console.warn("Lore Smith | Could not restore the Session Prep draft.", error);
      }
    }
    if (!this.campaignDraftLoaded) {
      this.campaignDraftLoaded = true;
      try {
        const rawDraft = game.settings.get(MODULE_ID, "campaignBuilderDraft");
        const stored = rawDraft ? JSON.parse(rawDraft) : null;
        const rawWorldMapDraft = game.settings.get(MODULE_ID, "campaignMapBuilderWorldDraft");
        const rawClientMapDraft = game.settings.get(MODULE_ID, "campaignMapBuilderDraft");
        const worldMapDraft = parseStoredDraft(rawWorldMapDraft, "world");
        const clientMapDraft = parseStoredDraft(rawClientMapDraft, "Foundry browser");
        const recoveryMapDraft = readCampaignMapRecovery();
        const storedMap = [
          { draft: worldMapDraft, priority: 0 },
          { draft: clientMapDraft, priority: 1 },
          { draft: recoveryMapDraft, priority: 2 },
        ].filter(({ draft }) => draft?.campaign || draft?.name).sort((left, right) =>
          (Number(left.draft.updatedAt) || 0) - (Number(right.draft.updatedAt) || 0)
          || (Number(left.draft.revision) || 0) - (Number(right.draft.revision) || 0)
          || left.priority - right.priority
        ).at(-1)?.draft ?? null;
        if (stored?.campaign || stored?.name) {
          this.adventureCampaign = normalizeCampaignBuild(stored.campaign ?? stored);
          this.adventureCampaignStep = Math.max(0, Math.min(7, Number(stored.step) || 0));
        }
        if (storedMap?.campaign || storedMap?.name) {
          this.mapCampaign = normalizeCampaignMapBuild(storedMap.campaign ?? storedMap);
          this.mapCampaignStep = Math.max(0, Math.min(7, Number(storedMap.step) || 0));
          this.campaignSaveRevision = Math.max(Number(storedMap.revision) || 0, Number(worldMapDraft?.revision) || 0, Number(clientMapDraft?.revision) || 0, Number(recoveryMapDraft?.revision) || 0);
        } else if (stored?.campaign?.map || stored?.map) {
          this.mapCampaign = normalizeCampaignMapBuild(stored.campaign ?? stored);
          this.mapCampaignStep = Math.max(0, Math.min(7, Number(stored.step) || 0));
        }
        this.campaign = this.activeTab === "campaignMap" ? this.mapCampaign : this.adventureCampaign;
        this.campaignStep = this.activeTab === "campaignMap" ? this.mapCampaignStep : this.adventureCampaignStep;
      } catch (error) {
        console.warn("Lore Smith | Could not restore the Campaign Builder draft.", error);
      }
    }
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
    const locationViews = this.sessionPrep.locations.map((location, index) => ({ ...location, number: index + 1, canRemove: this.sessionPrep.locations.length > 2 }));
    const npcViews = (this.sessionPrep.npcs ?? []).map((npc, index) => ({ ...npc, number: index + 1 }));
    const playlists = [...game.playlists.contents].sort((left, right) => left.name.localeCompare(right.name));
    const musicCueViews = (this.sessionPrep.musicCues ?? []).map((cue, index) => ({
      ...cue,
      number: index + 1,
      momentOptions: SESSION_MUSIC_MOMENTS.map((moment) => ({ value: moment, label: moment, selected: cue.moment === moment })),
      playlistOptions: [
        { value: "", label: "No Foundry Playlist", selected: !cue.playlistId },
        ...playlists.map((playlist) => ({ value: playlist.id, label: playlist.name, selected: cue.playlistId === playlist.id })),
      ],
      trackOptions: [
        { value: "", label: cue.playlistId ? "Choose a song from this Playlist" : "Choose a Playlist first", selected: !cue.soundId },
        ...(game.playlists.get(cue.playlistId)?.sounds?.contents ?? []).map((sound) => ({ value: sound.id, label: sound.name, selected: cue.soundId === sound.id })),
      ],
    }));
    const sessionValidation = [];
    if (!this.sessionPrep.title.trim()) sessionValidation.push("Add a session title.");
    if (!this.sessionPrep.goal.trim()) sessionValidation.push("Add the session's main goal.");
    if (this.sessionPrep.locations.length < 2) sessionValidation.push("Prepare at least two important places.");
    for (const [index, location] of this.sessionPrep.locations.entries()) {
      if (!location.name.trim()) sessionValidation.push(`Name important place ${index + 1}.`);
      if (!location.image.trim()) sessionValidation.push(`Choose an image for important place ${index + 1}.`);
    }
    const sessionStepEntries = [["goal", "Goal"], ["locations", "Places"], ["people", "People"], ["music", "Music"], ["scenes", "Scenes"], ["review", "Review"]];
    const sessionSteps = Object.fromEntries(sessionStepEntries.map(([key, label], index) => [key, { index, number: index + 1, label, active: this.sessionStep === index }]));
    const mapBuilderActive = this.activeTab === "campaignMap";
    if (mapBuilderActive) ensureCampaignMapScope(this.campaign); else ensureCampaignScope(this.campaign);
    const campaignStepEntries = mapBuilderActive
      ? [["map", "Map"], ["focus", "Starting Area"], ["center", "Center"], ["nearby", "Nearby"], ["distant", "Distant"], ["routes", "Connections"], ["opening", "Opening"], ["review", "Review"]]
      : [["scope", "Scope"], ["conflict", "Conflict"], ["cast", "Cast"], ["locations", "Locations"], ["secrets", "Secrets"], ["structure", "Structure"], ["chapters", "Chapters"], ["review", "Review"]];
    const campaignSteps = Object.fromEntries(campaignStepEntries.map(([key, label], index) => [key, { index, number: index + 1, label, active: this.campaignStep === index }]));
    const campaignStyle = CAMPAIGN_STYLES[this.campaign.style] ?? CAMPAIGN_STYLES.adventure;
    const campaignLength = CAMPAIGN_LENGTHS[this.campaign.length] ?? CAMPAIGN_LENGTHS.short;
    const campaignTargets = campaignPlanTargets(this.campaign);
    const campaignPeople = this.campaign.people.map((person, index) => ({ ...person, number: index + 1, suggestion: campaignStyle.people[index % campaignStyle.people.length] ?? "" }));
    let previousChapterGroup = 0;
    const campaignChapters = this.campaign.chapters.slice(0, campaignTargets.sessions).map((chapter, index) => {
      const grouping = campaignChapterGrouping(this.campaign, index);
      const firstInGroup = grouping.group !== previousChapterGroup;
      previousChapterGroup = grouping.group;
      return { ...chapter, ...grouping, firstInGroup, number: index + 1 };
    });
    const campaignMap = mapBuilderActive ? campaignMapView(this.campaign) : campaignMapView({ locations: [], map: {} });
    const startOptions = [{ value: "", label: "Choose the starting point", selected: !campaignMap.startLocationId }, ...this.campaign.locations.map((location) => ({ value: location.id, label: location.name || "Unnamed point", selected: location.id === campaignMap.startLocationId }))];
    const markerViews = this.campaign.locations.map((location, index) => {
      const band = campaignLocationBand(this.campaign, location);
      const distance = campaignMarkerDistance(this.campaign, location);
      return {
        ...location, number: index + 1, band, guidance: campaignLocationGuidance(location, band),
        positioned: Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.y)),
        left: `${(Number(location.x) || 0) * 100}%`, top: `${(Number(location.y) || 0) * 100}%`,
        distancePercent: distance === null ? "" : Math.round(distance * 100), isCenter: band === "center",
        isNearby: band === "nearby", isDistant: band === "distant", isOutside: band === "outside",
        icon: CAMPAIGN_POINT_ICONS[location.type] ?? CAMPAIGN_POINT_ICONS.custom,
        typeOptions: Object.entries(CAMPAIGN_POINT_TYPES).map(([value, label]) => ({ value, label, selected: value === location.type })),
      };
    });
    const markerByBand = (band) => markerViews.filter((entry) => entry.band === band);
    const locationOptions = [{ value: "", label: "Choose a point", selected: false }, ...this.campaign.locations.map((location) => ({ value: location.id, label: location.name || "Unnamed point" }))];
    const campaignRoutes = (this.campaign.routes ?? []).map((route, index) => ({
      ...route, number: index + 1,
      fromOptions: locationOptions.map((option) => ({ ...option, selected: option.value === route.fromId })),
      toOptions: locationOptions.map((option) => ({ ...option, selected: option.value === route.toId })),
      typeOptions: Object.entries(CAMPAIGN_ROUTE_TYPES).map(([value, label]) => ({ value, label, selected: value === route.type })),
    }));
    const campaignValidation = [];
    if (!this.campaign.name.trim()) campaignValidation.push("Name the campaign.");
    if (mapBuilderActive) {
      if (!campaignMap.image) campaignValidation.push("Upload a regional map.");
      if (!campaignMap.startLocationId) campaignValidation.push("Choose a starting point.");
      if (!this.campaign.problem.wrong.trim()) campaignValidation.push("Describe the opening problem.");
    } else {
      if (!this.campaign.problem.wrong.trim()) campaignValidation.push("Describe what is happening now.");
      if (!this.campaign.problem.cause.trim()) campaignValidation.push("Describe who or what is causing the problem.");
      if (!this.campaign.problem.stakes.trim()) campaignValidation.push("Describe what happens without intervention.");
      if (!this.campaign.locations.some((entry) => entry.name.trim())) campaignValidation.push("Name at least one important location.");
      if (!this.campaign.factions.some((entry) => entry.name.trim())) campaignValidation.push("Name at least one faction.");
      if (!this.campaign.threats.some((entry) => entry.name.trim())) campaignValidation.push("Name at least one threat.");
    }
    const campaignRecommendations = [];
    const namedCount = (entries) => entries.filter((entry) => entry.name.trim()).length;
    if (mapBuilderActive && !markerViews.some((entry) => entry.isNearby)) campaignRecommendations.push("Place at least one nearby point to give the players an immediate direction beyond the starting location.");
    if (mapBuilderActive && !markerViews.some((entry) => entry.isDistant)) campaignRecommendations.push("Include one distant point inside the focus circle to suggest a wider region without preparing it deeply.");
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
      sessionPrep: { ...this.sessionPrep, locations: locationViews, npcs: npcViews, musicCues: musicCueViews },
      sessionSteps,
      sessionValidation,
      canSessionBack: this.sessionStep > 0,
      lastSessionJournalId: this.lastSessionJournalId,
      hasFoundryPlaylists: game.playlists.size > 0,
      peopleEntries: (this.sessionPrep.peopleEntries ?? []).map((entry, index) => ({ ...entry, number: index + 1 })),
      hazards: this.sessionPrep.hazards ?? [],
      encounterEntries: (this.sessionPrep.encounterEntries ?? []).map((entry, index) => ({ ...entry, number: index + 1, social: entry.type === "social", combat: entry.type === "combat" })),
      sceneEntries: this.sessionPrep.sceneEntries ?? [], clueEntries: this.sessionPrep.clueEntries ?? [],
      rewardItems: this.sessionPrep.rewardItems ?? [], consequenceEntries: this.sessionPrep.consequenceEntries ?? [], changeEntries: this.sessionPrep.changeEntries ?? [],
      lootResults: this.lootResults, lootStatus: this.lootStatus,
      lootMinLevel: this.lootMinLevel, lootMaxLevel: this.lootMaxLevel, lootCount: this.lootCount, lootSources: this.lootSources,
      lootRarities: this.lootRarities, lootMatchMode: this.lootMatchMode, lootFlexible: this.lootFlexible,
      lootMatchModes: [
        { value: "all", label: "Match every required filter", selected: this.lootMatchMode === "all" },
        { value: "any", label: "Match at least one required filter", selected: this.lootMatchMode === "any" },
      ],
      lootFilters: this.lootFilters.map((filter) => {
        const definition = LOOT_MECHANICS[filter.mechanic] ?? LOOT_MECHANICS.resistance;
        return {
          ...filter,
          modes: Object.entries(LOOT_FILTER_MODES).map(([value, label]) => ({ value, label, selected: filter.mode === value })),
          mechanics: Object.entries(LOOT_MECHANICS).map(([value, data]) => ({ value, label: data.label, selected: filter.mechanic === value })),
          hasDetails: Boolean(definition.details?.length), detailLabel: definition.detailLabel ?? "Detail",
          details: (definition.details ?? []).map((value) => ({ value, label: value.replace(/\b\w/g, (letter) => letter.toUpperCase()), selected: filter.detail === value })),
        };
      }),
      campaign: { ...this.campaign, people: campaignPeople },
      campaignSteps,
      campaignStyles: Object.entries(CAMPAIGN_STYLES).map(([value, data]) => ({ value, label: data.label, selected: value === this.campaign.style })),
      campaignLengths: Object.entries(CAMPAIGN_LENGTHS).map(([value, data]) => ({ value, label: data.label, selected: value === this.campaign.length })),
      campaignTones: Object.entries(CAMPAIGN_TONES).map(([value, label]) => ({ value, label, selected: value === this.campaign.tone })),
      campaignLevelingOptions: [
        { value: "milestone", label: "Milestone leveling", selected: this.campaign.progression.leveling === "milestone" },
        { value: "xp", label: "Experience Points", selected: this.campaign.progression.leveling === "xp" },
      ],
      campaignGuidance: { style: campaignStyle.guidance, scope: campaignLength.scope },
      campaignValidation, campaignRecommendations, campaignScope: campaignLength, campaignTargets,
      campaignMap, campaignMapTool: this.campaignMapTool,
      campaignMapMarkerTool: this.campaignMapTool === "marker", campaignMapFocusTool: this.campaignMapTool === "focus",
      campaignMapMarkers: markerViews,
      campaignCenterLocations: markerByBand("center"), campaignNearbyLocations: markerByBand("nearby"), campaignDistantLocations: markerByBand("distant"), campaignOutsideLocations: markerByBand("outside"),
      campaignStartOptions: startOptions, campaignRoutes,
      campaignStructured: this.campaign.length !== "open", campaignSandbox: this.campaign.length === "open", campaignChapters,
      campaignStructure: this.campaign.structure.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignLocations: this.campaign.locations.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignFactions: this.campaign.factions.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignThreats: this.campaign.threats.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignSecrets: this.campaign.secrets.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignRumors: this.campaign.rumors.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignWorldEvents: this.campaign.worldEvents.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignQuestions: this.campaign.openQuestions.map((entry, index) => ({ ...entry, number: index + 1 })),
      canCampaignBack: this.campaignStep > 0,
      campaignJournalAvailable: Boolean(game.journal.get(this.campaign.journalId)),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this._campaignMapEscape) {
      window.removeEventListener("keydown", this._campaignMapEscape);
      this._campaignMapEscape = null;
    }
    const main = this.element?.querySelector(".ls-main");
    if (main && this.sessionScrollTop) main.scrollTop = this.sessionScrollTop;
    if (main && ["campaign", "campaignMap"].includes(this.activeTab) && this.campaignScrollTop) main.scrollTop = this.campaignScrollTop;
    if (["campaign", "campaignMap"].includes(this.activeTab)) {
      for (const field of this.element?.querySelectorAll(".ls-campaign-panel input, .ls-campaign-panel textarea, .ls-campaign-panel select") ?? []) {
        const eventName = field.matches("select") ? "change" : "input";
        field.addEventListener(eventName, () => {
          void this.syncCampaignForm({ persist: false });
          clearTimeout(this.campaignSaveTimer);
          this.campaignSaveTimer = setTimeout(() => void this.syncCampaignForm(), 300);
        });
        field.addEventListener("blur", () => void this.syncCampaignForm());
      }
      for (const select of this.element?.querySelectorAll('[name="campaignLength"], [name="campaignSessionCount"], [name="campaignStartLocation"]') ?? []) {
        select.addEventListener("change", async () => {
          await this.syncCampaignForm();
          await this.renderCampaignPreservingScroll();
        });
      }
      const campaignMap = this.activeTab === "campaignMap" ? this.element?.querySelector("[data-campaign-map]") : null;
      if (campaignMap) {
        const stage = campaignMap.querySelector("[data-campaign-map-stage]");
        const image = campaignMap.querySelector("[data-campaign-map-image]");
        if (!stage || !image) return;
        let focusDrawing = false;
        let markerDrag = null;
        let panDrag = null;
        let movedMarker = false;
        const view = this.campaign.map.view;
        const applyView = () => {
          stage.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
        };
        const point = (event) => {
          const rect = image.getBoundingClientRect();
          return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
        };
        const focusAnchor = () => {
          const selected = this.campaign.locations.find((entry) => entry.id === this.campaign.map.startLocationId);
          if (!selected || !Number.isFinite(Number(selected.x)) || !Number.isFinite(Number(selected.y))) return null;
          return { x: Number(selected.x), y: Number(selected.y) };
        };
        const closePointEditor = () => campaignMap.querySelector(".ls-map-point-editor")?.remove();
        const openPointEditor = (location, marker, clientX = null, clientY = null) => {
          closePointEditor();
          const mapRect = campaignMap.getBoundingClientRect();
          const markerRect = marker.getBoundingClientRect();
          const left = Math.max(8, Math.min(mapRect.width - 230, (clientX ?? markerRect.left) - mapRect.left + 10));
          const top = Math.max(8, Math.min(mapRect.height - 250, (clientY ?? markerRect.bottom) - mapRect.top + 8));
          const editor = document.createElement("div");
          editor.className = "ls-map-point-editor";
          editor.style.left = `${left}px`; editor.style.top = `${top}px`;
          for (const eventName of ["pointerdown", "pointerup", "click", "contextmenu"]) {
            editor.addEventListener(eventName, (event) => event.stopPropagation());
          }
          const showNameEditor = () => {
            editor.innerHTML = `<strong>${CAMPAIGN_POINT_TYPES[location.type] ?? "Point"}</strong><label>Name<input type="text" value="${escapeHtml(location.name)}" placeholder="Name this place"></label><div><button type="button" data-save-name><i class="fa-solid fa-check"></i> Save</button><button type="button" data-delete-point class="danger"><i class="fa-solid fa-trash"></i></button></div>`;
            const input = editor.querySelector("input");
            input.addEventListener("input", () => {
              location.name = input.value;
              const label = marker.querySelector("span");
              if (label) label.textContent = location.name.trim() || "Unnamed point";
              this.writeCampaignRecoverySnapshot();
              clearTimeout(this.campaignSaveTimer);
              this.campaignSaveTimer = setTimeout(() => void this.saveCampaignDraft(), 200);
            });
            input.addEventListener("blur", () => void this.saveCampaignDraft());
            const save = async () => {
              location.name = input.value.trim();
              await this.saveCampaignDraft();
              await this.renderCampaignPreservingScroll();
            };
            editor.querySelector("[data-save-name]")?.addEventListener("click", () => void save());
            input.addEventListener("keydown", (event) => {
              if (event.key === "Enter") { event.preventDefault(); void save(); }
              if (event.key === "Escape") closePointEditor();
            });
            const deleteButton = editor.querySelector("[data-delete-point]");
            deleteButton?.addEventListener("pointerdown", (event) => event.preventDefault());
            deleteButton?.addEventListener("click", async () => {
              clearTimeout(this.campaignSaveTimer);
              this.campaignDeletedLocationIds.add(location.id);
              this.campaign.locations = this.campaign.locations.filter((entry) => entry.id !== location.id);
              if (this.mapCampaign !== this.campaign) this.mapCampaign.locations = this.mapCampaign.locations.filter((entry) => entry.id !== location.id);
              this.campaign.routes = this.campaign.routes.filter((entry) => entry.fromId !== location.id && entry.toId !== location.id);
              if (this.campaign.map.startLocationId === location.id) this.campaign.map.startLocationId = "";
              marker.remove();
              closePointEditor();
              this.writeCampaignRecoverySnapshot();
              await this.saveCampaignDraft(); await this.renderCampaignPreservingScroll();
            });
            input.focus(); input.select();
          };
          editor.innerHTML = `<strong>Choose point type</strong><div class="ls-map-point-types">${Object.entries(CAMPAIGN_POINT_TYPES).map(([value, label]) => `<button type="button" data-point-type="${value}"><i class="fa-solid ${CAMPAIGN_POINT_ICONS[value] ?? CAMPAIGN_POINT_ICONS.custom}"></i> ${label}</button>`).join("")}</div><button type="button" data-close-point><i class="fa-solid fa-xmark"></i> Cancel</button>`;
          campaignMap.append(editor);
          editor.querySelector("[data-close-point]")?.addEventListener("click", closePointEditor);
          for (const button of editor.querySelectorAll("[data-point-type]")) button.addEventListener("click", async () => {
            location.type = button.dataset.pointType;
            const icon = marker.querySelector("i");
            if (icon) icon.className = `fa-solid ${CAMPAIGN_POINT_ICONS[location.type] ?? CAMPAIGN_POINT_ICONS.custom}`;
            await this.saveCampaignDraft();
            showNameEditor();
          });
        };
        campaignMap.addEventListener("contextmenu", (event) => event.preventDefault());
        campaignMap.addEventListener("wheel", (event) => {
          event.preventDefault();
          const rect = campaignMap.getBoundingClientRect();
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          const oldZoom = view.zoom;
          const nextZoom = Math.max(1, Math.min(5, oldZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
          const localX = (cursorX - view.panX) / oldZoom;
          const localY = (cursorY - view.panY) / oldZoom;
          view.zoom = nextZoom;
          view.panX = cursorX - localX * nextZoom;
          view.panY = cursorY - localY * nextZoom;
          if (nextZoom === 1) { view.panX = 0; view.panY = 0; }
          applyView();
          clearTimeout(this.campaignSaveTimer);
          this.campaignSaveTimer = setTimeout(() => void this.saveCampaignDraft(), 250);
        }, { passive: false });
        campaignMap.addEventListener("pointerdown", (event) => {
          const marker = event.target.closest("[data-campaign-marker-id]");
          if (event.button === 2) {
            if (marker) {
              const location = this.campaign.locations.find((entry) => entry.id === marker.dataset.campaignMarkerId);
              if (location) openPointEditor(location, marker, event.clientX, event.clientY);
              event.preventDefault(); event.stopPropagation();
              return;
            }
            closePointEditor();
            panDrag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
            campaignMap.classList.add("panning");
            campaignMap.setPointerCapture?.(event.pointerId);
            return;
          }
          if (event.button !== 0) return;
          if (!event.target.closest(".ls-map-point-editor")) closePointEditor();
          if (marker && !this.campaignMapTool) {
            const location = this.campaign.locations.find((entry) => entry.id === marker.dataset.campaignMarkerId);
            if (!location) return;
            markerDrag = { location, startX: event.clientX, startY: event.clientY };
            movedMarker = false;
            campaignMap.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
          }
          if (marker || this.campaignMapTool !== "focus") return;
          if (!focusAnchor()) {
            ui.notifications.warn("Choose a starting point before drawing the starting area.");
            return;
          }
          focusDrawing = true;
          campaignMap.setPointerCapture?.(event.pointerId);
        });
        campaignMap.addEventListener("pointermove", (event) => {
          if (panDrag) {
            view.panX = panDrag.panX + event.clientX - panDrag.x;
            view.panY = panDrag.panY + event.clientY - panDrag.y;
            applyView();
            return;
          }
          if (markerDrag) {
            const position = point(event);
            markerDrag.location.x = position.x;
            markerDrag.location.y = position.y;
            movedMarker ||= Math.hypot(event.clientX - markerDrag.startX, event.clientY - markerDrag.startY) > 3;
            const marker = stage.querySelector(`[data-campaign-marker-id="${markerDrag.location.id}"]`);
            if (marker) { marker.style.left = `${position.x * 100}%`; marker.style.top = `${position.y * 100}%`; }
            if (this.campaign.map.startLocationId === markerDrag.location.id) {
              this.campaign.map.focus.x = position.x;
              this.campaign.map.focus.y = position.y;
              const circle = stage.querySelector(".ls-map-focus-circle");
              if (circle) { circle.style.left = `${position.x * 100}%`; circle.style.top = `${position.y * 100}%`; }
            }
            return;
          }
          if (!focusDrawing) return;
          const anchor = focusAnchor();
          if (!anchor) return;
          const current = point(event);
          const rect = image.getBoundingClientRect();
          const aspect = Math.max(0.1, rect.width / rect.height);
          const radius = Math.min(1, Math.hypot(current.x - anchor.x, (current.y - anchor.y) / aspect));
          const circle = stage.querySelector(".ls-map-focus-circle");
          if (circle) {
            circle.style.left = `${anchor.x * 100}%`; circle.style.top = `${anchor.y * 100}%`;
            circle.style.width = `${radius * 200}%`; circle.style.height = `${radius * 200 * aspect}%`;
          }
        });
        campaignMap.addEventListener("pointerup", async (event) => {
          if (event.target.closest(".ls-map-point-editor")) return;
          if (panDrag) {
            panDrag = null;
            campaignMap.classList.remove("panning");
            await this.saveCampaignDraft();
            return;
          }
          if (markerDrag) {
            const location = markerDrag.location;
            markerDrag = null;
            this._campaignMarkerWasDragged = movedMarker;
            if (!movedMarker) {
              this.campaign.map.startLocationId = location.id;
              this.campaign.map.focus.x = Number(location.x);
              this.campaign.map.focus.y = Number(location.y);
            }
            await this.saveCampaignDraft();
            await this.renderCampaignPreservingScroll();
            return;
          }
          if (focusDrawing) {
            const anchor = focusAnchor();
            focusDrawing = false;
            if (!anchor) return;
            const current = point(event);
            const rect = image.getBoundingClientRect();
            const aspect = Math.max(0.1, rect.width / rect.height);
            const radius = Math.max(0.02, Math.min(1, Math.hypot(current.x - anchor.x, (current.y - anchor.y) / aspect)));
            this.campaign.map.focus = { x: anchor.x, y: anchor.y, radius, aspect };
            this.campaignMapTool = "";
            await this.saveCampaignDraft(); await this.renderCampaignPreservingScroll();
            return;
          }
          if (event.target.closest("[data-campaign-marker-id]") || this.campaignMapTool !== "marker") return;
          const position = point(event);
          const location = { ...newCampaignLocation(), x: position.x, y: position.y };
          this.campaign.locations.push(location);
          await this.saveCampaignDraft(); await this.renderCampaignPreservingScroll();
        });
        campaignMap.addEventListener("pointercancel", () => { focusDrawing = false; markerDrag = null; panDrag = null; campaignMap.classList.remove("panning"); });
        this._campaignMapEscape = (event) => {
          if (event.key !== "Escape" || !this.campaignMapTool) return;
          this.campaignMapTool = "";
          void this.renderCampaignPreservingScroll();
        };
        window.addEventListener("keydown", this._campaignMapEscape);
      }
      return;
    }
    if (this.activeTab === "session") {
      for (const field of this.element?.querySelectorAll(".ls-session-panel input, .ls-session-panel textarea, .ls-session-panel select") ?? []) {
        const eventName = field.matches("select") ? "change" : "input";
        field.addEventListener(eventName, () => {
          clearTimeout(this.sessionSaveTimer);
          this.sessionSaveTimer = setTimeout(() => void this.syncSessionPrepForm(), 350);
        });
      }
      for (const select of this.element?.querySelectorAll('[name="musicPlaylist"], [name="encounterType"]') ?? []) {
        select.addEventListener("change", async () => {
          await this.syncSessionPrepForm();
          if (select.name === "musicPlaylist") {
            const card = select.closest("[data-session-music-id]");
            const cue = this.sessionPrep.musicCues.find((entry) => entry.id === card?.dataset.sessionMusicId);
            if (cue) cue.soundId = "";
          }
          await this.renderSessionPreservingScroll();
        });
      }
      for (const zone of this.element?.querySelectorAll("[data-session-drop-kind]") ?? []) {
        zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
        zone.addEventListener("drop", (event) => void this.handleSessionDrop(event, zone));
      }
      return;
    }
    if (this.activeTab === "loot") {
      for (const select of this.element?.querySelectorAll('[name="lootFilterMechanic"]') ?? []) {
        select.addEventListener("change", async () => {
          this.syncLootForm();
          await this.render();
        });
      }
      return;
    }
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

  async renderSessionPreservingScroll() {
    this.sessionScrollTop = this.element?.querySelector(".ls-main")?.scrollTop ?? this.sessionScrollTop;
    await this.render();
  }

  async handleSessionDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("dragover");
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch { return; }
    const uuid = data.uuid || (data.type && data.id ? `${data.type}.${data.id}` : "");
    const document = uuid ? await fromUuid(uuid) : null;
    if (!document) return ui.notifications.warn("Lore Smith could not read that dropped Foundry document.");
    const kind = zone.dataset.sessionDropKind;
    if (kind === "hazard" && (document.documentName !== "Actor" || document.type !== "hazard")) return ui.notifications.warn("Drop a PF2e Hazard actor here.");
    if (kind === "encounter" && document.documentName !== "Actor") return ui.notifications.warn("Drop a PF2e Actor here.");
    if (kind === "reward" && document.documentName !== "Item") return ui.notifications.warn("Drop a PF2e Item here.");
    const reference = normalizeSessionReference({ uuid: document.uuid, name: document.name, img: document.img, type: document.type });
    if (kind === "hazard") {
      if (!(this.sessionPrep.hazards ?? []).some((entry) => entry.uuid === reference.uuid)) this.sessionPrep.hazards.push(reference);
    } else if (kind === "reward") {
      if (!(this.sessionPrep.rewardItems ?? []).some((entry) => entry.uuid === reference.uuid)) this.sessionPrep.rewardItems.push(reference);
    } else {
      const encounter = this.sessionPrep.encounterEntries.find((entry) => entry.id === zone.dataset.parentId);
      if (encounter && !encounter.actors.some((entry) => entry.uuid === reference.uuid)) encounter.actors.push(reference);
    }
    await this.saveSessionPrepDraft();
    await this.renderSessionPreservingScroll();
  }

  async saveSessionPrepDraft() {
    await game.settings.set(MODULE_ID, "sessionPrepDraft", JSON.stringify({ step: this.sessionStep, prep: this.sessionPrep }));
  }

  async syncSessionPrepForm() {
    const root = this.element;
    if (!root || this.activeTab !== "session") return;
    const visibleFields = {
      title: "sessionTitle", goal: "sessionGoal", opening: "sessionOpening", ending: "sessionEnding",
      reminders: "sessionReminders",
    };
    for (const [property, name] of Object.entries(visibleFields)) {
      const field = root.querySelector(`[name="${name}"]`);
      if (field) this.sessionPrep[property] = field.value.trim();
    }
    const previous = new Map(this.sessionPrep.locations.map((location) => [location.id, location]));
    const cards = [...root.querySelectorAll("[data-location-id]")];
    if (cards.length) this.sessionPrep.locations = cards.map((card) => {
      const id = card.dataset.locationId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previous.get(id), id, name: field("locationName"), image: field("locationImage"), purpose: field("locationPurpose"), sight: field("locationSight"), hearing: field("locationHearing"), smell: field("locationSmell"), touch: field("locationTouch"), taste: field("locationTaste") };
    });
    const previousNpcs = new Map((this.sessionPrep.npcs ?? []).map((npc) => [npc.id, npc]));
    const npcCards = [...root.querySelectorAll("[data-session-npc-id]")];
    if (npcCards.length) this.sessionPrep.npcs = npcCards.map((card) => {
      const id = card.dataset.sessionNpcId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previousNpcs.get(id), id, name: field("npcName"), image: field("npcImage"), role: field("npcRole"), motivation: field("npcMotivation"), secret: field("npcSecret") };
    });
    const previousMusicCues = new Map((this.sessionPrep.musicCues ?? []).map((cue) => [cue.id, cue]));
    const musicCards = [...root.querySelectorAll("[data-session-music-id]")];
    if (musicCards.length) this.sessionPrep.musicCues = musicCards.map((card) => {
      const id = card.dataset.sessionMusicId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previousMusicCues.get(id), id, name: field("musicName"), moment: field("musicMoment"), mood: field("musicMood"), playlistId: field("musicPlaylist"), soundId: field("musicSound"), audio: field("musicAudio"), notes: field("musicNotes") };
    });
    const peopleCards = [...root.querySelectorAll("[data-people-entry-id]")];
    if (peopleCards.length) this.sessionPrep.peopleEntries = peopleCards.map((card) => ({
      id: card.dataset.peopleEntryId,
      name: card.querySelector('[name="peopleName"]')?.value.trim() ?? "",
      description: card.querySelector('[name="peopleDescription"]')?.value.trim() ?? "",
    }));
    const encounterCards = [...root.querySelectorAll("[data-session-encounter-id]")];
    if (encounterCards.length) {
      const existing = new Map(this.sessionPrep.encounterEntries.map((entry) => [entry.id, entry]));
      this.sessionPrep.encounterEntries = encounterCards.map((card) => ({
        ...existing.get(card.dataset.sessionEncounterId), id: card.dataset.sessionEncounterId,
        type: card.querySelector('[name="encounterType"]')?.value ?? "social",
        description: card.querySelector('[name="encounterDescription"]')?.value.trim() ?? "",
      }));
    }
    const textCollections = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" };
    for (const [kind, property] of Object.entries(textCollections)) {
      const entries = [...root.querySelectorAll(`[data-session-text-kind="${kind}"]`)].map((card) => ({
        id: card.dataset.sessionTextId, text: card.querySelector("input, textarea")?.value.trim() ?? "",
      }));
      if (entries.length) this.sessionPrep[property] = entries;
    }
    await this.saveSessionPrepDraft();
  }

  async close(options = {}) {
    clearTimeout(this.campaignSaveTimer);
    if (["campaign", "campaignMap"].includes(this.activeTab)) await this.syncCampaignForm();
    await this.campaignSavePromise;
    return super.close(options);
  }

  async saveCampaignDraft() {
    if (this.activeTab === "campaignMap") {
      if (this.campaignDeletedLocationIds.size) {
        this.campaign.locations = this.campaign.locations.filter((entry) => !this.campaignDeletedLocationIds.has(entry.id));
        this.campaign.routes = this.campaign.routes.filter((entry) => !this.campaignDeletedLocationIds.has(entry.fromId) && !this.campaignDeletedLocationIds.has(entry.toId));
      }
      this.mapCampaign = this.campaign; this.mapCampaignStep = this.campaignStep;
      const serialized = JSON.stringify({
        step: this.campaignStep,
        campaign: foundry.utils.deepClone(this.campaign),
        updatedAt: Date.now(),
        revision: ++this.campaignSaveRevision,
      });
      writeCampaignMapRecovery(serialized);
      const persist = async () => {
        await game.settings.set(MODULE_ID, "campaignMapBuilderDraft", serialized);
        if (!game.user?.isGM) return;
        try {
          await game.settings.set(MODULE_ID, "campaignMapBuilderWorldDraft", serialized);
        } catch (error) {
          console.warn("Lore Smith | The map draft was saved locally, but the shared world copy could not be updated.", error);
        }
      };
      this.campaignSavePromise = this.campaignSavePromise.then(persist, persist);
      await this.campaignSavePromise;
    } else {
      this.adventureCampaign = this.campaign; this.adventureCampaignStep = this.campaignStep;
      await game.settings.set(MODULE_ID, "campaignBuilderDraft", JSON.stringify({ step: this.campaignStep, campaign: this.campaign }));
    }
  }

  writeCampaignRecoverySnapshot() {
    if (this.activeTab !== "campaignMap") return;
    this.mapCampaign = this.campaign; this.mapCampaignStep = this.campaignStep;
    writeCampaignMapRecovery(JSON.stringify({
      step: this.campaignStep,
      campaign: foundry.utils.deepClone(this.campaign),
      updatedAt: Date.now(),
      revision: ++this.campaignSaveRevision,
    }));
  }

  async renderCampaignPreservingScroll() {
    this.campaignScrollTop = this.element?.querySelector(".ls-main")?.scrollTop ?? this.campaignScrollTop;
    await this.render();
  }

  async syncCampaignForm({ persist = true } = {}) {
    const root = this.element;
    if (!root || !["campaign", "campaignMap"].includes(this.activeTab)) return;
    const value = (name) => root.querySelector(`[name="${name}"]`)?.value?.trim();
    const assign = (target, property, name, transform = (entry) => entry) => {
      const fieldValue = value(name);
      if (fieldValue !== undefined) target[property] = transform(fieldValue);
    };
    assign(this.campaign, "name", "campaignName");
    assign(this.campaign, "premise", "campaignPremise");
    assign(this.campaign, "startingLevel", "campaignStartingLevel", (entry) => Math.max(1, Math.min(20, Number(entry) || 1)));
    assign(this.campaign, "finalLevel", "campaignFinalLevel", (entry) => Math.max(1, Math.min(20, Number(entry) || 1)));
    assign(this.campaign, "sessionCount", "campaignSessionCount", (entry) => Math.max(1, Math.min(100, Number(entry) || 10)));
    assign(this.campaign, "sessionHours", "campaignSessionHours", (entry) => Math.max(1, Math.min(12, Number(entry) || 4)));
    assign(this.campaign, "length", "campaignLength");
    if (this.activeTab === "campaignMap") {
      const previousStart = this.campaign.map.startLocationId;
      assign(this.campaign.map, "startLocationId", "campaignStartLocation");
      if (this.campaign.map.startLocationId && this.campaign.map.startLocationId !== previousStart) {
        const start = this.campaign.locations.find((entry) => entry.id === this.campaign.map.startLocationId);
        if (start && Number.isFinite(Number(start.x)) && Number.isFinite(Number(start.y))) {
          this.campaign.map.focus.x = Number(start.x);
          this.campaign.map.focus.y = Number(start.y);
        }
      }
    }
    assign(this.campaign, "style", "campaignStyle");
    assign(this.campaign, "tone", "campaignTone");
    assign(this.campaign.identity, "themes", "campaignThemes");
    assign(this.campaign.identity, "playerPromise", "campaignPlayerPromise");
    assign(this.campaign.identity, "boundaries", "campaignBoundaries");
    assign(this.campaign, "background", "campaignBackground");
    assign(this.campaign, "characterHooks", "campaignCharacterHooks");
    assign(this.campaign.problem, "wrong", "campaignProblemWrong");
    assign(this.campaign.problem, "cause", "campaignProblemCause");
    assign(this.campaign.problem, "stakes", "campaignProblemStakes");
    assign(this.campaign.problem, "involvement", "campaignProblemInvolvement");
    assign(this.campaign.problem, "distinction", "campaignProblemDistinction");
    assign(this.campaign.problem, "resolution", "campaignProblemResolution");
    assign(this.campaign.setting, "history", "campaignSettingHistory");
    assign(this.campaign.setting, "cultures", "campaignSettingCultures");
    assign(this.campaign.setting, "magic", "campaignSettingMagic");
    assign(this.campaign.setting, "politics", "campaignSettingPolitics");
    assign(this.campaign.progression, "leveling", "campaignLeveling");
    assign(this.campaign.progression, "treasure", "campaignProgressionTreasure");
    assign(this.campaign.progression, "narrative", "campaignProgressionNarrative");
    assign(this.campaign.progression, "reputation", "campaignProgressionReputation");
    assign(this.campaign.progression, "options", "campaignProgressionOptions");
    assign(this.campaign.consistency, "imagery", "campaignConsistencyImagery");
    assign(this.campaign.consistency, "naming", "campaignConsistencyNaming");
    assign(this.campaign.consistency, "rules", "campaignConsistencyRules");
    assign(this.campaign.consistency, "timeline", "campaignConsistencyTimeline");
    assign(this.campaign.consistency, "travel", "campaignConsistencyTravel");
    const collectionFields = {
      structure: ["name", "summary", "outcome"], locations: ["name", "type", "image", "description", "importance", "secret", "currentSituation", "people", "services", "reasonToLeave", "ignored", "relationship", "reasonToVisit", "opportunity", "danger", "lead", "travel", "knownFor", "rumor", "futureUse"],
      factions: ["name", "goal", "methods", "resources", "relationship", "ignored"], threats: ["name", "goal", "escalation", "consequences"],
      openQuestions: ["text"], secrets: ["secret", "clues", "knownBy"], rumors: ["text", "truth"],
      worldEvents: ["trigger", "event", "consequence"],
      chapters: ["title", "purpose", "opening", "information", "locations", "npcs", "scenes", "revelations", "encounters", "rewards", "choices", "consequences", "transition"],
      routes: ["fromId", "toId", "type", "travel", "feature", "complication"],
    };
    for (const [property, fields] of Object.entries(collectionFields)) {
      if (this.activeTab === "campaignMap" && this.campaignStep === 0 && property === "locations") continue;
      const cards = [...root.querySelectorAll(`[data-campaign-entry-kind="${property}"]`)];
      if (!cards.length) continue;
      const existing = new Map(this.campaign[property].map((entry) => [entry.id, entry]));
      const updates = cards.map((card) => {
        const id = card.dataset.campaignEntryId;
        const entry = { ...(existing.get(id) ?? {}), id };
        for (const field of fields) {
          const control = card.querySelector(`[data-campaign-field="${field}"]`);
          if (control) entry[field] = control.value.trim();
        }
        return entry;
      });
      if (this.activeTab === "campaignMap" && property === "locations") {
        const byId = new Map(updates.map((entry) => [entry.id, entry]));
        this.campaign.locations = this.campaign.locations.map((entry) => byId.get(entry.id) ?? entry);
      } else {
        this.campaign[property] = updates;
      }
    }
    const existingPeople = new Map(this.campaign.people.map((person) => [person.id, person]));
    const personCards = [...root.querySelectorAll("[data-campaign-person-id]")];
    if (personCards.length) this.campaign.people = personCards.map((card) => {
      const person = existingPeople.get(card.dataset.campaignPersonId) ?? newCampaignPerson("person", "Important person");
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...person, name: field("campaignPersonName"), description: field("campaignPersonDescription"), wants: field("campaignPersonWants"), knows: field("campaignPersonKnows"), secret: field("campaignPersonSecret") };
    });
    const existingCharacters = new Map(this.campaign.characters.map((character) => [character.id, character]));
    const characterCards = [...root.querySelectorAll("[data-campaign-character-id]")];
    if (characterCards.length) this.campaign.characters = characterCards.map((card) => {
      const character = existingCharacters.get(card.dataset.campaignCharacterId) ?? newCampaignCharacter();
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...character, name: field("campaignCharacterName"), involvement: field("campaignCharacterInvolvement"), npcConnection: field("campaignCharacterNpc"), desire: field("campaignCharacterDesire"), bond: field("campaignCharacterBond"), complication: field("campaignCharacterComplication"), growth: field("campaignCharacterGrowth") };
    });
    if (this.activeTab === "campaignMap" && this.campaignDeletedLocationIds.size) {
      this.campaign.locations = this.campaign.locations.filter((entry) => !this.campaignDeletedLocationIds.has(entry.id));
      this.campaign.routes = this.campaign.routes.filter((entry) => !this.campaignDeletedLocationIds.has(entry.fromId) && !this.campaignDeletedLocationIds.has(entry.toId));
    }
    if (this.activeTab === "campaignMap") ensureCampaignMapScope(this.campaign); else ensureCampaignScope(this.campaign);
    if (this.activeTab === "campaignMap" && !persist) {
      this.writeCampaignRecoverySnapshot();
    }
    if (persist) await this.saveCampaignDraft();
  }

  static async newCampaignBuild() {
    await this.syncCampaignForm();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Start a new campaign?" },
      content: "<p>This clears the current Campaign Builder draft. Existing Foundry Journals are not deleted.</p>",
      yes: { label: "Start new campaign", icon: "fa-solid fa-rotate-left" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    this.campaign = this.activeTab === "campaignMap" ? newCampaignMapBuild() : newCampaignBuild();
    this.campaignStep = 0;
    await this.saveCampaignDraft();
    await this.render();
  }

  static async previousCampaignStep() {
    await this.syncCampaignForm();
    this.campaignStep = Math.max(0, this.campaignStep - 1);
    await this.saveCampaignDraft();
    await this.render();
  }

  static async nextCampaignStep() {
    await this.syncCampaignForm();
    this.campaignStep = Math.min(7, this.campaignStep + 1);
    await this.saveCampaignDraft();
    await this.render();
  }

  static async goToCampaignStep(_event, target) {
    await this.syncCampaignForm();
    this.campaignStep = Math.max(0, Math.min(7, Number(target.dataset.step) || 0));
    await this.saveCampaignDraft();
    await this.render();
  }

  static async browseCampaignLocationImage(_event, target) {
    await this.syncCampaignForm();
    const entry = this.campaign.locations.find((location) => location.id === target.dataset.id);
    if (!entry) return;
    new FilePicker({ type: "imagevideo", current: entry.image, callback: async (path) => {
      entry.image = path;
      await this.saveCampaignDraft();
      await this.renderCampaignPreservingScroll();
    } }).browse();
  }

  static async browseCampaignMap() {
    await this.syncCampaignForm();
    new FilePicker({ type: "imagevideo", current: this.campaign.map.image, callback: async (path) => {
      this.campaign.map.image = path;
      await this.saveCampaignDraft();
      await this.renderCampaignPreservingScroll();
    } }).browse();
  }

  static async activateCampaignMapTool(_event, target) {
    await this.syncCampaignForm();
    this.campaignMapTool = target.dataset.tool === this.campaignMapTool ? "" : target.dataset.tool;
    await this.renderCampaignPreservingScroll();
  }

  static async cancelCampaignMapTool() {
    this.campaignMapTool = "";
    await this.renderCampaignPreservingScroll();
  }

  static async resetCampaignMapView() {
    ensureCampaignMapScope(this.campaign);
    this.campaign.map.view = { zoom: 1, panX: 0, panY: 0 };
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async selectCampaignMarker(_event, target) {
    if (this._campaignMarkerWasDragged) {
      this._campaignMarkerWasDragged = false;
      return;
    }
    await this.syncCampaignForm();
    const location = this.campaign.locations.find((entry) => entry.id === target.dataset.id);
    if (!location) return;
    this.campaign.map.startLocationId = location.id;
    this.campaign.map.focus.x = Number(location.x) || 0.5;
    this.campaign.map.focus.y = Number(location.y) || 0.5;
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignMarker(_event, target) {
    await this.syncCampaignForm();
    const id = target.dataset.id;
    clearTimeout(this.campaignSaveTimer);
    this.campaignDeletedLocationIds.add(id);
    this.campaign.locations = this.campaign.locations.filter((entry) => entry.id !== id);
    if (this.mapCampaign !== this.campaign) this.mapCampaign.locations = this.mapCampaign.locations.filter((entry) => entry.id !== id);
    this.campaign.routes = this.campaign.routes.filter((entry) => entry.fromId !== id && entry.toId !== id);
    if (this.campaign.map.startLocationId === id) this.campaign.map.startLocationId = "";
    this.writeCampaignRecoverySnapshot();
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async addCampaignEntry(_event, target) {
    await this.syncCampaignForm();
    const kind = target.dataset.kind;
    const factories = {
      structure: newCampaignStructure, locations: newCampaignLocation, factions: newCampaignFaction,
      threats: newCampaignThreat, openQuestions: newCampaignQuestion, secrets: newCampaignSecret,
      rumors: newCampaignRumor, worldEvents: newCampaignWorldEvent, routes: newCampaignRoute,
      people: () => newCampaignPerson("person", `Important person ${this.campaign.people.length + 1}`),
    };
    if (!factories[kind] || !Array.isArray(this.campaign[kind])) return;
    this.campaign[kind].push(factories[kind]());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignEntry(_event, target) {
    await this.syncCampaignForm();
    const kind = target.dataset.kind;
    if (!Array.isArray(this.campaign[kind])) return;
    this.campaign[kind] = this.campaign[kind].filter((entry) => entry.id !== target.dataset.id);
    if (this.activeTab === "campaignMap") ensureCampaignMapScope(this.campaign); else ensureCampaignScope(this.campaign);
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async addCampaignCharacter() {
    await this.syncCampaignForm();
    this.campaign.characters.push(newCampaignCharacter());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignCharacter(_event, target) {
    await this.syncCampaignForm();
    this.campaign.characters = this.campaign.characters.filter((character) => character.id !== target.dataset.id);
    if (!this.campaign.characters.length) this.campaign.characters.push(newCampaignCharacter());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async createCampaignJournal() {
    await this.syncCampaignForm();
    const mapBuilder = this.activeTab === "campaignMap";
    const invalid = mapBuilder
      ? !this.campaign.name.trim() || !this.campaign.map.image || !this.campaign.map.startLocationId || !this.campaign.problem.wrong.trim()
      : !this.campaign.name.trim() || !this.campaign.problem.wrong.trim() || !this.campaign.problem.cause.trim() || !this.campaign.problem.stakes.trim()
        || !this.campaign.locations.some((entry) => entry.name.trim()) || !this.campaign.factions.some((entry) => entry.name.trim()) || !this.campaign.threats.some((entry) => entry.name.trim());
    if (invalid) {
      this.campaignStep = 7;
      await this.saveCampaignDraft();
      await this.render();
      return ui.notifications.warn("Complete the required Campaign Builder fields before creating the Journal.");
    }
    let journal = game.journal.get(this.campaign.journalId);
    if (!journal) {
      journal = await JournalEntry.create({
        name: this.campaign.name.trim(),
        flags: { [FLAG_SCOPE]: { campaignBuilder: true, createdAt: new Date().toISOString() } },
        pages: [],
      });
      this.campaign.journalId = journal.id;
    } else {
      await journal.update({ name: this.campaign.name.trim() });
    }
    const generated = mapBuilder ? campaignJournalPages(this.campaign) : adventureCampaignJournalPages(this.campaign);
    const generatedKeys = new Set(generated.map((page) => page.key));
    const obsoletePages = journal.pages.filter((page) => {
      const key = page.getFlag(FLAG_SCOPE, "campaignSection");
      return key && !generatedKeys.has(key);
    });
    if (obsoletePages.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", obsoletePages.map((page) => page.id));
    for (const [index, pageData] of generated.entries()) {
      const existing = journal.pages.find((page) => page.getFlag(FLAG_SCOPE, "campaignSection") === pageData.key);
      if (existing) {
        await existing.update({ name: pageData.name, "text.content": pageData.content, sort: (index + 1) * 100000 });
      } else {
        await journal.createEmbeddedDocuments("JournalEntryPage", [{
          name: pageData.name, type: "text", text: { content: pageData.content }, sort: (index + 1) * 100000,
          flags: { [FLAG_SCOPE]: { campaignSection: pageData.key } },
        }]);
      }
    }
    const campaignConfig = {
      length: this.campaign.length, style: this.campaign.style, tone: this.campaign.tone,
      startingLevel: this.campaign.startingLevel, finalLevel: this.campaign.finalLevel,
      sessionCount: this.campaign.sessionCount, sessionHours: this.campaign.sessionHours,
    };
    if (mapBuilder) campaignConfig.map = foundry.utils.deepClone(this.campaign.map);
    await journal.setFlag(FLAG_SCOPE, "campaignConfig", campaignConfig);
    await this.saveCampaignDraft();
    ui.notifications.info(`${journal.name} is ready in Foundry Journals.`);
    journal.sheet.render(true);
    await this.render();
  }

  static async openCampaignJournal() {
    const journal = game.journal.get(this.campaign.journalId);
    if (!journal) return ui.notifications.warn("Create the campaign Journal first.");
    journal.sheet.render(true);
  }

  static async changeTab(event, target) {
    const tab = target?.dataset?.tab || event?.currentTarget?.dataset?.tab;
    if (!tab) return;
    await this.syncSessionPrepForm();
    await this.syncCampaignForm();
    this.activeTab = tab;
    if (tab === "campaignMap") {
      this.campaign = this.mapCampaign; this.campaignStep = this.mapCampaignStep;
    } else if (tab === "campaign") {
      this.campaign = this.adventureCampaign; this.campaignStep = this.adventureCampaignStep;
    }
    await this.render();
  }

  static async newSessionPrep() {
    this.sessionStep = 0;
    this.sessionPrep = newSessionPrep();
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async previousSessionStep() {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, this.sessionStep - 1);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async nextSessionStep() {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.min(5, this.sessionStep + 1);
    if (this.sessionStep === 3) await ensureSessionPlaylistAvailable(this.sessionPrep);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async goToSessionStep(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, Math.min(5, Number(target.dataset.step) || 0));
    if (this.sessionStep === 3) await ensureSessionPlaylistAvailable(this.sessionPrep);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async addLocation() {
    await this.syncSessionPrepForm();
    this.sessionPrep.locations.push(newSessionLocation());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeLocation(_event, target) {
    await this.syncSessionPrepForm();
    if (this.sessionPrep.locations.length <= 2) return;
    this.sessionPrep.locations = this.sessionPrep.locations.filter((location) => location.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseLocationImage(_event, target) {
    await this.syncSessionPrepForm();
    const location = this.sessionPrep.locations.find((entry) => entry.id === target.dataset.id);
    if (!location) return;
    new FilePicker({ type: "imagevideo", current: location.image, callback: async (path) => {
      location.image = path;
      await this.saveSessionPrepDraft();
      const input = this.element?.querySelector(`[data-location-id="${location.id}"] [name="locationImage"]`);
      if (input) input.value = path;
    } }).browse();
  }

  static async addSessionNpc() {
    await this.syncSessionPrepForm();
    this.sessionPrep.npcs ??= [];
    this.sessionPrep.npcs.push(newSessionNpc());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeSessionNpc(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.npcs = (this.sessionPrep.npcs ?? []).filter((npc) => npc.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseSessionNpcImage(_event, target) {
    await this.syncSessionPrepForm();
    const npc = (this.sessionPrep.npcs ?? []).find((entry) => entry.id === target.dataset.id);
    if (!npc) return;
    new FilePicker({ type: "imagevideo", current: npc.image, callback: async (path) => {
      npc.image = path;
      await this.saveSessionPrepDraft();
      const card = this.element?.querySelector(`[data-session-npc-id="${npc.id}"]`);
      const input = card?.querySelector('[name="npcImage"]');
      if (input) input.value = path;
      const portrait = card?.querySelector(".ls-session-npc-portrait");
      if (portrait) {
        portrait.replaceChildren();
        const image = document.createElement("img"); image.src = path; image.alt = npc.name || "NPC"; portrait.append(image);
      }
    } }).browse();
  }

  static async addMusicCue() {
    await this.syncSessionPrepForm();
    this.sessionPrep.musicCues ??= [];
    this.sessionPrep.musicCues.push(newSessionMusicCue());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeMusicCue(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.musicCues = (this.sessionPrep.musicCues ?? []).filter((cue) => cue.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseMusicAudio(_event, target) {
    await this.syncSessionPrepForm();
    const cue = (this.sessionPrep.musicCues ?? []).find((entry) => entry.id === target.dataset.id);
    if (!cue) return;
    new FilePicker({ type: "audio", current: cue.audio, callback: async (path) => {
      cue.audio = path;
      await this.saveSessionPrepDraft();
      const input = this.element?.querySelector(`[data-session-music-id="${cue.id}"] [name="musicAudio"]`);
      if (input) input.value = path;
    } }).browse();
  }

  static async addPeopleEntry() {
    await this.syncSessionPrepForm(); this.sessionPrep.peopleEntries.push(newSessionPeopleEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removePeopleEntry(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.peopleEntries = this.sessionPrep.peopleEntries.filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep.peopleEntries.length) this.sessionPrep.peopleEntries.push(newSessionPeopleEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async addSessionEncounter() {
    await this.syncSessionPrepForm(); this.sessionPrep.encounterEntries.push(newSessionEncounter());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionEncounter(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.encounterEntries = this.sessionPrep.encounterEntries.filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep.encounterEntries.length) this.sessionPrep.encounterEntries.push(newSessionEncounter());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async addSessionTextEntry(_event, target) {
    await this.syncSessionPrepForm();
    const property = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" }[target.dataset.kind];
    if (!property) return;
    this.sessionPrep[property].push(newSessionTextEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionTextEntry(_event, target) {
    await this.syncSessionPrepForm();
    const property = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" }[target.dataset.kind];
    if (!property) return;
    this.sessionPrep[property] = this.sessionPrep[property].filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep[property].length) this.sessionPrep[property].push(newSessionTextEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionReference(_event, target) {
    const { kind, parentId, id } = target.dataset;
    if (kind === "hazard") this.sessionPrep.hazards = this.sessionPrep.hazards.filter((entry) => entry.id !== id);
    if (kind === "reward") this.sessionPrep.rewardItems = this.sessionPrep.rewardItems.filter((entry) => entry.id !== id);
    if (kind === "encounter") {
      const encounter = this.sessionPrep.encounterEntries.find((entry) => entry.id === parentId);
      if (encounter) encounter.actors = encounter.actors.filter((entry) => entry.id !== id);
    }
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async createSessionJournal() {
    await this.syncSessionPrepForm();
    const invalid = !this.sessionPrep.title.trim() || !this.sessionPrep.goal.trim()
      || this.sessionPrep.locations.length < 2 || this.sessionPrep.locations.some((location) => !location.name.trim() || !location.image.trim());
    if (invalid) {
      this.sessionStep = 5;
      await this.render();
      return ui.notifications.warn("Complete the title, goal, and both important places before creating the Journal.");
    }
    try {
      await materializeSessionMusic(this.sessionPrep);
    } catch (error) {
      console.error("Lore Smith | Could not create the session Playlist.", error);
      return ui.notifications.error("Lore Smith could not add the session music to Foundry. Check the selected audio files and try again.");
    }
    const journal = await JournalEntry.create({
      name: this.sessionPrep.title.trim(),
      flags: { [FLAG_SCOPE]: { sessionPrep: true, sessionPrepVersion: 3, createdAt: new Date().toISOString(), sessionGoal: this.sessionPrep.goal.trim() } },
      pages: [],
    });
    const pages = sessionJournalPages(this.sessionPrep).map((page, index) => ({ name: page.name, type: "text", text: { content: page.content }, sort: (index + 1) * 100000 }));
    await journal.createEmbeddedDocuments("JournalEntryPage", pages);
    this.lastSessionJournalId = journal.id;
    this.activeNoteId = null;
    this.sessionPrep = newSessionPrep();
    this.sessionStep = 0;
    await this.saveSessionPrepDraft();
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

  syncLootForm() {
    const root = this.element;
    if (!root) return;
    const enteredMin = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMinLevel"]')?.value) || 0));
    const enteredMax = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMaxLevel"]')?.value) || 0));
    this.lootMinLevel = Math.min(enteredMin, enteredMax);
    this.lootMaxLevel = Math.max(enteredMin, enteredMax);
    this.lootCount = Math.max(1, Math.min(100, Number(root.querySelector('[name="lootCount"]')?.value) || 6));
    this.lootSources = {
      permanent: Boolean(root.querySelector('[name="lootPermanent"]')?.checked), consumable: Boolean(root.querySelector('[name="lootConsumable"]')?.checked),
      gems: Boolean(root.querySelector('[name="lootGems"]')?.checked), art: Boolean(root.querySelector('[name="lootArt"]')?.checked),
    };
    this.lootRarities = {
      common: Boolean(root.querySelector('[name="lootRarityCommon"]')?.checked), uncommon: Boolean(root.querySelector('[name="lootRarityUncommon"]')?.checked),
      rare: Boolean(root.querySelector('[name="lootRarityRare"]')?.checked), unique: Boolean(root.querySelector('[name="lootRarityUnique"]')?.checked),
    };
    this.lootMatchMode = root.querySelector('[name="lootMatchMode"]')?.value === "any" ? "any" : "all";
    this.lootFlexible = Boolean(root.querySelector('[name="lootFlexible"]')?.checked);
    this.lootFilters = [...root.querySelectorAll("[data-loot-filter-id]")].map((row) => ({
      id: row.dataset.lootFilterId, mode: row.querySelector('[name="lootFilterMode"]')?.value ?? "required",
      mechanic: row.querySelector('[name="lootFilterMechanic"]')?.value ?? "resistance", detail: row.querySelector('[name="lootFilterDetail"]')?.value ?? "",
    }));
  }

  static async addLootFilter() { this.syncLootForm(); this.lootFilters.push(newLootFilter()); await this.render(); }

  static async removeLootFilter(_event, target) {
    this.syncLootForm();
    const row = target.closest("[data-loot-filter-id]");
    this.lootFilters = this.lootFilters.filter((filter) => filter.id !== row?.dataset.lootFilterId);
    await this.render();
  }

  static async generateLoot() {
    this.syncLootForm();
    const { lootMinLevel: minLevel, lootMaxLevel: maxLevel, lootCount: count } = this;
    const { permanent, consumable, gems, art } = this.lootSources;
    if (!permanent && !consumable && !gems && !art) return ui.notifications.warn("Choose at least one treasure source.");
    if ((permanent || consumable) && !Object.values(this.lootRarities).some(Boolean)) return ui.notifications.warn("Choose at least one item rarity.");
    const results = [];
    const candidates = await collectFilteredLoot(minLevel, maxLevel, {
      includePermanent: permanent, includeConsumable: consumable, rarities: this.lootRarities,
      filters: this.lootFilters, matchMode: this.lootMatchMode, flexible: this.lootFlexible,
    });
    const usedFamilies = new Set();
    const tableKinds = [...(gems ? ["gems"] : []), ...(art ? ["art"] : [])];
    const itemTarget = Math.max(0, count - Math.min(count, tableKinds.length));
    for (const candidate of candidates) {
      if (results.length >= itemTarget) break;
      const family = lootFamilyKey(candidate.name);
      if (!results.some((entry) => entry.uuid === candidate.uuid) && !usedFamilies.has(family)) {
        results.push(candidate); usedFamilies.add(family);
      }
    }
    let tablesUsed = 0;
    const maxTableAttempts = Math.max(tableKinds.length, count * 4);
    for (let attempt = 0; tableKinds.length && results.length < count && attempt < maxTableAttempts; attempt += 1) {
      const kind = tableKinds[attempt % tableKinds.length];
      const tableLevel = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
      const rolled = await rollTreasureTable(kind, tableLevel);
      if (!rolled) continue;
      tablesUsed += 1;
      const tableResult = rolled.document
        ? { name: rolled.document.name, img: rolled.document.img, type: ITEM_TYPE_LABELS[rolled.document.type] ?? rolled.document.type, documentType: rolled.document.type, level: numeric(rolled.document.system?.level, tableLevel), uuid: rolled.document.uuid, source: rolled.table, matchReasons: ["Treasure table result"] }
        : { name: rolled.text, img: rolled.img, type: kind === "gems" ? "Precious stone" : "Art object", level: tableLevel, uuid: "", source: rolled.table, matchReasons: ["Treasure table result"] };
      const family = lootFamilyKey(tableResult.name);
      if (family && usedFamilies.has(family)) continue;
      if (family) usedFamilies.add(family);
      results.push(tableResult);
    }
    const uniqueResults = [];
    const finalFamilies = new Set();
    for (const entry of results) {
      const family = lootFamilyKey(entry.name);
      if (family && finalFamilies.has(family)) continue;
      if (family) finalFamilies.add(family);
      uniqueResults.push(entry);
    }
    this.lootResults = uniqueResults.slice(0, count).map((entry) => ({
      ...entry, id: foundry.utils.randomID(),
      reason: entry.matchReasons?.length ? entry.matchReasons.join(" · ") : "Matches selected level, rarity, and source",
    }));
    const itemCount = this.lootResults.filter((entry) => entry.uuid).length;
    const shortfall = this.lootResults.length < count ? ` Requested ${count}; found ${this.lootResults.length} unique matches.` : "";
    this.lootStatus = `Found ${itemCount} installed PF2e item${itemCount === 1 ? "" : "s"} matching the selected source, rarity, level, and mechanical filters${tablesUsed ? `, plus results from ${tablesUsed} treasure table${tablesUsed === 1 ? "" : "s"}` : ""}.${shortfall}`;
    await this.render();
  }

  static async clearLoot() { this.lootResults = []; this.lootStatus = ""; await this.render(); }

  static async openLootDocument(_event, target) {
    const document = await fromUuid(target.dataset.uuid);
    document?.sheet?.render(true);
  }

  static async addLootToRewards(_event, target) {
    const result = this.lootResults.find((entry) => entry.id === target.dataset.id);
    if (!result?.uuid) return;
    this.sessionPrep.rewardItems ??= [];
    if (!this.sessionPrep.rewardItems.some((entry) => entry.uuid === result.uuid)) {
      this.sessionPrep.rewardItems.push(normalizeSessionReference(result));
      await this.saveSessionPrepDraft();
    }
    ui.notifications.info(`${result.name} was added to Session Prep rewards.`);
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
  game.settings.register(MODULE_ID, "sessionPrepDraft", {
    name: "Session Prep Draft",
    hint: "Automatically stores the current guided session-preparation draft.",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "campaignBuilderDraft", {
    name: "Campaign Builder Draft",
    hint: "Automatically stores the current guided campaign-building draft.",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "campaignMapBuilderDraft", {
    name: "Campaign Map Builder Draft", hint: "Automatically stores the progressive regional map preparation wizard.",
    scope: "client", config: false, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "campaignMapBuilderWorldDraft", {
    name: "Campaign Map Builder World Draft",
    hint: "Stores the regional campaign map for this Foundry world so it survives browser and device changes.",
    scope: "world", config: false, type: String, default: "",
  });
  game.settings.registerMenu(MODULE_ID, "openDashboard", {
    name: "Open Lore Smith",
    label: "Open Lore Smith",
    hint: "Open the Lore Smith PF2e Game Master workspace.",
    icon: "fa-solid fa-book-sparkles",
    type: LoreSmithDashboard,
    restricted: true,
  });
});

Hooks.once("ready", async () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error("Lore Smith requires the Pathfinder Second Edition system.");
    return;
  }
  Object.assign(game.loreSmith ??= {}, {
    open: openLoreSmith,
    simulateEncounter,
    runLiveReplay,
    buildCoverageReport: (tokens, partyIds = null, enemyIds = null) =>
      actionCoverageReport(tokens, partyIds, enemyIds),
    decisionFlows: decisionFlowStatus,
    ensureDecisionFlows: initializeDecisionFlows,
  });
  await initializeDecisionFlows();
  try {
    await migrateSessionPrepJournals();
  } catch (error) {
    console.warn("Lore Smith | Could not clean older Session Prep Journal headings.", error);
  }
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

Hooks.on("renderJournalSheet", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  if (!root || root.dataset.loreSmithSessionAudio === "true") return;
  root.dataset.loreSmithSessionAudio = "true";
  root.addEventListener("click", async (event) => {
    const button = event.target.closest?.(".ls-play-session-track");
    if (!button) return;
    event.preventDefault();
    const playlist = game.playlists.get(button.dataset.playlistId);
    const sound = playlist?.sounds?.get(button.dataset.soundId);
    if (!playlist || !sound) return ui.notifications.warn("That session song no longer exists in its Playlist.");
    if (sound.playing) await playlist.stopSound(sound);
    else await playlist.playSound(sound);
  });
});
