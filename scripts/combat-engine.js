const CONDITION_NAMES = [
  "blinded", "clumsy", "confused", "controlled", "dazzled", "deafened", "doomed",
  "drained", "dying", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened",
  "grabbed", "immobilized", "off-guard", "paralyzed", "persistent damage", "prone",
  "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious",
  "wounded",
];

function numberValue(value, fallback = 0) {
  const result = Number(value?.value ?? value?.mod ?? value?.modifier ?? value);
  return Number.isFinite(result) ? result : fallback;
}

function plainText(html = "") {
  const container = document.createElement("div");
  container.innerHTML = String(html);
  return container.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeFormula(formula = "", actor = null) {
  let resolved = String(formula)
    .replace(/\[[a-z-]+(?:,[a-z-]+)*\]/gi, "")
    .replace(/@item\.rank/gi, String(actor?.level ?? actor?.system?.details?.level?.value ?? 1))
    .replace(/@item\.level/gi, String(actor?.level ?? actor?.system?.details?.level?.value ?? 1));
  try {
    resolved = Roll.replaceFormulaData(resolved, actor?.getRollData?.() ?? {}, { missing: "0" });
  } catch (_error) {
    resolved = resolved.replace(/@[a-z0-9_.]+/gi, "0");
  }
  return resolved.replace(/[{}]/g, "").trim() || "0";
}

function damageEntries(item) {
  const raw = item.system?.damage ?? {};
  const entries = raw.formula ? [raw] : Object.values(raw);
  const description = item.system?.description?.value ?? "";
  const inline = [...description.matchAll(/@Damage\[([^\]]+(?:\][^\]]*)?)]/gi)].map((match) => ({
    formula: match[1].replace(/\[[^\]]+]/g, ""),
    kinds: /\bheal/i.test(match[0]) ? ["healing"] : ["damage"],
    type: /\[([a-z-]+)]/i.exec(match[1])?.[1] ?? "",
  }));
  return [...entries, ...inline].filter((entry) => entry && (entry.formula || entry.dice));
}

function firstFormula(item, kind = "damage") {
  const entries = damageEntries(item);
  const matching = entries.find((entry) => {
    const kinds = [entry.kind, ...(entry.kinds ?? [])].filter(Boolean);
    const type = entry.type ?? entry.damageType ?? "";
    return kind === "healing"
      ? kinds.includes("healing") || type === "healing"
      : !kinds.includes("healing") && type !== "healing";
  });
  if (!matching) return "";
  if (matching.formula) return normalizeFormula(matching.formula, item.actor);
  if (matching.dice && matching.die) {
    return `${matching.dice}${matching.die}${numberValue(matching.modifier) ? `+${numberValue(matching.modifier)}` : ""}`;
  }
  return "";
}

function actionCosts(item) {
  const time = String(item.system?.time?.value ?? "").trim().toLowerCase();
  if (/1\s*(?:to|-)\s*3/.test(time)) return [1, 2, 3];
  const timeNumber = Number.parseInt(time, 10);
  if (Number.isFinite(timeNumber) && timeNumber > 0) return [Math.min(3, timeNumber)];
  const actionType = item.system?.actionType?.value;
  if (actionType === "action") return [Math.max(1, Math.min(3, numberValue(item.system?.actions, 1)))];
  if (actionType === "free") return [0];
  if (actionType === "reaction") return ["reaction"];
  return [];
}

function rangeFeet(item, description) {
  const explicit = String(item.system?.range?.value ?? item.system?.range ?? "");
  const match = `${explicit} ${description}`.match(/\b(\d+)\s*(?:-| )?feet\b/i);
  if (match) return Number(match[1]);
  if (/\btouch\b/i.test(explicit) || /\btouch\b/i.test(description)) return 5;
  return 5;
}

function saveType(description = "") {
  return /\breflex\b/i.test(description) ? "reflex"
    : /\bfortitude\b/i.test(description) ? "fortitude"
      : /\bwill\b/i.test(description) ? "will"
        : null;
}

function spellStatistic(actor, item) {
  const locationId = item.system?.location?.value;
  const entry = actor.spellcasting?.get?.(locationId) ?? actor.items?.get?.(locationId);
  const statistic = entry?.statistic ?? entry?.system?.statistic;
  const level = numberValue(actor.system?.details?.level, 0);
  return {
    attack: numberValue(statistic?.check, numberValue(entry?.system?.spelldc?.value, level + 7)),
    dc: numberValue(statistic?.dc, numberValue(entry?.system?.spelldc?.dc, level + 17)),
  };
}

