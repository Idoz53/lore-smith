const MODULE_ID = "lore-smith";

let flowLibrary = null;
let loadError = null;
let loadPromise = null;

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  if (typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function stateText(combatant) {
  const actor = combatant?.actor ?? combatant;
  const conditions = combatant?.conditions instanceof Map
    ? [...combatant.conditions.keys()]
    : collectionValues(actor?.conditions).map((condition) => condition.slug ?? condition.name);
  const effects = collectionValues(actor?.items)
    .filter((item) => ["effect", "condition", "feat", "action"].includes(item.type))
    .map((item) => item.name);
  return [...conditions, ...effects].filter(Boolean).join(" ").toLowerCase();
}

function hasState(combatant, pattern) {
  return pattern.test(stateText(combatant));
}

function optionText(option) {
  return [option?.name, option?.kind, ...(option?.traits ?? []), option?.description]
    .filter(Boolean).join(" ").toLowerCase();
}

function addTextTags(tags, text, knownTags) {
  for (const tag of knownTags) {
    const phrase = tag.replace(/-/g, " ");
    if (text.includes(phrase) || text.includes(tag)) tags.add(tag);
  }
}

export async function initializeDecisionFlows({ data = null } = {}) {
  if (data) {
    flowLibrary = data;
    loadError = null;
    return flowLibrary;
  }
  if (flowLibrary) return flowLibrary;
  loadPromise ??= (async () => {
    try {
      const response = await fetch(`modules/${MODULE_ID}/data/ai-decision-flowcharts.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      flowLibrary = await response.json();
      loadError = null;
    } catch (error) {
      loadError = error;
      console.warn(`${MODULE_ID} | Could not load the tactical flowchart library.`, error);
    } finally {
      loadPromise = null;
    }
    return flowLibrary;
  })();
  return loadPromise;
}

export function decisionFlowStatus() {
  return {
    loaded: Boolean(flowLibrary),
    schema: flowLibrary?.schema ?? null,
    classes: Object.keys(flowLibrary?.classes ?? {}).length,
    error: loadError?.message ?? null,
  };
}

export function getClassDecisionFlow(classSlug) {
  return flowLibrary?.classes?.[slug(classSlug)] ?? null;
}

export function getGeneralDecisionFlow() {
  return flowLibrary?.general ?? null;
}

export function optionDecisionTags(option, flow = null) {
  const tags = new Set();
  const text = optionText(option);
  const knownTags = new Set([
    ...Object.keys(flow?.weights ?? {}),
    ...(flow?.conditional_rules ?? []).map((rule) => rule.tag),
  ]);
  addTextTags(tags, text, knownTags);

  tags.add(slug(option?.kind || "action"));
  if (option?.kind === "strike") tags.add("strike");
  if (option?.kind === "spell") tags.add("spell");
  if (option?.kind === "skill") tags.add("skill");
  if (option?.damage) tags.add("damage");
  if (option?.healing) tags.add("healing");
  if (option?.healing && option?.area) tags.add("area-heal");
  if (option?.area) tags.add("area");
  if (option?.conditions?.length || option?.conditionOperations?.length) tags.add("control");
  if (option?.defensive) tags.add("protection");
  if (option?.utility) tags.add("support");
  if (option?.range > 10) tags.add("ranged");
  if (option?.range <= 10 && (option?.kind === "strike" || option?.attackTrait)) tags.add("melee");
  if (option?.traits?.includes("cantrip")) tags.add("cantrip");
  if (option?.traits?.includes("concentrate")) tags.add("concentrate");
  if (option?.costs?.includes("reaction")) tags.add("reaction");
  if (/raise (?:a )?shield/.test(text)) tags.add("raise-shield");
  if (/stabili[sz]e/.test(text)) tags.add("stabilize");
  if (/demoralize/.test(text)) tags.add("demoralize");
  if (/feint/.test(text)) tags.add("feint");
  if (/tumble through/.test(text)) tags.add("tumble");
  if (/trip|grapple|shove/.test(text)) tags.add("athletics");
  if (/off.guard|prone|grabbed/.test(text)) tags.add("off-guard");
  return [...tags].filter(Boolean);
}

function isCritical(combatant) {
  return combatant && combatant.maxHp > 0 && combatant.hp / combatant.maxHp <= 0.3;
}

function isDying(combatant) {
  return Boolean(combatant && (combatant.hp <= 0 || hasState(combatant, /\bdying\b/)));
}

function estimateHitChance(option, target, mapPenalty = 0) {
  if (!option?.attackTrait || !target) return null;
  const attack = Number(option.attack) - Number(mapPenalty || 0);
  const ac = Number(target.ac ?? target.actor?.system?.attributes?.ac?.value ?? target.actor?.system?.attributes?.ac ?? 10);
  if (!Number.isFinite(attack) || !Number.isFinite(ac)) return null;
  return Math.max(0.05, Math.min(0.95, (21 - (ac - attack)) / 20));
}

export function buildDecisionContext({
  actor,
  combatants = [],
  target = null,
  available = [],
  actionsRemaining = 3,
  mapPenalty = 0,
  round = 1,
  remainingUses = null,
} = {}) {
  const allies = combatants.filter((candidate) => candidate.team === actor?.team && candidate !== actor && !candidate.defeated);
  const enemies = combatants.filter((candidate) => candidate.team !== actor?.team && !candidate.defeated);
  const actorState = stateText(actor);
  const targetState = stateText(target);
  const healingAvailable = available.some((option) => Boolean(option.healing));
  const flags = new Set();
  const set = (name, value) => value && flags.add(name);

  set("ally_dying", allies.some(isDying));
  set("ally_critical", allies.some(isCritical));
  set("healing_available", healingAvailable);
  set("last_action", actionsRemaining === 1);
  set("attack_one_plus", mapPenalty >= 5);
  set("target_off_guard", /off.guard|prone|grabbed|restrained/.test(targetState));
  set("target_not_off_guard", target && !flags.has("target_off_guard"));
  set("safe_flank_available", enemies.length === 1 && allies.length > 0);
  set("clustered_enemies", enemies.length >= 2);
  set("many_allies_in_area", allies.length >= 2);
  set("resource_low", remainingUses !== null && remainingUses !== undefined && remainingUses <= 1);
  set("missing_panache", !/panache/.test(actorState));
  set("has_panache", /panache/.test(actorState));
  set("missing_rage", !/\brage\b/.test(actorState));
  set("missing_stance", !/\bstance\b/.test(actorState));
  set("channel_inactive", !/channel elements/.test(actorState));
  set("missing_overdrive", !/overdrive/.test(actorState));
  set("spellstrike_empty", /spellstrike.*recharge|recharge spellstrike/.test(actorState));
  set("spellstrike_ready", !flags.has("spellstrike_empty"));
  set("composition_inactive", !/composition/.test(actorState));
  set("hex_inactive", !/\bhex\b/.test(actorState));
  set("psyche_unleashed", /unleash psyche|unleashed psyche/.test(actorState));
  set("battle_form_active", /battle form|wild shape|pest form/.test(actorState));
  set("eidolon_unmanifested", /eidolon/.test(actorState) && /unmanifest/.test(actorState));
  set("shared_actions_three", actionsRemaining === 3);
  set("target_marked", /hunted prey|hunt prey/.test(targetState));
  set("target_unmarked", target && !flags.has("target_marked"));
  set("effect_needs_sustain", available.some((option) => /sustain/.test(optionText(option))));
  set("clear_shot", true);

  return {
    actor,
    target,
    allies,
    enemies,
    available,
    actionsRemaining,
    mapPenalty,
    round,
    remainingUses,
    flags,
    hitChance: null,
  };
}

export function scoreDecisionFlow(profile, option, context = {}) {
  const flow = profile?.flow ?? getClassDecisionFlow(profile?.classSlug ?? profile?.slug);
  const tags = optionDecisionTags(option, flow);
  const tagSet = new Set(tags);
  const decision = buildDecisionContext({ ...context, available: context.available ?? [] });
  decision.hitChance = estimateHitChance(option, context.target, context.mapPenalty);
  if (context.mapPenalty === 0 && option?.attackTrait) tagSet.add("first-attack");
  if (context.mapPenalty >= 10 && option?.attackTrait) tagSet.add("third-attack");

  let score = 0;
  const matched = [];
  for (const [tag, weight] of Object.entries(flow?.weights ?? {})) {
    if (!tagSet.has(tag)) continue;
    const value = Number(weight) * 0.15;
    score += value;
    matched.push({ source: "class", tag, value });
  }
  for (const rule of flow?.conditional_rules ?? []) {
    if (!decision.flags.has(rule.when) || !tagSet.has(rule.tag)) continue;
    const value = Number(rule.weight) * 0.25;
    score += value;
    matched.push({ source: rule.when, tag: rule.tag, value });
  }
  if (decision.flags.has("missing_panache") && tagSet.has("finisher")) {
    score -= 40;
    matched.push({ source: "class:finisher-requires-panache", tag: "finisher", value: -40 });
  }

  if (option?.attackTrait && context.mapPenalty >= 10) {
    const penalty = decision.hitChance !== null && decision.hitChance >= 0.55 ? -5 : -28;
    score += penalty;
    matched.push({ source: "general:third-attack", tag: "attack", value: penalty });
  }
  if (option?.defensive && context.actionsRemaining === 1) {
    score += 10;
    matched.push({ source: "general:last-action-defense", tag: "protection", value: 10 });
  }
  if (option?.kind === "skill" && context.mapPenalty < 10) {
    score += 3;
    matched.push({ source: "general:trained-skill", tag: "skill", value: 3 });
  }
  const damageActions = Number(context.actor?.damageActionsThisTurn ?? 0);
  const utilityActions = Number(context.actor?.utilityActionsThisTurn ?? 0);
  if (option?.damage && damageActions === 0) {
    score += 9;
    matched.push({ source: "general:deal-damage", tag: "damage", value: 9 });
  }
  if (!option?.damage && !option?.healing && utilityActions >= 1) {
    score -= 18;
    matched.push({ source: "general:avoid-utility-spam", tag: "utility", value: -18 });
  }
  if (option?.defensive && context.actionsRemaining > 1 && damageActions === 0) {
    score -= 9;
    matched.push({ source: "general:defend-after-offense", tag: "protection", value: -9 });
  }
  if (context.target && /off.guard|prone|grabbed|restrained/.test(stateText(context.target)) && option?.damage) {
    score += 5;
    matched.push({ source: "general:off-guard", tag: "damage", value: 5 });
  }
  return { score, tags: [...tagSet], matched, flags: [...decision.flags] };
}

export function decisionFlowCoverage(profile, options = []) {
  const flow = profile?.flow ?? getClassDecisionFlow(profile?.classSlug ?? profile?.slug);
  const weightedTags = new Set([
    ...Object.keys(flow?.weights ?? {}),
    ...(flow?.conditional_rules ?? []).map((rule) => rule.tag),
  ]);
  const optionTags = new Set(options.flatMap((option) => optionDecisionTags(option, flow)));
  return {
    loaded: Boolean(flowLibrary),
    general: getGeneralDecisionFlow()?.id ?? null,
    classFlow: flow?.id ?? null,
    className: flow?.name ?? profile?.label ?? "Independent combatant",
    positioning: flow?.positioning ?? null,
    matchedTags: [...weightedTags].filter((tag) => optionTags.has(tag)),
    unavailableTags: [...weightedTags].filter((tag) => !optionTags.has(tag)),
    optionCount: options.length,
  };
}
