import { getTacticalProfile, tacticalDecisionCoverage } from "./tactical-profiles.js";

const ADAPTER_LABELS = {
  "attack-check": "Attack checks",
  "skill-action": "Skill actions",
  "save-check": "Saving throws",
  "automatic-effect": "Automatic effects",
  damage: "Damage",
  iwr: "Immunities, weaknesses, resistances",
  healing: "Healing",
  condition: "Conditions",
  "persistent-damage": "Persistent damage",
  area: "Areas and templates",
  resource: "Spell slots, focus, frequency",
  recharge: "Recharge timers",
  defense: "Defensive effects",
  utility: "Utility actions",
};

function finite(value) {
  return Number.isFinite(Number(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function attachSimulationAdapters(option) {
  const adapters = [];
  if (option.checkStatistic) adapters.push("skill-action");
  if (option.save) adapters.push("save-check");
  else if (option.automatic) adapters.push("automatic-effect");
  else if (option.attackTrait || option.kind === "strike") adapters.push("attack-check");
  if (option.damage) adapters.push("damage", "iwr");
  if (option.healing) adapters.push("healing");
  if (option.conditions?.length) adapters.push("condition");
  if (option.selfEffect || option.conditionOperations?.length) adapters.push("condition");
  if (option.conditions?.some((condition) => condition.slug === "persistent-damage")) {
    adapters.push("persistent-damage");
  }
  if (option.area) adapters.push("area");
  if (option.limitedUses !== null) adapters.push("resource");
  if (option.recharge) adapters.push("recharge");
  if (option.defensive) adapters.push("defense");
  if (option.utility) adapters.push("utility");

  const unsupported = [];
  if (!option.costs?.some(Number.isFinite)) unsupported.push("No supported action cost");
  if (option.supportedResolution === false) {
    unsupported.push(option.unsupportedReason || "No safe structured resolution path");
  }
  if (!adapters.length) unsupported.push("No mechanical fields were found");
  if (option.utility && !option.conditions?.length && !option.selfEffect
    && !option.conditionOperations?.length && !option.defensive) {
    unsupported.push("Rules text has no explicit numeric or condition effect");
  }
  if (option.damage && !/\d|@/.test(option.damage)) unsupported.push("Damage formula is not evaluable");
  if (option.healing && !/\d|@/.test(option.healing)) unsupported.push("Healing formula is not evaluable");
  unsupported.push(...(option.mechanicsWarnings ?? []));

  const native = {
    check: option.kind === "strike" && Boolean(option.nativeAction?.variants?.[0]?.roll)
      || option.kind === "spell" && option.attackTrait && Boolean(option.item?.rollAttack)
      || Boolean(option.nativeSystemAction?.use)
      || Boolean(option.nativeStatistic?.check?.roll),
    damage: !option.damage || option.kind === "strike" && Boolean(option.nativeAction?.damage)
      || Boolean(option.item?.rollDamage),
    healing: !option.healing || Boolean(option.item?.rollDamage),
    condition: Boolean(option.conditions?.length || option.selfEffect || option.conditionOperations?.length),
    template: Boolean(option.area),
    resource: option.limitedUses === null || option.kind === "spell" && Boolean(option.item),
  };
  if (!option.automatic && !native.check && (option.attackTrait || option.save || option.checkStatistic)) {
    unsupported.push("Live combat: PF2e exposes no native roll control");
  }
  if (option.damage && !native.damage) unsupported.push("Live combat: PF2e exposes no native damage button");
  if (option.healing && !native.healing) unsupported.push("Live combat: PF2e exposes no native healing button");
  const status = option.supportedResolution === false ? "unsupported" : unsupported.length
    ? adapters.length ? "partial" : "unsupported"
    : native.check || option.automatic || option.save ? "native" : "modeled";

  return {
    ...option,
    adapters: unique(adapters),
    coverage: { status, native, unsupported },
  };
}

function summarizeOption(option) {
  return {
    id: option.id,
    name: option.name,
    kind: option.kind,
    status: option.coverage?.status ?? "unsupported",
    adapters: option.adapters ?? [],
    unsupported: option.coverage?.unsupported ?? ["Not classified"],
  };
}

export function buildCoverageReport(tokens, partyIds = null, enemyIds = null, buildCatalog) {
  const selected = tokens.filter((token) =>
    !partyIds || !enemyIds || partyIds.has(token.id) || enemyIds.has(token.id));
  const actors = selected.map((token) => {
    const options = buildCatalog(token.actor);
    const profile = getTacticalProfile(token.actor);
    const decisionFlow = tacticalDecisionCoverage(profile, options);
    const counts = { native: 0, modeled: 0, partial: 0, unsupported: 0 };
    for (const option of options) counts[option.coverage?.status ?? "unsupported"] += 1;
    return {
      id: token.actor.id,
      name: token.name || token.actor.name,
      className: token.actor.items?.find?.((item) => item.type === "class")?.name ?? token.actor.type,
      profile: profile.label,
      roles: profile.roles,
      decisionFlow,
      counts,
      total: options.length,
      options: options.map(summarizeOption),
    };
  });
  const totals = actors.reduce((sum, actor) => {
    for (const key of Object.keys(sum)) sum[key] += actor.counts[key] ?? 0;
    return sum;
  }, { native: 0, modeled: 0, partial: 0, unsupported: 0 });
  const adapterCounts = {};
  for (const actor of actors) {
    for (const option of actor.options) {
      for (const adapter of option.adapters) adapterCounts[adapter] = (adapterCounts[adapter] ?? 0) + 1;
    }
  }
  return {
    actors,
    totals,
    total: Object.values(totals).reduce((sum, count) => sum + count, 0),
    adapters: Object.entries(adapterCounts).map(([id, count]) => ({
      id,
      label: ADAPTER_LABELS[id] ?? id,
      count,
    })).sort((left, right) => right.count - left.count),
    decisionFlows: actors.map((actor) => actor.decisionFlow),
  };
}

function normalizeNativeResult(result, fallbackDc, checkDegree) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const roll = candidate?.roll ?? candidate;
  const total = Number(roll?.total ?? candidate?.total);
  const die = Number(roll?.dice?.[0]?.total ?? roll?.terms?.find?.((term) => term?.faces === 20)?.total);
  const degreeSlug = String(candidate?.outcome ?? candidate?.degreeOfSuccess ?? roll?.degreeOfSuccess ?? "");
  const degreeBySlug = {
    criticalFailure: 0,
    failure: 1,
    success: 2,
    criticalSuccess: 3,
    "critical-failure": 0,
    "critical-success": 3,
  };
  const nativeDegree = degreeSlug in degreeBySlug
    ? degreeBySlug[degreeSlug]
    : Number(candidate?.degreeOfSuccess ?? roll?.degreeOfSuccess);
  return {
    total: finite(total) ? total : null,
    natural: finite(die) ? die : null,
    degree: finite(nativeDegree) ? nativeDegree
      : finite(total) && finite(fallbackDc) ? checkDegree(total, fallbackDc, finite(die) ? die : 10)
        : null,
  };
}

function privateGmEvent() {
  if (typeof MouseEvent === "function") {
    return new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, metaKey: true });
  }
  return { type: "click", ctrlKey: true, metaKey: true, shiftKey: false };
}

