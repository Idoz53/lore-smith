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
      attacker.turnUses.clear();
      attacker.damageActionsThisTurn = 0;
      attacker.utilityActionsThisTurn = 0;
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
  if (!nativeRoll || !Number.isFinite(Number(nativeRoll.total))) return null;
  const rolled = Math.max(0, Math.abs(Number(nativeRoll.total)));
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
    const sortedDirections = [...directions].sort((left, right) => {
      const leftTop = lsTopLeftForOffset({ i: node.offset.i + left.i, j: node.offset.j + left.j });
      const rightTop = lsTopLeftForOffset({ i: node.offset.i + right.i, j: node.offset.j + right.j });
      return score(rightTop, node.path) - score(leftTop, node.path);
    });
    for (const direction of sortedDirections) {
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
  await attacker.token.update(destination, { animate: true, animation: { duration: 650 } });
  return true;
}

function createIsolatedToken(document, world) {
  const original = document.object;
  const state = {
    id: document.id,
    actor: document.actor,
    actorId: document.actorId ?? document.actor?.id,
    name: document.name ?? document.actor?.name ?? "Combatant",
    hidden: false,
    texture: { src: document.texture?.src ?? document.actor?.img ?? "icons/svg/mystery-man.svg" },
    x: Number(document.x ?? original?.x ?? 0),
    y: Number(document.y ?? original?.y ?? 0),
    width: Number(document.width ?? 1),
    height: Number(document.height ?? 1),
    _loreSmithIsolated: true,
    async update(changes = {}) {
      if (Number.isFinite(Number(changes.x))) state.x = Number(changes.x);
      if (Number.isFinite(Number(changes.y))) state.y = Number(changes.y);
      world.onChange?.();
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
  if (distance <= desiredRange) return { moved: false, reason: "already in range" };
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
    isGoal: (topLeft) => distanceAt(topLeft) <= desiredRange,
    score: (topLeft) => -distanceAt(topLeft),
    allowBest: true,
  });
  const startingDistance = distanceAt({ x: token.x, y: token.y });
  if (!path?.length || distanceAt(path.at(-1)) >= startingDistance) {
    return { moved: false, reason: "no unoccupied grid square makes legal progress" };
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
      x: dimensions.sceneX,
      y: dimensions.sceneY,
      width: dimensions.sceneWidth,
      height: dimensions.sceneHeight,
      background: canvas.scene?.background?.src ?? canvas.scene?.img ?? "",
      gridSize: canvas.grid.size,
      gridDistance: canvas.grid.distance,
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
      conditions: [...(combatant.conditions?.entries?.() ?? [])].map(([slug, value]) => ({ slug, value })),
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
          const positioning = String(attacker.profile.positioning ?? "").toLowerCase();
          const prefersRange = option.range > 10 && (
            attacker.profile.roles.includes("caster") || attacker.profile.roles.includes("ranged")
            || /backline|midline|at range|protected/.test(positioning)
          );
          if (prefersRange && currentDistance <= 10 && actionsRemaining > cost && !attacker.tacticalRepositioned) {
            const movedAway = await moveAwayFromThreats(attacker, target, combatants, option.range);
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
          if (frontline && option.damage && option.range <= 10 && currentDistance <= 10
            && !targetOffGuard && actionsRemaining > cost && !attacker.tacticalRepositioned) {
            const flanked = await moveToSafeFlank(attacker, target, combatants);
            if (flanked) {
              actionsRemaining -= 1;
              attacker.tacticalRepositioned = true;
              await emit(`${attacker.name} Strides to the opposite side of ${target.name} for a rules-legal flank; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "move");
              await pause(actionDelay());
              continue;
            }
          }
          if (currentDistance > option.range) {
            const movement = await moveToward(attacker, target, Math.max(5, option.range));
            if (!movement.moved) {
              await emit(`${attacker.name} cannot reach ${option.name}'s ${option.range}-foot range from an unoccupied square with one Stride (${movement.reason}).`, "action");
              break;
            }
            actionsRemaining -= 1;
            attacker.tacticalRepositioned = true;
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
        const nativeActionCard = isolated ? null : nativeUse.message ?? await postNativeActionCard(option);
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
          resolutionStage = `PF2e check/save button for ${affected.name}`;
          const nativeCheck = option.automatic ? null : await resolveNativeCheck({
            option,
            attacker,
            target: affected,
            nativeMessage: nativeActionCard,
            mapPenalty: map,
            dc: option.save ? option.dc : actorAc(affected.actor),
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
              : `${affected.name}: ${liveCheckSummary(nativeCheck)} vs ${option.defenseStatistic ?? "AC"} ${nativeCheck.dc}, ${degreeText(degree)} [PF2e native]`
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

const LOOT_ROLES = {
  dps: { label: "DPS" }, tank: { label: "TANK" }, healer: { label: "HEALER" }, annoyer: { label: "ANNOYER" },
};

function lootText(entry) {
  return `${entry.name ?? ""} ${entry.description ?? ""} ${(entry.traits ?? []).join(" ")}`.replace(/<[^>]+>/g, " ").toLowerCase();
}

function weightedMatches(text, patterns, weight) {
  return patterns.reduce((score, pattern) => score + (text.includes(pattern) ? weight : 0), 0);
}

function lootRoleScore(entry, role) {
  const text = lootText(entry);
  const name = String(entry.name ?? "").toLowerCase();
  const type = String(entry.documentType ?? entry.type ?? "").toLowerCase();
  if (role === "tank") {
    let score = type === "shield" ? 18 : type === "armor" ? 16 : 0;
    score += weightedMatches(text, ["item bonus to ac", "status bonus to ac", "circumstance bonus to ac", "resilient rune", "fortification rune", "raise a shield", "shield block", "shield hardness", "reduces the damage", "resistance to", "bonus to saving throws"], 8);
    score += weightedMatches(name, ["resilient", "fortification", "defender", "barricade", "lifting belt"], 7);
    score += weightedMatches(text, ["increase your maximum bulk", "increases your maximum bulk", "bulk limits are increased", "carry more bulk", "lifting belt"], 6);
    if (["book", "kit", "treasure"].includes(type)) score -= 20;
    return score;
  }
  if (role === "dps") {
    let score = type === "weapon" ? 14 : type === "ammo" ? 10 : 0;
    score += weightedMatches(text, ["item bonus to attack", "weapon potency", "striking rune", "additional damage", "extra damage", "damage die", "critical specialization", "persistent damage"], 7);
    score += weightedMatches(name, ["striking", "potency", "bomb", "ammunition"], 5);
    return score;
  }
  if (role === "healer") {
    let score = type === "consumable" ? 2 : 0;
    score += weightedMatches(text, ["restore hit points", "regains hit points", "healing effect", "medicine checks", "treat wounds", "remove the condition", "counteract", "recovery check"], 8);
    score += weightedMatches(name, ["healing", "elixir of life", "healer", "antidote", "antiplague", "restoration", "medic"], 7);
    return score;
  }
  if (role === "annoyer") {
    let score = 0;
    score += weightedMatches(text, ["frightened", "slowed", "stunned", "sickened", "clumsy", "enfeebled", "stupefied", "off-guard", "prone", "restrained", "immobilized", "dazzled", "blinded", "difficult terrain", "forced movement", "penalty to"], 7);
    score += weightedMatches(name, ["snare", "tangle", "dazzling", "fear", "bottled", "binding", "restraining"], 5);
    return score;
  }
  return 0;
}

function lootFamilyKey(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(lesser|moderate|greater|major|true|minor|standard|light|heavy)\b/g, " ")
    .replace(/\+\d+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
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

async function collectRoleLoot(minLevel, maxLevel, role, includePermanent, includeConsumable) {
  const allowedTypes = new Set();
  if (includePermanent) ["armor", "shield", "weapon", "equipment", "backpack", "kit", "book", "treasure"].forEach((type) => allowedTypes.add(type));
  if (includeConsumable) ["consumable", "ammo"].forEach((type) => allowedTypes.add(type));
  const entries = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["name", "img", "type", "system.level.value", "system.description.value", "system.traits.value"] });
    for (const entry of index) {
      if (!allowedTypes.has(entry.type)) continue;
      const itemLevel = numeric(entry.system?.level, 0);
      if (itemLevel < minLevel || itemLevel > maxLevel) continue;
      const candidate = {
        name: entry.name, img: entry.img, type: ITEM_TYPE_LABELS[entry.type] ?? entry.type, level: itemLevel,
        description: entry.system?.description?.value ?? "", traits: entry.system?.traits?.value ?? [],
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${entry._id}`, source: pack.metadata.label, documentType: entry.type,
      };
      candidate.score = lootRoleScore(candidate, role);
      entries.push(candidate);
    }
  }
  const roleMatches = entries.filter((entry) => entry.score >= 5).sort((left, right) => right.score - left.score || Math.random() - 0.5);
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
    `<hr><p><strong>Important places</strong></p><ul>${placeNames.map((name) => `<li>[[Place — ${escapeHtml(name)}]]</li>`).join("")}</ul>`,
    "<p><em>Use the linked pages for sensory descriptions and table-ready details.</em></p>",
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
    npcNames.length ? `<p><strong>Important NPCs</strong></p><ul>${npcNames.map((name) => `<li>[[NPC - ${escapeHtml(name)}]]</li>`).join("")}</ul>` : "",
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
  });
}

async function migrateSessionPrepJournals() {
  if (!game.user.isGM) return;
  for (const journal of game.journal.contents.filter((entry) => entry.getFlag(FLAG_SCOPE, "sessionPrep"))) {
    if (Number(journal.getFlag(FLAG_SCOPE, "sessionPrepVersion") ?? 0) >= 2) continue;
    const updates = [];
    for (const page of journal.pages.contents.filter((entry) => entry.type === "text")) {
      const content = cleanSessionPrepHeadings(page.text?.content);
      if (content !== page.text?.content) updates.push({ _id: page.id, "text.content": content });
    }
    if (updates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
    await journal.setFlag(FLAG_SCOPE, "sessionPrepVersion", 2);
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
      clearLoot: LoreSmithDashboard.clearLoot,
      addLootToRewards: LoreSmithDashboard.addLootToRewards,
      openLootDocument: LoreSmithDashboard.openLootDocument,
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
  sessionDraftLoaded = false;
  sessionSaveTimer = null;
  lastSessionJournalId = null;
  sessionScrollTop = 0;
  lootResults = [];
  lootStatus = "";
  lootMinLevel = 1;
  lootMaxLevel = 1;
  lootRole = "dps";
  lootCount = 6;
  lootSources = { permanent: true, consumable: true, gems: false, art: false };

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
      lootRoles: Object.entries(LOOT_ROLES).map(([value, data]) => ({ value, label: data.label, selected: value === this.lootRole })),
      lootResults: this.lootResults, lootStatus: this.lootStatus,
      lootMinLevel: this.lootMinLevel, lootMaxLevel: this.lootMaxLevel, lootCount: this.lootCount, lootSources: this.lootSources,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const main = this.element?.querySelector(".ls-main");
    if (main && this.sessionScrollTop) main.scrollTop = this.sessionScrollTop;
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

  static async changeTab(event, target) {
    const tab = target?.dataset?.tab || event?.currentTarget?.dataset?.tab;
    if (!tab) return;
    await this.syncSessionPrepForm();
    this.activeTab = tab;
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
      flags: { [FLAG_SCOPE]: { sessionPrep: true, sessionPrepVersion: 2, createdAt: new Date().toISOString(), sessionGoal: this.sessionPrep.goal.trim() } },
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

  static async generateLoot() {
    const root = this.element;
    const enteredMin = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMinLevel"]')?.value) || 0));
    const enteredMax = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMaxLevel"]')?.value) || 0));
    const minLevel = Math.min(enteredMin, enteredMax);
    const maxLevel = Math.max(enteredMin, enteredMax);
    const role = root.querySelector('[name="lootRole"]')?.value || "dps";
    const count = Math.max(1, Math.min(100, Number(root.querySelector('[name="lootCount"]')?.value) || 6));
    const permanent = Boolean(root.querySelector('[name="lootPermanent"]')?.checked);
    const consumable = Boolean(root.querySelector('[name="lootConsumable"]')?.checked);
    const gems = Boolean(root.querySelector('[name="lootGems"]')?.checked);
    const art = Boolean(root.querySelector('[name="lootArt"]')?.checked);
    Object.assign(this, { lootMinLevel: minLevel, lootMaxLevel: maxLevel, lootRole: role, lootCount: count, lootSources: { permanent, consumable, gems, art } });
    if (!permanent && !consumable && !gems && !art) return ui.notifications.warn("Choose at least one treasure source.");
    const results = [];
    const tableKinds = [...(permanent ? ["permanent"] : []), ...(consumable ? ["consumable"] : [])];
    let tablesUsed = 0;
    for (const kind of tableKinds) {
      const tableLevel = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
      const rolled = await rollTreasureTable(kind, tableLevel);
      if (!rolled?.document) continue;
      tablesUsed += 1;
      const data = { name: rolled.document.name, img: rolled.document.img, type: ITEM_TYPE_LABELS[rolled.document.type] ?? rolled.document.type, documentType: rolled.document.type, level: numeric(rolled.document.system?.level, tableLevel), description: rolled.document.system?.description?.value ?? "", traits: rolled.document.system?.traits?.value ?? [], uuid: rolled.document.uuid, source: rolled.table };
      data.score = lootRoleScore(data, role);
      if (data.score >= 5) results.push(data);
    }
    const candidates = await collectRoleLoot(minLevel, maxLevel, role, permanent, consumable);
    const usedFamilies = new Set(results.map((entry) => lootFamilyKey(entry.name)));
    for (const candidate of candidates) {
      if (results.length >= count) break;
      const family = lootFamilyKey(candidate.name);
      if (!results.some((entry) => entry.uuid === candidate.uuid) && !usedFamilies.has(family)) {
        results.push(candidate); usedFamilies.add(family);
      }
    }
    for (const kind of [...(gems ? ["gems"] : []), ...(art ? ["art"] : [])]) {
      const tableLevel = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
      const rolled = await rollTreasureTable(kind, tableLevel);
      if (!rolled) continue;
      tablesUsed += 1;
      if (rolled.document) results.push({ name: rolled.document.name, img: rolled.document.img, type: ITEM_TYPE_LABELS[rolled.document.type] ?? rolled.document.type, documentType: rolled.document.type, level: numeric(rolled.document.system?.level, tableLevel), uuid: rolled.document.uuid, source: rolled.table, score: 0 });
      else results.push({ name: rolled.text, img: rolled.img, type: kind === "gems" ? "Precious stone" : "Art object", level: tableLevel, uuid: "", source: rolled.table, score: 0 });
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
      reason: entry.score >= 14 ? `Strong ${LOOT_ROLES[role].label} match` : entry.score >= 8 ? `Good ${LOOT_ROLES[role].label} match` : entry.score > 0 ? `${LOOT_ROLES[role].label} utility` : `Treasure table result`,
    }));
    this.lootStatus = tablesUsed
      ? `Used ${tablesUsed} installed PF2e treasure table${tablesUsed === 1 ? "" : "s"}; role matching was completed from installed item compendia for levels ${minLevel}–${maxLevel}.`
      : `No matching installed treasure table was found, so Lore Smith used installed PF2e items from levels ${minLevel}–${maxLevel} directly.`;
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
