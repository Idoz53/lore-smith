import {
  actionTargets,
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
    uses: new Map(options.filter((option) => option.limitedUses !== null).map((option) => [option.id, option.limitedUses])),
    conditions: new Map(),
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
      let actionsRemaining = 3;
      let map = 0;
      while (actionsRemaining > 0) {
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map);
        if (!choice) break;
        const { option, target, cost } = choice;
        actionsRemaining -= cost;
        consumeUse(attacker, option);
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
          let multiplier = 0;
          let outcome = "no effect";
          if (option.save) {
            const natural = rollDie(20);
            const modifier = saveModifier(affected, option.save);
            const total = natural + modifier;
            const degree = checkDegree(total, option.dc, natural);
            multiplier = [2, 1, 0.5, 0][degree];
            outcome = `${affected.name} rolls ${option.save}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs DC ${option.dc}, ${degreeText(degree)}`;
          } else if (option.automatic) {
            multiplier = 1;
            outcome = `${affected.name} is automatically affected`;
          } else {
            const natural = rollDie(20);
            const modifier = option.attack - (option.attackTrait ? map : 0);
            const baseAc = affected.ac;
            const conditionPenalty = (affected.conditions.has("off-guard") || affected.conditions.has("prone") ? 2 : 0)
              + Math.max(affected.conditions.get("frightened") ?? 0, affected.conditions.get("sickened") ?? 0);
            const effectiveAc = Math.max(0, baseAc - conditionPenalty);
            const total = natural + modifier;
            const degree = checkDegree(total, effectiveAc, natural);
            multiplier = degree === 3 ? 2 : degree === 2 ? 1 : 0;
            outcome = `${affected.name}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs AC ${effectiveAc}${conditionPenalty ? ` (base ${baseAc}, conditions −${conditionPenalty})` : ""}, ${degreeText(degree)}`;
          }
          let damage = 0;
          if (option.damage && multiplier > 0) {
            damage = Math.max(1, Math.floor(rollFormulaValue(option.damage) * multiplier));
            affected.hp = Math.max(0, affected.hp - damage);
            affected.defeated = affected.hp <= 0;
          }
          if (option.conditions.length && multiplier > 0) {
            for (const condition of option.conditions) {
              affected.conditions.set(condition.slug, Math.max(affected.conditions.get(condition.slug) ?? 0, condition.value));
            }
          }
          outcomes.push(`${outcome}${damage ? `; ${damage} ${option.damageType || ""} damage, HP ${affected.hp}/${affected.maxHp}` : ""}${option.conditions.length && multiplier > 0 ? `; ${option.conditions.map((condition) => `${condition.slug} ${condition.value}`).join(", ")}` : ""}`);
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

async function applyLiveDamage(target, formula, degree, multiplierOverride = null) {
  const before = actorHp(target.actor).value;
  const multiplier = multiplierOverride ?? (degree === 3 ? 2 : 1);
  const DamageRollClass = CONFIG.Dice.rolls?.find((RollClass) => RollClass.name === "DamageRoll");
  if (DamageRollClass && typeof target.actor.applyDamage === "function") {
    try {
      const damage = await new DamageRollClass(`{(${formula}) * ${multiplier}}`).evaluate();
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
      return Math.max(1, before - after);
    } catch (error) {
      console.warn(`${MODULE_ID} | PF2e damage application failed; using HP fallback.`, error);
    }
  }
  const rolled = Math.max(1, rollFormula(formula)) * multiplier;
  const after = Math.max(0, before - rolled);
  await target.actor.update({ "system.attributes.hp.value": after });
  target.hp = after;
  target.defeated = after <= 0;
  return Math.max(1, before - after);
}

async function applyLiveHealing(target, formula) {
  const hp = actorHp(target.actor);
  const amount = Math.max(1, rollFormula(formula));
  const after = Math.min(hp.max, hp.value + amount);
  await target.actor.update({ "system.attributes.hp.value": after });
  target.hp = after;
  target.maxHp = hp.max;
  target.defeated = false;
  return after - hp.value;
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

async function runLiveReplay(tokens, partyIds, enemyIds, {
  combat = game.combat,
  onLog = null,
  delay = game.settings.settings.has(`${MODULE_ID}.liveActionDelay`) ? game.settings.get(MODULE_ID, "liveActionDelay") : 1500,
} = {}) {
  const actionDelay = () => Math.max(100, Number(typeof delay === "function" ? delay() : delay) || 1500);
  const combatants = tokens
    .filter((token) => partyIds.has(token.id) || enemyIds.has(token.id))
    .map((token) => virtualCombatant(token, partyIds.has(token.id) ? "party" : "enemy"));
  const order = combatants.map((combatant) => {
    const tracked = combat?.combatants?.find((entry) => entry.tokenId === combatant.id);
    return { combatant, score: tracked?.initiative ?? rollDie(20) + combatant.initiative, tracked };
  }).sort((left, right) => right.score - left.score);
  const emit = async (text, kind = "action") => {
    await onLog?.({ text, kind, timestamp: Date.now() });
    if (game.settings.settings.has(`${MODULE_ID}.mirrorLiveToChat`) && game.settings.get(MODULE_ID, "mirrorLiveToChat")) {
      await ChatMessage.create({ speaker: { alias: "Lore Smith" }, content: `<p>${escapeHtml(text)}</p>` });
    }
  };
  await emit(`Initiative: ${order.map(({ combatant, score }) => `${combatant.name} ${score}`).join(", ")}.`, "round");
  for (let round = 1; round <= 20; round += 1) {
    if (combat) await combat.update({ round, turn: 0 });
    await emit(`Round ${round}`, "round");
    for (const entry of order) {
      const attacker = entry.combatant;
      if (attacker.defeated) continue;
      if (combat && entry.tracked) {
        const actualIndex = combat.turns.findIndex((candidate) => candidate.id === entry.tracked.id);
        if (actualIndex >= 0) await combat.update({ round, turn: actualIndex });
      }
      let actionsRemaining = 3;
      let map = 0;
      while (actionsRemaining > 0) {
        const choice = chooseCatalogAction(attacker, combatants, actionsRemaining, map);
        if (!choice) break;
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
        actionsRemaining -= cost;
        consumeUse(attacker, option);
        if (option.healing) {
          const restored = await applyLiveHealing(target, option.healing);
          await emit(`${attacker.name} uses ${option.name} on ${target.name}, restoring ${restored} HP; ${target.name} has ${target.hp}/${target.maxHp} HP.`, "heal");
          await pause(actionDelay());
          continue;
        }
        if (option.defensive && !option.damage) {
          const applied = await applyConditions(attacker, option.conditions);
          await emit(`${attacker.name} uses ${option.name}${applied.length ? ` and gains ${applied.join(", ")}` : ""}; ${actionsRemaining} action${actionsRemaining === 1 ? "" : "s"} remaining.`, "action");
          await pause(actionDelay());
          continue;
        }
        const targetList = actionTargets(option, target, combatants);
        let templateDocument = null;
        const templateSource = templateData(option, attacker.token.object, target.token.object);
        if (templateSource && canvas.scene) {
          const cleanTemplate = Object.fromEntries(Object.entries(templateSource).filter(([, value]) => value !== undefined));
          [templateDocument] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [cleanTemplate]);
        }
        const outcomes = [];
        for (const affected of targetList) {
          let multiplier = 0;
          let degree = 1;
          let outcome;
          if (option.save) {
            const natural = rollDie(20);
            const modifier = saveModifier(affected, option.save);
            const total = natural + modifier;
            degree = checkDegree(total, option.dc, natural);
            multiplier = [2, 1, 0.5, 0][degree];
            outcome = `${affected.name} rolls ${option.save}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs DC ${option.dc}, ${degreeText(degree)}`;
          } else if (option.automatic) {
            degree = 2;
            multiplier = 1;
            outcome = `${affected.name} is automatically affected`;
          } else {
            const natural = rollDie(20);
            const modifier = option.attack - (option.attackTrait ? map : 0);
            const dc = actorAc(affected.actor);
            const total = natural + modifier;
            degree = checkDegree(total, dc, natural);
            multiplier = degree === 3 ? 2 : degree === 2 ? 1 : 0;
            outcome = `${affected.name}: d20 ${natural} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} vs AC ${dc}, ${degreeText(degree)}`;
          }
          let damage = 0;
          if (option.damage && multiplier > 0) damage = await applyLiveDamage(affected, option.damage, degree, multiplier);
          const conditions = multiplier > 0 ? await applyConditions(affected, option.conditions) : [];
          outcomes.push(`${outcome}${damage ? `; ${damage} ${option.damageType || ""} damage, HP ${affected.hp}/${affected.maxHp}` : ""}${conditions.length ? `; ${conditions.join(", ")}` : ""}`);
          if (affected.defeated) {
            const trackedTarget = combat?.combatants?.find((candidate) => candidate.tokenId === affected.id);
            await trackedTarget?.update({ defeated: true });
          }
        }
        await emit(`${attacker.name} uses ${option.name}${option.kind === "spell" ? " (spell)" : ""}, spending ${cost} action${cost === 1 ? "" : "s"}: ${outcomes.join(" | ")}.`, option.damage ? "damage" : "action");
        target.token.object?.control({ releaseOthers: true });
        await canvas.animatePan({ x: target.token.object?.center.x, y: target.token.object?.center.y, duration: Math.min(500, actionDelay() / 3) });
        await pause(actionDelay());
        if (templateDocument) await templateDocument.delete();
        if (option.attackTrait) map += 5;
      }
      if (!combatants.some((candidate) => candidate.team === "party" && !candidate.defeated)
        || !combatants.some((candidate) => candidate.team === "enemy" && !candidate.defeated)) {
        const winner = combatants.some((candidate) => candidate.team === "party" && !candidate.defeated) ? "Characters" : "Opposition";
        await emit(`${winner} win the encounter.`, "victory");
        return;
      }
    }
  }
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
          content: `<p><strong>${attacker.name}</strong> uses <strong>${healing.name}</strong> on ${healingTarget.name}, restoring <strong>${restored} HP</strong>. ${healingTarget.name} has ${healingTarget.hp}/${healingTarget.maxHp} HP.</p>`,
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
          content += `<p>${target.name} takes <strong>${damage} damage</strong> and has ${target.hp}/${target.maxHp} HP.</p>`;
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

  activeTab = "notes";
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

  static async changeTab(event, target) {
    this.captureEncounterSelection();
    this.activeTab = target.dataset.tab;
    await this.render();
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