export async function setNativeTarget(target) {
  const token = target?.token?.object ?? target?.object ?? target;
  if (!token?.setTarget) return false;
  for (const current of [...(game.user?.targets ?? [])]) {
    if (current !== token) current.setTarget(false, { releaseOthers: false, groupSelection: false });
  }
  token.setTarget(true, { releaseOthers: true, groupSelection: false });
  return game.user?.targets?.has?.(token) ?? true;
}

async function rollNativeStatistic(statistic, options) {
  if (!statistic?.check?.roll) return null;
  return statistic.check.roll({
    ...options,
    createMessage: true,
    skipDialog: true,
    rollMode: "gmroll",
  });
}

export async function resolveNativeCheck({
  option,
  attacker,
  target,
  nativeMessage = null,
  mapPenalty = 0,
  dc,
  checkDegree,
}) {
  try {
    await setNativeTarget(target);
    if (option.kind === "strike" && option.nativeAction?.variants?.length) {
      const variantIndex = mapPenalty >= 10 ? 2 : mapPenalty >= 5 ? 1 : 0;
      const variant = option.nativeAction.variants[Math.min(variantIndex, option.nativeAction.variants.length - 1)];
      const result = await variant?.roll?.({
        createMessage: true,
        skipDialog: true,
        rollMode: "gmroll",
        target: target.token?.object ?? null,
        options: ["lore-smith", "action:live-combat"],
      });
      const normalized = normalizeNativeResult(result, dc, checkDegree);
      if (normalized.total !== null) return { ...normalized, dc, source: "PF2e Strike" };
    }

    if (option.kind === "spell" && option.attackTrait && option.item?.rollAttack) {
      const attackNumber = mapPenalty >= 10 ? 3 : mapPenalty >= 5 ? 2 : 1;
      const action = attackNumber === 3 ? "spell-attack-3" : attackNumber === 2 ? "spell-attack-2" : "spell-attack";
      const cardRoll = nativeMessage
        ? await pressNativeCardRoll(nativeMessage, action, target, { rollerActorId: attacker.actor?.id })
        : null;
      const result = cardRoll
        ? { roll: cardRoll.rolls?.[0], outcome: cardRoll.flags?.pf2e?.context?.outcome }
        : await option.item.rollAttack(privateGmEvent(), attackNumber);
      const normalized = normalizeNativeResult(result, dc, checkDegree);
      if (normalized.total !== null) return { ...normalized, dc, source: cardRoll ? "PF2e spell attack card button" : "PF2e spell attack button" };
    }

    if (option.save) {
      const cardRoll = nativeMessage
        ? await pressNativeCardRoll(nativeMessage, "spell-save", target, {
          rollerActorId: target.actor?.id,
          controlTarget: true,
        })
        : null;
      const statistic = target.actor?.getStatistic?.(option.save);
      const result = cardRoll
        ? { roll: cardRoll.rolls?.[0], outcome: cardRoll.flags?.pf2e?.context?.outcome }
        : await rollNativeStatistic(statistic, {
          dc: { value: Number(option.dc), slug: option.item?.slug ?? option.id },
          item: option.item ?? null,
          origin: attacker.actor ?? null,
          options: ["lore-smith", "action:live-combat"],
        });
      const normalized = normalizeNativeResult(result, option.dc, checkDegree);
      if (normalized.total !== null) {
        return { ...normalized, dc: option.dc, source: cardRoll ? `PF2e spell-card ${option.save} save button` : `PF2e ${option.save} save` };
      }
    }


    if (option.kind === "skill" && option.nativeSystemAction?.use) {
      const result = await option.nativeSystemAction.use({
        actors: [attacker.actor],
        target: target.token?.object ?? null,
        event: privateGmEvent(),
        multipleAttackPenalty: option.attackTrait ? Math.round(mapPenalty / 5) : 0,
        message: { create: true },
      });
      const statisticDc = option.defenseStatistic
        ? target.actor?.getStatistic?.(option.defenseStatistic)?.dc?.value
          ?? target.actor?.getStatistic?.(option.defenseStatistic)?.dc
        : dc;
      const normalized = normalizeNativeResult(result, statisticDc, checkDegree);
      if (normalized.total !== null) {
        return { ...normalized, dc: Number(statisticDc), source: `PF2e ${option.name} action button` };
      }
    }

    if (option.nativeStatistic?.check?.roll) {
      const statisticDc = option.defenseStatistic
        ? target.actor?.getStatistic?.(option.defenseStatistic)?.dc?.value
          ?? target.actor?.getStatistic?.(option.defenseStatistic)?.dc
        : dc;
      const result = await rollNativeStatistic(option.nativeStatistic, {
        dc: { value: Number(statisticDc), slug: option.item?.slug ?? option.id },
        target: target.token?.object ?? null,
        options: ["lore-smith", "action:live-combat"],
      });
      const normalized = normalizeNativeResult(result, statisticDc, checkDegree);
      if (normalized.total !== null) return { ...normalized, dc: Number(statisticDc), source: "PF2e statistic" };
    }
  } catch (error) {
    console.warn("Lore Smith | Native PF2e check could not be executed.", error);
  }
  return null;
}