function conditionData(description = "") {
  const normalized = description.toLowerCase();
  return CONDITION_NAMES.flatMap((name) => {
    if (!new RegExp(`\\b${name.replace("-", "[- ]")}\\b`, "i").test(normalized)) return [];
    const value = Number(new RegExp(`${name.replace("-", "[- ]")}\\s+(\\d+)`, "i").exec(normalized)?.[1] ?? 1);
    return [{ slug: name.replace("persistent damage", "persistent-damage"), value }];
  });
}

function frequencyUses(item) {
  const frequency = item.system?.frequency;
  if (frequency && Number.isFinite(Number(frequency.value))) return Math.max(0, Number(frequency.value));
  if (frequency && Number.isFinite(Number(frequency.max))) return Math.max(0, Number(frequency.max));
  const description = plainText(item.system?.description?.value);
  if (/\bonce per (?:day|hour|minute|round)\b/i.test(description)) return 1;
  return null;
}

function spellResource(item, actor, traits, description) {
  if (item.type !== "spell") return { limitedUses: frequencyUses(item), useKey: item.id };
  if (traits.includes("cantrip")) {
    const targetImmunity = /temporarily immune|can(?:not|'t) benefit again/i.test(description);
    return {
      limitedUses: targetImmunity ? 1 : null,
      useKey: targetImmunity ? `spell-immunity:${item.id}` : item.id,
    };
  }

  const location = item.system?.location ?? {};
  const entryId = location.value;
  const entry = actor.spellcasting?.get?.(entryId) ?? actor.items?.get?.(entryId);
  const mode = entry?.system?.prepared?.value ?? "";
  const rank = Math.max(1, numberValue(location.heightenedLevel, numberValue(item.system?.level, 1)));

  if (mode === "focus" || traits.includes("focus")) {
    const focus = actor.system?.resources?.focus;
    const available = numberValue(focus?.value, numberValue(focus?.max, 1));
    return { limitedUses: Math.max(0, available), useKey: "focus-pool" };
  }

  const innateUses = location.uses ?? item.system?.uses;
  if (innateUses && (Number.isFinite(Number(innateUses.value)) || Number.isFinite(Number(innateUses.max)))) {
    return {
      limitedUses: Math.max(0, numberValue(innateUses.value, numberValue(innateUses.max, 0))),
      useKey: `innate:${entryId ?? item.id}:${item.id}`,
    };
  }

  const slot = entry?.system?.slots?.[`slot${rank}`];
  if (mode === "prepared") {
    const prepared = [...(slot?.prepared ?? [])];
    const available = prepared.filter((candidate) =>
      candidate?.id === item.id && candidate?.expended !== true).length;
    return {
      limitedUses: available,
      useKey: `prepared:${entryId ?? "unknown"}:${rank}:${item.id}`,
    };
  }

  if (slot) {
    return {
      limitedUses: Math.max(0, numberValue(slot.value, numberValue(slot.max, 0))),
      useKey: `slots:${entryId ?? "unknown"}:${rank}`,
    };
  }

  return {
    limitedUses: Math.max(0, frequencyUses(item) ?? 0),
    useKey: `spell:${entryId ?? "unknown"}:${rank}:${item.id}`,
  };
}

function optionFromItem(item, actor) {
  const description = plainText(item.system?.description?.value);
  const costs = actionCosts(item);
  const damage = firstFormula(item, "damage");
  const healing = firstFormula(item, "healing");
  const conditions = conditionData(description);
  const traits = [...(item.system?.traits?.value ?? [])];
  const area = item.system?.area?.value
    ? { type: item.system.area.type ?? "burst", value: numberValue(item.system.area.value) }
    : null;
  const spell = item.type === "spell";
  const active = costs.length > 0;
  if (!active) return null;
  const statistic = spell ? spellStatistic(actor, item) : { attack: numberValue(actor.system?.attributes?.classDC?.mod, numberValue(actor.system?.details?.level, 0) + 7), dc: numberValue(actor.system?.attributes?.classDC?.dc, numberValue(actor.system?.details?.level, 0) + 17) };
  const save = saveType(description);
  const automatic = /\bautomatically hits?\b/i.test(description)
    || (!damage && !healing && !save && !traits.includes("attack"));
  const defensive = /\braise a shield|take cover|gain[^.]{0,30}(?:bonus|status bonus)[^.]{0,20}\bAC\b|\bshield\b/i.test(`${item.name} ${description}`) && !damage;
  const resource = spellResource(item, actor, traits, description);
  return {
    id: item.id,
    item,
    name: item.name,
    kind: spell ? "spell" : item.type === "consumable" ? "item" : "ability",
    costs,
    damage,
    healing,
    damageType: damageEntries(item).find((entry) => entry.formula === damage)?.type ?? traits.find((trait) => CONFIG.PF2E.damageTypes?.[trait]) ?? "",
    conditions,
    traits,
    range: rangeFeet(item, description),
    area,
    save,
    dc: statistic.dc,
    attack: statistic.attack,
    automatic,
    defensive,
    utility: !damage && !healing && !conditions.length,
    attackTrait: traits.includes("attack"),
    limitedUses: resource.limitedUses,
    useKey: resource.useKey,
    description,
  };
}

function strikeOptions(actor) {
  return [...(actor.system?.actions ?? [])].filter((action) => action.type === "strike").map((action) => {
    const damageRoll = Object.values(action.damageRolls ?? {})[0];
    const item = action.item;
    return {
      id: item?.id ?? action.slug ?? action.label,
      item,
      name: action.label ?? item?.name ?? "Strike",
      kind: "strike",
      costs: [1],
      damage: normalizeFormula(damageRoll?.formula ?? "1d4", actor),
      healing: "",
      damageType: item?.system?.damage?.damageType ?? "",
      conditions: [],
      traits: [...(item?.system?.traits?.value ?? [])],
      range: numberValue(action.range?.increment ?? item?.system?.range, 5),
      area: null,
      save: null,
      dc: 0,
      attack: numberValue(action.variants?.[0], numberValue(actor.system?.details?.level, 0) + 7),
      automatic: false,
      defensive: false,
      attackTrait: true,
      limitedUses: null,
      useKey: item?.id ?? action.slug ?? action.label,
      description: "",
    };
  });
}

export function buildActionCatalog(actor) {
  const options = [
    ...strikeOptions(actor),
    ...actor.items.map((item) => optionFromItem(item, actor)).filter(Boolean),
  ];
  const seen = new Set();
  return options.filter((option) => {
    const key = `${option.kind}:${option.name}:${option.damage}:${option.healing}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function chooseAction(actor, combatants, actionsRemaining, mapPenalty = 0) {
  let available = actor.options.filter((option) => {
    const minimumCost = Math.min(...option.costs.filter(Number.isFinite));
    const uses = actor.uses.get(option.useKey ?? option.id);
    return minimumCost <= actionsRemaining && (uses === undefined || uses > 0);
  });
  const varied = available.filter((option) =>
    option.kind === "strike" || !actor.turnUses?.has(option.id));
  available = varied;
  const injured = combatants
    .filter((candidate) => candidate.team === actor.team && !candidate.defeated && candidate.hp < candidate.maxHp)
    .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0];
  if (injured && injured.hp / injured.maxHp <= 0.6) {
    const healing = available.filter((option) => option.healing).sort((left, right) => averageFormula(right.healing) - averageFormula(left.healing))[0];
    if (healing) return { option: healing, target: injured, cost: Math.min(...healing.costs.filter(Number.isFinite)) };
  }
  const target = combatants.filter((candidate) => candidate.team !== actor.team && !candidate.defeated)
    .sort((left, right) => left.hp - right.hp)[0];
  if (!target) return null;
  const scored = available.map((option) => {
    const validCosts = option.costs.filter((cost) => Number.isFinite(cost) && cost <= actionsRemaining);
    const cost = Math.max(...validCosts);
    const areaTargets = option.area ? Math.min(3, combatants.filter((candidate) => candidate.team !== actor.team && !candidate.defeated).length) : 1;
    const expected = averageFormula(option.damage) * areaTargets;
    const conditionValue = option.conditions.length * 6;
    const defensiveValue = option.defensive && actor.hp / actor.maxHp < 0.55 ? 7 : 0;
    const utilityValue = option.utility ? 3 : 0;
    const mapCost = option.attackTrait ? mapPenalty / 2 : 0;
    const spellBias = option.kind === "spell" ? 8 : option.kind === "ability" ? 4 : option.kind === "item" ? 2 : 0;
    const repetitionPenalty = (actor.actionHistory?.get(option.id) ?? 0) * (option.kind === "strike" ? 0.25 : 2.5);
    return {
      option,
      target: option.defensive || option.utility ? actor : target,
      cost,
      score: (expected + conditionValue + defensiveValue + utilityValue + spellBias) / Math.max(1, cost)
        - mapCost - repetitionPenalty,
    };
  }).sort((left, right) => right.score - left.score);
  return scored[0] ?? null;
}

export function consumeUse(actor, option) {
  actor.turnUses?.add(option.id);
  actor.actionHistory?.set(option.id, (actor.actionHistory.get(option.id) ?? 0) + 1);
  if (option.limitedUses === null) return;
  const key = option.useKey ?? option.id;
  const remaining = actor.uses.get(key) ?? option.limitedUses;
  actor.uses.set(key, Math.max(0, remaining - 1));
}

export function rollFormulaValue(formula = "0") {
  const terms = String(formula).replace(/\s+/g, "").match(/[+-]?(?:\d+d\d+|\d+(?:\.\d+)?)/gi) ?? [];
  return Math.floor(terms.reduce((total, raw) => {
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    const dice = /^(\d+)d(\d+)$/i.exec(term);
    if (!dice) return total + sign * (Number(term) || 0);
    let rolled = 0;
    for (let index = 0; index < Number(dice[1]); index += 1) rolled += 1 + Math.floor(Math.random() * Number(dice[2]));
    return total + sign * rolled;
  }, 0));
}

export function averageFormula(formula = "0") {
  const terms = String(formula).replace(/\s+/g, "").match(/[+-]?(?:\d+d\d+|\d+(?:\.\d+)?)/gi) ?? [];
  return terms.reduce((total, raw) => {
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    const dice = /^(\d+)d(\d+)$/i.exec(term);
    return total + sign * (dice ? Number(dice[1]) * (Number(dice[2]) + 1) / 2 : Number(term) || 0);
  }, 0);
}

export function checkDegree(total, dc, natural) {
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) degree = Math.min(3, degree + 1);
  if (natural === 1) degree = Math.max(0, degree - 1);
  return degree;
}

export function degreeText(degree) {
  return ["critical failure", "failure", "success", "critical success"][degree] ?? "failure";
}

export function saveModifier(target, save) {
  return numberValue(target.actor?.system?.saves?.[save], numberValue(target.actor?.system?.details?.level, 0) + 5);
}

export function actionTargets(option, primaryTarget, combatants) {
  if (!option.area) return [primaryTarget];
  return combatants
    .filter((candidate) => candidate.team === primaryTarget.team && !candidate.defeated)
    .sort((left, right) => left.hp - right.hp)
    .slice(0, 3);
}

export function templateData(option, casterToken, targetToken) {
  if (!option.area || !casterToken || !targetToken) return null;
  const origin = casterToken.center;
  const target = targetToken.center;
  const direction = Math.atan2(target.y - origin.y, target.x - origin.x) * 180 / Math.PI;
  const type = option.area.type;
  const centeredOnTarget = type === "burst";
  return {
    t: type === "line" ? "ray"
      : type === "emanation" || type === "burst" ? "circle"
        : type === "square" || type === "cube" ? "rect"
          : type,
    x: centeredOnTarget ? target.x : origin.x,
    y: centeredOnTarget ? target.y : origin.y,
    distance: option.area.value,
    width: type === "line" ? 5 : undefined,
    angle: type === "cone" ? 90 : undefined,
    direction,
    fillColor: game.user.color ?? "#8b2d26",
    borderColor: "#f0bf62",
    flags: { "lore-smith": { temporary: true, action: option.name } },
  };
}

export async function applyConditions(target, conditions) {
  const applied = [];
  for (const condition of conditions) {
    try {
      const source = game.pf2e.ConditionManager.getCondition(condition.slug)?.toObject();
      if (!source) continue;
      delete source._id;
      if (condition.value > 1 && source.system?.value) source.system.value.value = condition.value;
      await target.actor.createEmbeddedDocuments("Item", [source]);
      applied.push(`${condition.slug}${condition.value > 1 ? ` ${condition.value}` : ""}`);
    } catch (error) {
      console.warn(`Lore Smith | Could not apply condition ${condition.slug}`, error);
    }
  }
  return applied;
}
