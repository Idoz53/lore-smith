import { attachSimulationAdapters, buildCoverageReport } from "./simulation-adapters.js";
import { getTacticalProfile, tacticalOptionScore } from "./tactical-profiles.js";

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

function spellStatistic(actor, item) {
  const locationId = item.system?.location?.value;
  const entry = actor.spellcasting?.get?.(locationId) ?? actor.items?.get?.(locationId);
  const statistic = entry?.statistic ?? entry?.system?.statistic;
  const level = numberValue(actor.system?.details?.level, 0);
  return {
    attack: numberValue(statistic?.check, numberValue(entry?.system?.spelldc?.value, level + 7)),
    dc: numberValue(statistic?.dc, numberValue(entry?.system?.spelldc?.dc, level + 17)),
    nativeStatistic: statistic ?? null,
  };
}

function structuredSave(item) {
  return item.system?.defense?.save?.statistic ?? item.system?.save?.value ?? null;
}

function uuidReferences(description = "") {
  return [...String(description).matchAll(/@UUID\[([^\]]+)](?:\{([^}]+)})?/gi)].map((match) => ({
    uuid: match[1],
    label: match[2] ?? match[1].split(".").at(-1),
    index: match.index ?? 0,
  }));
}

/**
 * Interpret only explicit operations surrounding a linked PF2e condition.
 * Merely mentioning a condition never applies it: this prevents future,
 * prerequisite, and explanatory text from becoming an immediate effect.
 */
function linkedConditionOperations(description = "") {
  return uuidReferences(description).flatMap((reference) => {
    if (!/conditionitems\.Item\./i.test(reference.uuid)) return [];
    const before = String(description).slice(Math.max(0, reference.index - 110), reference.index)
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
    const slug = reference.uuid.split(".").at(-1).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (/(?:target|creature|ally|enemy|you)\s+(?:also\s+)?(?:loses?|removes?|reduces?)[^.]{0,55}$/.test(before)) {
      return [{ operation: "remove", slug, value: 1, target: /\byou\b/.test(before) ? "self" : "target" }];
    }
    if (/(?:target|creature|ally|enemy|you)\s+(?:also\s+)?(?:gains?|becomes?|is made)[^.]{0,55}$/.test(before)) {
      return [{ operation: "apply", slug, value: 1, target: /\byou\b/.test(before) ? "self" : "target" }];
    }
    return [];
  });
}

function structuredSelfEffect(item) {
  const effect = item.system?.selfEffect;
  return effect?.uuid ? { uuid: effect.uuid, name: effect.name ?? item.name, target: "self" } : null;
}