function newestMessageAfter(beforeIds, item) {
  return [...(game.messages?.contents ?? [])].reverse().find((message) =>
    !beforeIds.has(message.id)
    && (!item || message.item?.id === item.id || message.flags?.pf2e?.origin?.uuid === item.uuid)) ?? null;
}

async function waitForNewRollMessage(beforeIds, actorId, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const message = [...(game.messages?.contents ?? [])].reverse().find((candidate) =>
      !beforeIds.has(candidate.id)
      && candidate.rolls?.length
      && (!actorId || candidate.speaker?.actor === actorId || candidate.actor?.id === actorId));
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function cardElement(message) {
  if (!message?.id || typeof document === "undefined") return null;
  return document.querySelector(`[data-message-id="${message.id}"]`);
}

async function waitForCardElement(message, timeout = 1200) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const element = cardElement(message);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function pressNativeCardRoll(message, action, target, {
  outcome = null,
  rollerActorId = null,
  controlTarget = false,
} = {}) {
  const root = await waitForCardElement(message);
  const selector = outcome
    ? `[data-action="${action}"][data-outcome="${outcome}"]`
    : `[data-action="${action}"]`;
  const control = root?.querySelector(selector);
  if (!control) return null;
  await setNativeTarget(target);
  const targetToken = target?.token?.object ?? target?.object ?? target;
  const previouslyControlled = [...(canvas.tokens?.controlled ?? [])];
  if (controlTarget && targetToken?.control) targetToken.control({ releaseOthers: true });
  const beforeIds = new Set(game.messages?.keys?.() ?? []);
  // PF2e deliberately debounces chat-card controls for 500 ms. Waiting here
  // makes sequential area saves behave like deliberate GM clicks rather than
  // losing every roll after the first one.
  await new Promise((resolve) => setTimeout(resolve, 525));
  control.dispatchEvent(privateGmEvent());
  const actorId = rollerActorId ?? target?.actor?.id ?? target?.document?.actor?.id ?? null;
  const result = await waitForNewRollMessage(beforeIds, actorId);
  if (controlTarget) {
    targetToken?.release?.();
    for (const token of previouslyControlled) token.control?.({ releaseOthers: false });
  }
  return result;
}

export async function rollNativeDamage(option, attacker, target, degree, mapPenalty = 0, nativeMessage = null) {
  await setNativeTarget(target);
  const event = privateGmEvent();
  try {
    if (option.kind === "strike" && option.nativeAction) {
      const context = {
        event,
        target: target.token?.object ?? null,
        mapIncreases: option.attackTrait ? Math.round(mapPenalty / 5) : 0,
      };
      return degree === 3
        ? await option.nativeAction.critical?.(context)
        : await option.nativeAction.damage?.(context);
    }
    if (option.kind === "spell" && option.item?.rollDamage) {
      const cardRoll = nativeMessage
        ? await pressNativeCardRoll(nativeMessage, "spell-damage", target, { rollerActorId: attacker.actor?.id })
        : null;
      if (cardRoll?.rolls?.[0]) return cardRoll.rolls[0];
      return option.item.rollDamage(event, option.attackTrait ? Math.round(mapPenalty / 5) : undefined);
    }
    if (option.item?.rollDamage) return option.item.rollDamage(event);
  } catch (error) {
    console.warn("Lore Smith | Native PF2e damage/healing button could not be executed.", error);
  }
  return null;
}

export async function postNativeActionCard(option) {
  if (!option.item?.toMessage || option.kind === "spell" || option.kind === "strike") return null;
  const beforeIds = new Set(game.messages?.keys?.() ?? []);
  try {
    await option.item.toMessage(privateGmEvent());
    return newestMessageAfter(beforeIds, option.item);
  } catch (error) {
    console.warn("Lore Smith | Native PF2e item card could not be created.", error);
    return null;
  }
}

export async function clickNativeCardEffect(message) {
  if (!message?.id || typeof document === "undefined") return false;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const root = document.querySelector(`[data-message-id="${message.id}"]`);
  const control = root?.querySelector('[data-action="applyEffect"], [data-action="activate"]');
  if (!control) return false;
  control.click();
  return true;
}

export function resolveModeledCheck({
  option,
  attacker,
  target,
  mapPenalty = 0,
  ac,
  saveModifier,
  rollDie,
  checkDegree,
}) {
  if (option.save) {
    const natural = rollDie(20);
    const modifier = saveModifier(target, option.save);
    const total = natural + modifier;
    const degree = checkDegree(total, option.dc, natural);
    return {
      source: "Explicit saving-throw adapter",
      natural,
      modifier,
      total,
      dc: option.dc,
      degree,
      multiplier: [2, 1, 0.5, 0][degree],
      statistic: option.save,
    };
  }
  if (option.automatic) {
    return {
      source: "Explicit automatic-effect adapter",
      natural: null,
      modifier: 0,
      total: null,
      dc: null,
      degree: 2,
      multiplier: 1,
      statistic: null,
    };
  }
  const natural = rollDie(20);
  const modifier = Number(option.attack) - (option.attackTrait ? mapPenalty : 0);
  const statisticDc = option.defenseStatistic
    ? target.actor?.getStatistic?.(option.defenseStatistic)?.dc?.value
      ?? target.actor?.getStatistic?.(option.defenseStatistic)?.dc
    : null;
  const dc = finite(statisticDc) ? Number(statisticDc) : ac(target);
  const total = natural + modifier;
  const degree = checkDegree(total, dc, natural);
  return {
    source: "Explicit attack-check adapter",
    natural,
    modifier,
    total,
    dc,
    degree,
    multiplier: degree === 3 ? 2 : degree === 2 ? 1 : 0,
    statistic: "attack",
  };
}

function signedFormula(modifier) {
  const value = Number(modifier) || 0;
  return `1d20 ${value >= 0 ? "+" : "-"} ${Math.abs(value)}`;
}

async function createPrivateGmRoll(formula, { speaker = null, flavor = "Lore Smith simulation roll" } = {}) {
  const roll = await new Roll(formula).evaluate();
  const whisper = ChatMessage.getWhisperRecipients?.("GM")?.map((user) => user.id) ?? [];
  await roll.toMessage({
    speaker: speaker ?? { alias: "Lore Smith" },
    flavor,
    whisper,
  }, { rollMode: "gmroll" });
  return roll;
}

export async function resolveModeledCheckWithRoll({
  option,
  attacker,
  target,
  mapPenalty = 0,
  ac,
  saveModifier,
  checkDegree,
}) {
  if (option.automatic) return resolveModeledCheck({
    option,
    attacker,
    target,
    mapPenalty,
    ac,
    saveModifier,
    rollDie: () => 10,
    checkDegree,
  });

  const isSave = Boolean(option.save);
  const modifier = isSave
    ? saveModifier(target, option.save)
    : Number(option.attack) - (option.attackTrait ? mapPenalty : 0);
  const statisticDc = option.defenseStatistic
    ? target.actor?.getStatistic?.(option.defenseStatistic)?.dc?.value
      ?? target.actor?.getStatistic?.(option.defenseStatistic)?.dc
    : null;
  const dc = isSave
    ? Number(option.dc)
    : finite(statisticDc) ? Number(statisticDc) : ac(target);
  const roller = isSave ? target : attacker;
  const roll = await createPrivateGmRoll(signedFormula(modifier), {
    speaker: ChatMessage.getSpeaker?.({ actor: roller.actor, token: roller.token?.object ?? roller.token })
      ?? { alias: roller.name },
    flavor: isSave
      ? `${target.name} rolls ${option.save} against ${option.name} (DC ${dc})`
      : `${attacker.name} uses ${option.name} against ${target.name} (DC ${dc})`,
  });
  const natural = Number(roll.dice?.[0]?.total ?? roll.terms?.find?.((term) => term?.faces === 20)?.total ?? 10);
  const total = Number(roll.total);
  const degree = checkDegree(total, dc, natural);
  return {
    source: isSave ? "Explicit saving-throw adapter" : "Explicit attack-check adapter",
    natural,
    modifier,
    total,
    dc,
    degree,
    multiplier: isSave ? [2, 1, 0.5, 0][degree] : degree === 3 ? 2 : degree === 2 ? 1 : 0,
    statistic: isSave ? option.save : "attack",
    roll,
  };
}

function iwrEntries(actor, key) {
  const entries = actor?.system?.attributes?.[key] ?? actor?.system?.traits?.[key] ?? [];
  return Array.isArray(entries) ? entries : Object.values(entries ?? {});
}

function entryType(entry) {
  return String(entry?.type ?? entry?.slug ?? entry?.label ?? entry ?? "").toLowerCase();
}

function entryValue(entry) {
  const value = Number(entry?.value ?? entry?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function adjustDamageForIwr(amount, damageType, target) {
  const type = String(damageType ?? "").toLowerCase();
  if (!type || amount <= 0) return { amount: Math.max(0, amount), notes: [] };
  const actor = target.actor ?? target;
  const immunity = iwrEntries(actor, "immunities").find((entry) => entryType(entry) === type || entryType(entry) === "all-damage");
  if (immunity) return { amount: 0, notes: [`immune to ${type}`] };
  const weakness = iwrEntries(actor, "weaknesses").find((entry) => entryType(entry) === type || entryType(entry) === "all-damage");
  const resistance = iwrEntries(actor, "resistances").find((entry) => entryType(entry) === type || entryType(entry) === "all-damage");
  const weaknessValue = entryValue(weakness);
  const resistanceValue = entryValue(resistance);
  return {
    amount: Math.max(0, amount + weaknessValue - resistanceValue),
    notes: [
      weaknessValue ? `weakness ${type} ${weaknessValue}` : "",
      resistanceValue ? `resistance ${type} ${resistanceValue}` : "",
    ].filter(Boolean),
  };
}

function spellCastContext(option, actor) {
  const spell = option.item;
  const location = spell?.system?.location ?? {};
  const entryId = location.value;
  const entry = actor.spellcasting?.get?.(entryId) ?? actor.items?.get?.(entryId);
  const rank = Math.max(0, Number(location.heightenedLevel ?? spell?.rank ?? spell?.system?.level?.value ?? spell?.system?.level ?? 0));
  const mode = entry?.system?.prepared?.value ?? "";
  const slot = entry?.system?.slots?.[`slot${Math.max(1, rank)}`];
  const traits = option.traits ?? [];
  if (!entry?.cast) return { available: false, source: "No owning PF2e spellcasting entry" };
  if (traits.includes("cantrip") || spell.isCantrip || spell.atWill) {
    return { available: true, entry, rank, source: traits.includes("cantrip") || spell.isCantrip ? "PF2e cantrip" : "PF2e at-will spell" };
  }
  if (mode === "focus" || traits.includes("focus")) {
    const focus = Number(actor.system?.resources?.focus?.value ?? 0);
    return focus > 0
      ? { available: true, entry, rank, source: "PF2e focus pool" }
      : { available: false, source: "No PF2e focus points remaining" };
  }
  if (mode === "prepared" && !entry.isFlexible) {
    const slotId = [...(slot?.prepared ?? [])].findIndex((prepared) =>
      prepared?.id === spell.id && prepared?.expended !== true);
    return slotId >= 0
      ? { available: true, entry, rank, slotId, source: "PF2e prepared slot" }
      : { available: false, source: "No unexpended PF2e prepared slot" };
  }
  const innateUses = location.uses ?? spell.system?.uses;
  if (innateUses && Number.isFinite(Number(innateUses.value))) {
    return Number(innateUses.value) > 0
      ? { available: true, entry, rank, source: "PF2e innate use" }
      : { available: false, source: "No PF2e innate uses remaining" };
  }
  if (slot) {
    return Number(slot.value) > 0
      ? { available: true, entry, rank, source: `PF2e ${mode || "spell"} slot` }
      : { available: false, source: `No PF2e rank ${rank} slots remaining` };
  }
  return { available: false, source: "PF2e reports no castable slot or use" };
}

export async function consumeNativeResource(option, actor) {
  if (!option.item) return { available: true, consumed: false, source: "Unlimited" };
  const item = option.item;
  try {
    if (item.type === "spell") {
      const cast = spellCastContext(option, actor);
      if (!cast.available) return { available: false, consumed: false, source: cast.source };
      const beforeIds = new Set(game.messages?.keys?.() ?? []);
      await cast.entry.cast(item, {
        rank: cast.rank,
        slotId: cast.slotId,
        consume: true,
        message: true,
        rollMode: "gmroll",
      });
      const unlimited = option.traits?.includes("cantrip") || item.isCantrip || item.atWill;
      return {
        available: true,
        consumed: !unlimited,
        source: cast.source,
        message: newestMessageAfter(beforeIds, item),
      };
    }

    const frequency = item.system?.frequency;
    if (Number(frequency?.value) > 0) {
      await item.update({ "system.frequency.value": Number(frequency.value) - 1 });
      return { available: true, consumed: true, source: "PF2e frequency" };
    }
    if (frequency && Number(frequency?.value) <= 0) {
      return { available: false, consumed: false, source: "No PF2e frequency uses remaining" };
    }
    if (item.type === "consumable" && Number(item.system?.quantity) > 0) {
      await item.update({ "system.quantity": Number(item.system.quantity) - 1 });
      return { available: true, consumed: true, source: "PF2e consumable quantity" };
    }
    if (item.type === "consumable") return { available: false, consumed: false, source: "No PF2e quantity remaining" };
  } catch (error) {
    console.warn("Lore Smith | Could not consume the native PF2e resource.", error);
    return { available: false, consumed: false, source: "PF2e rejected the cast or use" };
  }
  return { available: true, consumed: false, source: "Unlimited PF2e action" };
}

async function resolveEffectDocument(effect) {
  if (!effect?.uuid) return null;
  try {
    const direct = await fromUuid(effect.uuid);
    if (direct) return direct;
  } catch (_error) {
    // Some PF2e source documents retain a human-readable compendium identifier.
  }
  const parts = effect.uuid.split(".");
  const packKey = parts[0] === "Compendium" ? `${parts[1]}.${parts[2]}` : "";
  const pack = game.packs.get(packKey);
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ["name"] });
  const match = index.find((entry) => entry.name === effect.name);
  return match ? pack.getDocument(match._id) : null;
}

export async function applyNativeStructuredEffects(option, attacker, target) {
  const applied = [];
  if (option.selfEffect) {
    const effect = await resolveEffectDocument(option.selfEffect);
    if (typeof effect?.toObject === "function") {
      const source = effect.toObject();
      delete source._id;
      await attacker.actor.createEmbeddedDocuments("Item", [source]);
      applied.push(effect.name);
    }
  }
  for (const operation of option.conditionOperations ?? []) {
    const recipient = operation.target === "self" ? attacker : target;
    if (!recipient?.actor) continue;
    const conditionDocument = game.pf2e.ConditionManager.getCondition(operation.slug);
    if (!conditionDocument) {
      console.warn(`Lore Smith | Ignoring unknown PF2e condition operation ${operation.slug}.`);
      continue;
    }
    try {
      if (operation.operation === "remove") {
        await recipient.actor.decreaseCondition?.(operation.slug, { forceRemove: true });
        applied.push(`removed ${operation.slug}`);
      } else if (operation.operation === "apply") {
        await recipient.actor.increaseCondition?.(operation.slug, { value: operation.value ?? 1 });
        applied.push(`${operation.slug}${Number(operation.value) > 1 ? ` ${operation.value}` : ""}`);
      }
    } catch (error) {
      console.warn(`Lore Smith | Could not resolve PF2e condition operation ${operation.operation}:${operation.slug}.`, error);
    }
  }
  return applied;
}

export async function applyNativeDefense(option, actor) {
  if (option.id === "pf2e-action:raise-a-shield") {
    try {
      await actor.update({ "system.attributes.shield.raised": true });
      return { applied: true, source: "PF2e shield state" };
    } catch (error) {
      console.warn("Lore Smith | Could not raise the shield through the PF2e actor state.", error);
    }
  }
  return { applied: false, source: "Modeled defensive state" };
}

export function coverageReportHtml(report, escapeHtml) {
  const percent = report.total
    ? Math.round(((report.totals.native + report.totals.modeled) / report.total) * 100)
    : 100;
  const actorRows = report.actors.map((actor) => {
    const problemOptions = actor.options.filter((option) =>
      option.status === "partial" || option.status === "unsupported");
    return `<details>
      <summary>${escapeHtml(actor.name)} · ${escapeHtml(actor.className)} · ${actor.counts.native} native / ${actor.counts.modeled} modeled / ${actor.counts.partial} partial / ${actor.counts.unsupported} unsupported</summary>
      <p><strong>Tactical profile:</strong> ${escapeHtml(actor.profile)} · ${escapeHtml(actor.roles.join(", "))}</p>
      <p><strong>Decision flow:</strong> ${escapeHtml(actor.decisionFlow.className)}${actor.decisionFlow.positioning ? ` · ${escapeHtml(actor.decisionFlow.positioning)}` : ""}</p>
      <p><strong>Available class priorities:</strong> ${actor.decisionFlow.matchedTags.length ? escapeHtml(actor.decisionFlow.matchedTags.join(", ")) : "No class-specific action tags were found on this actor."}</p>
      ${actor.decisionFlow.unavailableTags.length ? `<p><strong>Priorities without a matching owned action:</strong> ${escapeHtml(actor.decisionFlow.unavailableTags.join(", "))}</p>` : ""}
      ${problemOptions.length
        ? `<ul>${problemOptions.map((option) => `<li><strong>${escapeHtml(option.name)}</strong>: ${escapeHtml(option.unsupported.join("; "))}</li>`).join("")}</ul>`
        : "<p>Every catalogued action has a supported resolution path.</p>"}
    </details>`;
  }).join("");
  return `<section class="ls-coverage-report">
    <header><strong>Simulation coverage ${percent}%</strong><span>${report.totals.native} native · ${report.totals.modeled} modeled · ${report.totals.partial} partial · ${report.totals.unsupported} unsupported</span></header>
    <p>Native means Lore Smith can call a prepared PF2e check or document effect. Modeled means an explicit adapter implements the mechanic without changing Foundry documents during Monte Carlo iterations.</p>
    <div class="ls-coverage-adapters">${report.adapters.map((adapter) => `<span>${escapeHtml(adapter.label)} <b>${adapter.count}</b></span>`).join("")}</div>
    ${actorRows}
  </section>`;
}