function structuredRequirements(item, rawDescription = "") {
  const description = plainText(rawDescription);
  const embedded = /\bRequirements?\b(.+?)(?:\bEffect\b|$)/i.exec(description)?.[1] ?? "";
  const text = `${item.system?.requirements ?? ""} ${embedded}`.trim();
  const conditionLinks = uuidReferences(rawDescription).filter((reference) =>
    /conditionitems\.Item\./i.test(reference.uuid)
    && reference.index <= String(rawDescription).search(/<strong>Effect<\/strong>|\bEffect\b/i));
  const forbiddenConditions = /\b(?:neither|not|isn't|is not|without|no)\b/i.test(text)
    ? conditionLinks.map((reference) => reference.uuid.split(".").at(-1).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    : [];
  return {
    text,
    requiresDamageTaken: /\bhas taken damage\b/i.test(text),
    forbiddenConditions,
  };
}

function frequencyUses(item) {
  const frequency = item.system?.frequency;
  if (frequency && Number.isFinite(Number(frequency.value))) return Math.max(0, Number(frequency.value));
  if (frequency && Number.isFinite(Number(frequency.max))) return Math.max(0, Number(frequency.max));
  const description = plainText(item.system?.description?.value);
  if (/\bonce per (?:day|hour|minute|round)\b/i.test(description)) return 1;
  return null;
}

function rechargeData(description = "") {
  const match = description.match(
    /(?:can't|cannot)\s+use[^.]{0,80}again\s+for\s+(\d+d\d+|\d+)\s+rounds?|recharge(?:s|d)?[^.]{0,40}(\d+d\d+|\d+)\s+rounds?/i,
  );
  const formula = match?.[1] ?? match?.[2];
  return formula ? { formula } : null;
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
  const rank = Math.max(1, numberValue(location.heightenedLevel, numberValue(item.rank, numberValue(item.system?.level, 1))));

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
  if (mode === "prepared" && !entry?.isFlexible) {
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
  const rawDescription = item.system?.description?.value ?? "";
  const description = plainText(rawDescription);
  const costs = actionCosts(item);
  const damage = firstFormula(item, "damage");
  const healing = firstFormula(item, "healing");
  const conditionOperations = linkedConditionOperations(rawDescription);
  // Item-linked condition changes are executed from conditionOperations so
  // their direction (apply/remove and self/target) cannot be lost.
  const conditions = [];
  const selfEffect = structuredSelfEffect(item);
  const requirements = structuredRequirements(item, rawDescription);
  const unresolvedConditionLinks = uuidReferences(rawDescription).filter((reference) =>
    /conditionitems\.Item\./i.test(reference.uuid)
    && !conditionOperations.some((operation) => reference.uuid.toLowerCase().endsWith(`.${operation.slug}`)));
  const unresolvedEffectLinks = uuidReferences(rawDescription).filter((reference) =>
    /(?:spell-effects|bestiary-effects|equipment-effects)\.Item\./i.test(reference.uuid)
    && reference.uuid !== selfEffect?.uuid);
  const mechanicsWarnings = [
    selfEffect ? "Linked self-effect Rule Elements apply natively in live combat; Monte Carlo records the effect but may not reproduce every modifier" : "",
    unresolvedConditionLinks.length ? `${unresolvedConditionLinks.length} mentioned condition link(s) are explanatory or not an explicit apply/remove operation` : "",
    unresolvedEffectLinks.length ? `${unresolvedEffectLinks.length} linked effect document(s) require timing or choice not declared by this item` : "",
  ].filter(Boolean);
  const traits = [...(item.system?.traits?.value ?? [])];
  const area = item.system?.area?.value
    ? { type: item.system.area.type ?? "burst", value: numberValue(item.system.area.value) }
    : null;
  const spell = item.type === "spell";
  const active = costs.length > 0;
  if (!active) return null;
  const statistic = spell ? spellStatistic(actor, item) : { attack: numberValue(actor.system?.attributes?.classDC?.mod, numberValue(actor.system?.details?.level, 0) + 7), dc: numberValue(actor.system?.attributes?.classDC?.dc, numberValue(actor.system?.details?.level, 0) + 17) };
  const save = structuredSave(item);
  const basicSave = Boolean(item.system?.defense?.save?.basic);
  const automatic = /\bautomatically hits?\b/i.test(description)
    || Boolean(selfEffect)
    || Boolean(conditionOperations.length && !save && !traits.includes("attack"));
  // Item prose alone is not enough to infer a defensive state. Native system
  // actions and linked self-effect documents are handled elsewhere.
  const defensive = false;
  const resource = spellResource(item, actor, traits, description);
  const resolvableRoll = traits.includes("attack") || !save || basicSave;
  const explicitMechanic = Boolean(
    healing || selfEffect || conditionOperations.length || defensive
    || (damage && resolvableRoll),
  );
  const targetText = String(item.system?.target?.value ?? "").toLowerCase();
  const targetRequirement = /\bdying\b/.test(targetText) ? "dying"
    : /\bundead\b/.test(targetText) && !/\b(?:living|willing)\b/.test(targetText) ? "undead"
      : null;
  const targetMode = selfEffect ? "self"
    : targetRequirement === "undead" ? "enemy"
    : healing || traits.includes("healing") || /\b(?:willing|ally|allies)\b/.test(targetText) ? "ally"
      : /\bself\b/.test(targetText) ? "self"
        : "enemy";
  return {
    id: `${item.id}:${[...(item.appliedOverlays?.values?.() ?? [])].join("+") || "base"}`,
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
    basicSave,
    dc: statistic.dc,
    attack: statistic.attack,
    nativeStatistic: statistic.nativeStatistic ?? null,
    automatic,
    supportedResolution: explicitMechanic,
    unsupportedReason: explicitMechanic ? ""
      : save && !basicSave ? "Non-basic save outcomes require a dedicated structured PF2e effect"
        : "No structured PF2e roll, damage, healing, effect, or condition operation",
    selfEffect,
    mechanicsWarnings,
    requirements,
    conditionOperations,
    targetMode,
    targetRequirement,
    defensive,
    utility: !damage && !healing && !conditions.length,
    attackTrait: traits.includes("attack"),
    limitedUses: resource.limitedUses,
    useKey: resource.useKey,
    recharge: rechargeData(description),
    targetOnce: Boolean(selfEffect) || /temporarily immune|can't be affected again|cannot be affected again/i.test(description),
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
      nativeAction: action,
      nativeStatistic: null,
      limitedUses: null,
      useKey: item?.id ?? action.slug ?? action.label,
      description: "",
      supportedResolution: true,
      selfEffect: null,
      conditionOperations: [],
      targetMode: "enemy",
      targetRequirement: null,
      requirements: { text: "", requiresDamageTaken: false, forbiddenConditions: [] },
    };
  });
}

function optionsFromItem(item, actor) {
  if (item.type !== "spell") return [optionFromItem(item, actor)].filter(Boolean);
  const variants = [...(item.overlays?.overrideVariants ?? [])];
  const documents = variants.length ? variants : [item];
  return documents.map((variant) => optionFromItem(variant, actor)).filter(Boolean);
}

function actorStatistic(actor, statistic) {
  return actor.getStatistic?.(statistic) ?? actor.skills?.[statistic] ?? null;
}

function statisticRank(statistic) {
  return numberValue(statistic?.rank, numberValue(statistic?.proficient, 0));
}

function systemActionOptions(actor) {
  const definitions = [
    { slug: "demoralize", name: "Demoralize", skill: "intimidation", defense: "will", range: 30, condition: "frightened", map: false },
    { slug: "trip", name: "Trip", skill: "athletics", defense: "reflex", range: 5, condition: "prone", map: true },
    { slug: "grapple", name: "Grapple", skill: "athletics", defense: "fortitude", range: 5, condition: "grabbed", map: true },
    { slug: "shove", name: "Shove", skill: "athletics", defense: "fortitude", range: 5, condition: null, map: true },
    { slug: "feint", name: "Feint", skill: "deception", defense: "perception", range: 5, condition: "off-guard", map: false },
    { slug: "tumble-through", name: "Tumble Through", skill: "acrobatics", defense: "reflex", range: 5, condition: null, map: false },
  ];
  const actions = definitions.flatMap((definition) => {
    const statistic = actorStatistic(actor, definition.skill);
    if (!statistic || statisticRank(statistic) < 1) return [];
    return [{
      id: `pf2e-action:${definition.slug}`,
      item: null,
      name: definition.name,
      kind: "skill",
      costs: [1],
      damage: "",
      healing: "",
      damageType: "",
      conditions: definition.condition ? [{ slug: definition.condition, value: 1 }] : [],
      traits: definition.map ? ["attack", "skill"] : ["skill"],
      range: definition.range,
      area: null,
      save: null,
      defenseStatistic: definition.defense,
      checkStatistic: definition.skill,
      dc: 0,
      attack: numberValue(statistic?.check, numberValue(statistic, 0)),
      automatic: false,
      defensive: false,
      utility: !definition.condition,
      attackTrait: definition.map,
      limitedUses: null,
      useKey: `pf2e-action:${definition.slug}`,
      recharge: null,
      targetOnce: definition.slug === "demoralize",
      nativeStatistic: statistic,
      nativeSystemAction: game.pf2e?.actions?.get?.(definition.slug) ?? null,
      description: `${definition.name} uses ${definition.skill} against ${definition.defense}.`,
      supportedResolution: true,
      selfEffect: null,
      conditionOperations: [],
      targetMode: "enemy",
      targetRequirement: null,
      requirements: { text: "", requiresDamageTaken: false, forbiddenConditions: [] },
    }];
  });

  const shield = actor.items?.find?.((item) =>
    item.type === "shield" || item.type === "armor" && item.system?.category === "shield");
  if (shield) {
    actions.push({
      id: "pf2e-action:raise-a-shield",
      item: shield,
      name: "Raise a Shield",
      kind: "skill",
      costs: [1],
      damage: "",
      healing: "",
      damageType: "",
      conditions: [],
      traits: [],
      range: 0,
      area: null,
      save: null,
      dc: 0,
      attack: 0,
      automatic: true,
      defensive: true,
      utility: false,
      attackTrait: false,
      limitedUses: null,
      useKey: "pf2e-action:raise-a-shield",
      nativeStatistic: null,
      nativeSystemAction: game.pf2e?.actions?.get?.("raise-a-shield") ?? null,
      description: "Raise the equipped shield and gain its circumstance bonus to AC.",
      supportedResolution: true,
      selfEffect: null,
      conditionOperations: [],
      targetMode: "self",
      targetRequirement: null,
      requirements: { text: "", requiresDamageTaken: false, forbiddenConditions: [] },
    });
  }
  return actions;
}

export function buildActionCatalog(actor) {
  const options = [
    ...strikeOptions(actor),
    ...systemActionOptions(actor),
    ...[...actor.items].flatMap((item) => optionsFromItem(item, actor)),
  ];
  const seen = new Set();
  return options.filter((option) => {
    const key = `${option.kind}:${option.id}:${option.name}:${option.costs.join("/")}:${option.range}:${option.area?.type ?? ""}:${option.area?.value ?? ""}:${option.damage}:${option.healing}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(attachSimulationAdapters);
}

export function chooseAction(actor, combatants, actionsRemaining, mapPenalty = 0, round = 1) {
  const meetsRequirements = (option) => {
    if (option.requirements?.requiresDamageTaken && actor.hp >= actor.maxHp) return false;
    if (option.requirements?.forbiddenConditions?.some((condition) => actor.conditions?.has(condition))) return false;
    if (option.selfEffect) {
      const effectKey = `effect:${String(option.selfEffect.name ?? option.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (actor.conditions?.has(effectKey)) return false;
      if (actor.actor?.items?.some?.((item) => item.type === "effect" && item.name === option.selfEffect.name)) return false;
    }
    return true;
  };
  const validTargetFor = (option, candidate) => {
    if (!candidate) return false;
    const canRestoreDefeated = Boolean(option.healing || option.traits?.includes("healing"));
    if (candidate.defeated && option.targetRequirement !== "dying" && !canRestoreDefeated) return false;
    if (option.targetRequirement === "dying") return candidate.conditions?.has("dying") || candidate.hp <= 0;
    if (option.targetRequirement === "undead") return candidate.actor?.traits?.has?.("undead")
      || candidate.actor?.system?.traits?.value?.includes?.("undead");
    return true;
  };
  let available = actor.options.filter((option) => {
    const minimumCost = Math.min(...option.costs.filter(Number.isFinite));
    const uses = actor.uses.get(option.useKey ?? option.id);
    const cooldown = actor.cooldowns?.get(option.useKey ?? option.id) ?? 0;
    return option.supportedResolution !== false && meetsRequirements(option)
      && minimumCost <= actionsRemaining && cooldown <= 0 && (uses === undefined || uses > 0);
  });
  const varied = available.filter((option) =>
    option.kind === "strike" || !actor.turnUses?.has(option.id));
  available = varied;
  const injured = combatants
    .filter((candidate) => candidate.team === actor.team && candidate.hp < candidate.maxHp)
    .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0];
  const profile = actor.profile ?? getTacticalProfile(actor.actor);
  if (injured && injured.hp / injured.maxHp <= (profile.healingThreshold ?? 0.6)) {
    const healing = available.filter((option) => option.healing).sort((left, right) => averageFormula(right.healing) - averageFormula(left.healing))[0];
    if (healing) return {
      option: healing,
      target: injured,
      cost: Math.min(...healing.costs.filter(Number.isFinite)),
      decision: { stage: "general:emergency-rescue", tags: ["healing"], flags: [injured.hp <= 0 ? "ally_dying" : "ally_critical"] },
    };
  }
  const target = combatants.filter((candidate) => candidate.team !== actor.team && !candidate.defeated)
    .sort((left, right) => left.hp - right.hp)[0];
  if (!target) return null;
  const scored = available.flatMap((option) => {
    const allies = combatants.filter((candidate) => candidate.team === actor.team && validTargetFor(option, candidate));
    const enemies = combatants.filter((candidate) => candidate.team !== actor.team && validTargetFor(option, candidate));
    const optionTargets = option.targetMode === "self" || option.defensive ? [actor]
      : option.targetMode === "ally"
        ? allies
        : enemies;
    if (!optionTargets.length) return [];
    const validCosts = option.costs.filter((cost) => Number.isFinite(cost) && cost <= actionsRemaining);
    const cost = Math.max(...validCosts);
    const areaTargets = option.area ? Math.min(3, combatants.filter((candidate) => candidate.team !== actor.team && !candidate.defeated).length) : 1;
    const expected = averageFormula(option.damage) * areaTargets;
    const conditionValue = (option.conditions.length + (option.selfEffect ? 1 : 0) + (option.conditionOperations?.length ?? 0)) * 4;
    const defensiveValue = option.defensive && actor.hp / actor.maxHp < 0.55 ? 7 : 0;
    const utilityValue = option.utility ? 1 : 0;
    const mapCost = option.attackTrait ? mapPenalty / 2 : 0;
    const hasConcreteOutcome = Boolean(option.damage || option.healing || option.conditions?.length
      || option.selfEffect || option.conditionOperations?.length);
    const spellBias = option.kind === "spell" ? hasConcreteOutcome ? 6 : 1
      : option.kind === "ability" ? hasConcreteOutcome ? 3 : 0
        : option.kind === "item" ? hasConcreteOutcome ? 2 : 0 : 0;
    const repetitionPenalty = (actor.actionHistory?.get(option.id) ?? 0) * (option.kind === "strike" ? 0.25 : 2.5);
    const remainingUses = option.limitedUses === null
      ? null
      : actor.uses.get(option.useKey ?? option.id) ?? option.limitedUses;
    return optionTargets.map((optionTarget) => {
      const decisionTrace = [];
      const profileValue = tacticalOptionScore(profile, option, {
        actor,
        target: optionTarget,
        combatants,
        available,
        round,
        remainingUses,
        actionsRemaining,
        mapPenalty,
        decisionTrace,
      });
      const targetImmunityPenalty = option.targetOnce && actor.targetUses?.has(`${option.id}:${optionTarget.id}`)
        ? 1000
        : 0;
      const redundantConditionPenalty = option.conditions?.length
        && option.conditions.every((condition) => optionTarget.conditions?.has?.(condition.slug))
        ? 80
        : 0;
      const hpRatio = optionTarget.hp / Math.max(1, optionTarget.maxHp);
      const targetValue = option.healing ? (1 - hpRatio) * 18 : option.damage ? (1 - hpRatio) * 3 : 0;
      return {
        option,
        target: optionTarget,
        cost,
        decision: decisionTrace[0] ?? null,
        score: (expected + conditionValue + defensiveValue + utilityValue + spellBias) / Math.max(1, cost)
          - mapCost - repetitionPenalty + profileValue + targetValue - targetImmunityPenalty - redundantConditionPenalty,
      };
    });
  }).filter(Boolean).sort((left, right) => right.score - left.score);
  return scored[0] ?? null;
}

export function consumeUse(actor, option, target = null) {
  actor.turnUses?.add(option.id);
  actor.actionHistory?.set(option.id, (actor.actionHistory.get(option.id) ?? 0) + 1);
  if (target && option.targetOnce) actor.targetUses?.add(`${option.id}:${target.id}`);
  if (option.recharge) {
    actor.cooldowns?.set(option.useKey ?? option.id, Math.max(1, rollFormulaValue(option.recharge.formula)));
  }
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

export function actionTargets(option, primaryTarget, combatants, isInsideArea = null) {
  if (!option.area) return [primaryTarget];
  const candidates = combatants
    .filter((candidate) => candidate.team === primaryTarget.team && !candidate.defeated);
  if (typeof isInsideArea === "function") return candidates.filter(isInsideArea);
  return candidates
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
      const conditionDocument = game.pf2e.ConditionManager.getCondition(condition.slug);
      if (!conditionDocument) {
        console.warn(`Lore Smith | Ignoring unknown PF2e condition ${condition.slug}.`);
        continue;
      }
      if (typeof target.actor.increaseCondition === "function") {
        await target.actor.increaseCondition(condition.slug, { value: condition.value });
        applied.push(`${condition.slug}${condition.value > 1 ? ` ${condition.value}` : ""}`);
        continue;
      }
      const source = conditionDocument.toObject();
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

export function actionCoverageReport(tokens, partyIds = null, enemyIds = null) {
  return buildCoverageReport(tokens, partyIds, enemyIds, buildActionCatalog);
}
