/** PF2e item building helpers. Prices are numeric GM Core benchmarks, not guarantees of balance. */
const MODULE = "lore-smith";
const MECHANICAL = new Set(["flat-modifier", "damage-dice", "resistance", "weakness", "immunity", "fast-healing", "roll-option"]);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const number = (value, fallback = 0) => Number.isFinite(Number(value?.value ?? value)) ? Number(value?.value ?? value) : fallback;
const clone = (value) => structuredClone(value);

export function lsItemRule(effect, name) {
  const value = String(effect.value ?? "").trim() === "" ? NaN : Number(effect.value);
  const label = effect.label || name;
  switch (effect.kind) {
    case "flat-modifier": return effect.selector && Number.isFinite(value) ? { key: "FlatModifier", selector: effect.selector, type: effect.modifierType || "item", value, label } : null;
    case "damage-dice": {
      const match = String(effect.formula ?? "").trim().match(/^([1-9]\d*)d(4|6|8|10|12)$/i);
      return effect.selector && match ? { key: "DamageDice", selector: effect.selector, diceNumber: Number(match[1]), dieSize: `d${match[2]}`, ...(effect.damageType ? { damageType: effect.damageType } : {}), label } : null;
    }
    case "resistance": return effect.damageType && Number.isFinite(value) && value > 0 ? { key: "Resistance", type: effect.damageType, value } : null;
    case "weakness": return effect.damageType && Number.isFinite(value) && value > 0 ? { key: "Weakness", type: effect.damageType, value } : null;
    case "immunity": return effect.damageType ? { key: "Immunity", type: effect.damageType } : null;
    case "fast-healing": return Number.isFinite(value) && value > 0 ? { key: "FastHealing", value, ...(effect.option === "regeneration" ? { type: "regeneration" } : {}) } : null;
    case "roll-option": return /^[a-z0-9][a-z0-9:-]*$/.test(effect.option || "") ? { key: "RollOption", domain: effect.selector || "all", option: effect.option, label, toggleable: true } : null;
    default: return null;
  }
}

export function lsItemDuration(activation) {
  const unit = activation.durationUnit || "manual";
  if (["unlimited", "encounter"].includes(unit)) return { value: -1, unit, expiry: null, sustained: false };
  if (!["rounds", "minutes", "hours", "days"].includes(unit)) return null;
  const value = Number(activation.durationValue);
  if (!Number.isInteger(value) || value < 1) return null;
  return { value, unit, expiry: ["turn-start", "turn-end", "round-end"].includes(activation.durationExpiry) ? activation.durationExpiry : "turn-start", sustained: false };
}

export function lsItemDurationLabel(activation) {
  const duration = lsItemDuration(activation);
  if (!duration) return activation.duration || "Duration handled by the GM";
  if (duration.unit === "unlimited") return "Until removed manually";
  if (duration.unit === "encounter") return "Until the encounter ends";
  return `${duration.value} ${duration.value === 1 ? duration.unit.replace(/s$/, "") : duration.unit}${duration.unit === "rounds" ? `; expires at ${duration.expiry.replaceAll("-", " ")}` : ""}${activation.duration ? `; ${activation.duration}` : ""}`;
}

export function lsItemConstantRules(flags, itemName) {
  return (flags.effects || []).filter((effect) => !effect.activationId).map((effect) => lsItemRule(effect, itemName)).filter(Boolean)
    .map((rule) => ({ ...rule, requiresEquipped: true }));
}

export function lsPreserveItemDamage(hp, maximum) {
  const damage = Math.max(0, number(hp?.max) - number(hp?.value));
  return Math.max(0, number(maximum) - damage);
}

const PERMANENT_PRICES = [[10,20],[25,35],[45,60],[75,100],[125,160],[200,250],[300,360],[415,500],[575,700],[820,1000],[1160,1400],[1640,2000],[2400,3000],[3600,4500],[5300,6500],[7900,10000],[12000,15000],[18600,24000],[30400,40000],[52000,70000]];
const CONSUMABLE_PRICES = [[3,4],[5,7],[8,12],[13,20],[21,30],[31,50],[51,70],[71,100],[101,150],[151,200],[201,300],[301,400],[401,600],[601,900],[901,1300],[1301,2000],[2001,3000],[3001,5000],[5001,8000],[8001,14000]];

export function lsItemPriceGuidance(item) {
  const level = number(item.system?.level);
  const consumable = ["consumable", "ammo"].includes(item.type);
  const band = (consumable ? CONSUMABLE_PRICES : PERMANENT_PRICES)[level - 1];
  const price = item.system?.price?.value || {};
  const gp = number(price.pp) * 10 + number(price.gp) + number(price.sp) / 10 + number(price.cp) / 100;
  return { level, gp, band: band ? `${band[0].toLocaleString()}–${band[1].toLocaleString()} gp` : "No published magic-item range for this level", outside: Boolean(band && (gp < band[0] || gp > band[1])), applicable: Boolean(band), consumable, url: `https://2e.aonprd.com/Rules.aspx?ID=${consumable ? 2951 : 2950}` };
}

export function lsValidateItemBuilder(item, flags) {
  const errors = [], warnings = [];
  const system = item.system || {};
  const activations = flags.activations || [], effects = flags.effects || [];
  if (!String(item.name || "").trim()) errors.push("Give the item a name.");
  if (item.type === "weapon" && !system.damage?.die) errors.push("Choose the weapon’s damage die.");
  if (item.type === "armor" && !system.category) errors.push("Choose an armor category.");
  if (["consumable", "ammo"].includes(item.type) && system.uses && (number(system.uses.max) < 1 || number(system.uses.value) > number(system.uses.max))) errors.push("Current uses must be between zero and maximum uses, and maximum uses must be at least one.");
  for (const effect of effects) {
    const label = effect.label || effect.kind || "Effect";
    if (effect.activationId && !activations.some((entry) => entry.id === effect.activationId)) errors.push(`${label}: its activation was removed. Reassign or remove this effect.`);
    if (MECHANICAL.has(effect.kind) && !lsItemRule(effect, item.name)) errors.push(`${label}: complete its target statistic/type and valid numeric value or dice formula.`);
    if (["damage", "healing"].includes(effect.kind)) {
      const formula = String(effect.formula || "").trim();
      let valid = /^[\ddD+\-*/().\s]+$/.test(formula) && /\d/.test(formula);
      try { if (valid && globalThis.Roll?.validate) valid = Roll.validate(formula); } catch { valid = false; }
      if (!valid) errors.push(`${label}: use a valid numeric dice formula, such as 2d6+4.`);
    }
    if (effect.kind === "check" && effect.dc !== "" && effect.dc != null && (!Number.isInteger(Number(effect.dc)) || Number(effect.dc) < 1)) errors.push(`${label}: DC must be a positive whole number or blank for a prompt.`);
    if (effect.kind === "condition") warnings.push(`${label}: this is a reminder. Apply or remove the condition using the target’s native sheet.`);
    if (effect.kind === "flat-modifier" && effect.modifierType === "item" && !effect.activationId) {
      const tier = Number(effect.value), selector = effect.selector;
      const levels = selector === "ac" ? [5,11,18] : selector === "saving-throw" ? [8,14,20] : ["attack", "attack-roll", "strike-attack-roll"].includes(selector) ? [2,10,16] : [3,9,17];
      if (tier > 3 || (tier > 0 && Number.isInteger(tier) && number(system.level) < levels[tier - 1])) warnings.push(`${label}: this permanent +${tier} item bonus is above the usual benchmark for level ${number(system.level)}. Compare similar published items.`);
    }
  }
  for (const activation of activations) {
    const label = activation.name || "Activation";
    if (activation.type === "reaction" && !activation.trigger?.trim()) errors.push(`${label}: a reaction needs a trigger.`);
    if (activation.frequencyMax !== "" && activation.frequencyMax != null && (!Number.isInteger(Number(activation.frequencyMax)) || Number(activation.frequencyMax) < 0)) errors.push(`${label}: uses per period must be a nonnegative whole number.`);
    const mechanical = effects.some((effect) => effect.activationId === activation.id && MECHANICAL.has(effect.kind));
    if (mechanical && activation.applyTo !== "manual" && !lsItemDuration(activation)) errors.push(`${label}: choose a tracked duration before automatically applying its bonuses.`);
    if (mechanical && activation.applyTo === "manual") warnings.push(`${label}: automation is set to description only. Its bonuses will not be applied automatically.`);
    if (mechanical && activation.durationUnit === "unlimited") warnings.push(`${label}: the created Effect remains until someone removes it.`);
    if (activation.duration || activation.requirements || activation.range || activation.areaType !== "none") warnings.push(`${label}: check written requirements, range, targeting, and special ending conditions at the table; these are not enforced automatically.`);
  }
  const guidance = lsItemPriceGuidance(item);
  if (guidance.outside) warnings.push(`Price is outside the level ${guidance.level} magic-item guideline (${guidance.band}). This is guidance, not an error; mundane and specific items can differ.`);
  const runes = system.runes;
  if (runes?.property?.length) {
    const limit = number(runes.potency) + (system.material?.type === "orichalcum" ? 1 : 0);
    if (runes.property.length > limit) warnings.push(`This item has ${runes.property.length} property runes but normally supports ${limit}. Review its potency, material, and specific exceptions.`);
  }
  if (flags.legacyReview) warnings.push("This item was built with an older version. Review every constant/activated assignment; finishing removes the old always-on copies of activation bonuses.");
  const nativeCount = (system.rules || []).length - (flags.generatedRules || []).length;
  if (nativeCount > 0) warnings.push(`${nativeCount} copied native rule(s) remain active according to PF2e. Review them on the native sheet to avoid duplicating a benefit.`);
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function lsItemResultRows(item, flags) {
  const rows = [];
  for (const effect of flags.effects || []) {
    if (effect.activationId) continue;
    rows.push({ label: effect.label || effect.kind, behavior: MECHANICAL.has(effect.kind) ? "Automatic while equipped correctly and invested when required." : "Clickable roll or reminder in the item description; resolve its outcome manually." });
  }
  for (const activation of flags.activations || []) {
    const count = (flags.effects || []).filter((effect) => effect.activationId === activation.id && MECHANICAL.has(effect.kind)).length;
    rows.push({ label: activation.name || "Activation", behavior: count && activation.applyTo !== "manual" ? `Apply ${count} bonus/effect rule(s) to ${activation.applyTo === "target" ? "one targeted creature you can edit" : "the item’s owner"} when you click Apply effect. Duration: ${lsItemDurationLabel(activation)}. A limited activation spends one recorded use.` : "Description and roll buttons only. Resolve its outcome manually." });
  }
  return rows;
}

export function lsItemRuneOptions(item, config = globalThis.CONFIG?.PF2E || {}, nativeSheetData = null) {
  const system = item.system || {}, runes = system.runes || {};
  const nativeRunes = nativeSheetData?.runeTypes?.property;
  const registry = Array.isArray(nativeRunes) ? Object.fromEntries(nativeRunes.map((entry) => [entry.slug, entry.name])) : nativeRunes || config.runes?.[item.type]?.property || config[`${item.type}PropertyRunes`] || {};
  const label = (data, key) => typeof data === "string" ? data : data?.name || data?.label || key;
  const localize = (text) => globalThis.game?.i18n?.localize(text) || text;
  const selected = runes.property || [];
  const choices = Object.entries(registry).map(([value, data]) => ({ value, label: localize(label(data, value)) }));
  for (const value of selected) if (!choices.some((entry) => entry.value === value)) choices.push({ value, label: value });
  choices.sort((a,b) => a.label.localeCompare(b.label));
  return { hasRunes: ["weapon", "armor"].includes(item.type) && "runes" in system, hasMaterial: "material" in system, hasShieldRunes: item.type === "shield" && "runes" in system,
    propertyRuneSlots: Array.from({ length: Math.max(4, selected.length) }, (_, index) => ({ index, options: choices.map((choice) => ({ ...choice, selected: selected[index] === choice.value })) })),
    runePotencyOptions: [0,1,2,3,4].map((value) => ({ value, label: value ? `+${value}` : "None", selected: number(runes.potency) === value })),
    runeTierOptions: ["None", "Striking / resilient", "Greater", "Major", "Mythic (system support required)"].map((label, value) => ({ value, label, selected: number(item.type === "weapon" ? runes.striking : runes.resilient) === value })),
    reinforcingOptions: ["None", "Minor", "Lesser", "Moderate", "Greater", "Major", "Supreme"].map((label, value) => ({ value, label, selected: number(runes.reinforcing) === value })),
  };
}

export function lsItemActivationButtons(item) {
  const flags = item?.getFlag?.(MODULE, "itemBuilder");
  if (!item?.actor || !flags) return "";
  return (flags.activations || []).filter((entry) => entry.applyTo !== "manual" && (flags.effects || []).some((effect) => effect.activationId === entry.id && MECHANICAL.has(effect.kind)))
    .map((entry) => `<button type="button" data-ls-item-activate="${esc(entry.id)}" data-ls-source-uuid="${esc(item.uuid)}">Apply effect: ${esc(entry.name || item.name)}</button>`).join("");
}

export function lsItemEffectSource(item, activation, effects) {
  const duration = lsItemDuration(activation);
  if (!duration) throw new Error("Choose a tracked duration in the Item Builder first.");
  return { name: `Effect: ${activation.name || item.name}`, type: "effect", img: item.img,
    system: { level: { value: number(item.system?.level) }, description: { value: `<p>${esc(activation.effectText).replaceAll("\n", "<br>")}</p><p>From ${esc(item.name)}. ${esc(lsItemDurationLabel(activation))}</p>` },
      duration, start: { value: globalThis.game?.time?.worldTime ?? 0, initiative: item.actor?.combatant?.initiative ?? null }, tokenIcon: { show: true },
      rules: effects.map((effect) => lsItemRule(effect, item.name)).filter(Boolean), traits: { value: [], otherTags: [] },
    }, flags: { [MODULE]: { itemActivationEffect: { sourceItemUuid: item.uuid, activationId: activation.id } } } };
}

const runningActivations = new Set();
export async function lsActivateBuiltItem(item, activationId) {
  const key = `${item?.uuid}:${activationId}`;
  if (runningActivations.has(key)) return;
  runningActivations.add(key);
  try {
    const actor = item?.actor;
    if (!actor || !actor.isOwner || !item.isOwner) throw new Error("Open an owned copy of this item on a creature you can edit.");
    const flags = item.getFlag(MODULE, "itemBuilder") || {};
    if (flags.schemaVersion !== 2 || flags.legacyReview) throw new Error("Review and finish this item in the updated Item Builder before applying its activation.");
    const activation = flags.activations?.find((entry) => entry.id === activationId);
    if (!activation || activation.applyTo === "manual") throw new Error("This activation is descriptive only.");
    if (item.isEquipped === false || item.system?.equipped?.carryType === "dropped") throw new Error("Equip or hold this item correctly before applying its effect.");
    if (item.system?.traits?.value?.includes("invested") && !item.isInvested) throw new Error("Invest this item before applying its effect.");
    const effects = (flags.effects || []).filter((effect) => effect.activationId === activationId && MECHANICAL.has(effect.kind));
    if (!effects.length || effects.some((effect) => !lsItemRule(effect, item.name))) throw new Error("This activation has no valid automatic effects. Review it in the builder.");
    const targets = activation.applyTo === "target" ? [...(game.user.targets || [])].map((token) => token.actor).filter(Boolean) : [actor];
    const recipients = [...new Map(targets.map((target) => [target.uuid, target])).values()];
    if (recipients.length !== 1) throw new Error("Target exactly one creature before applying this effect.");
    const recipient = recipients[0];
    if (!recipient.isOwner) throw new Error("You cannot edit that target. Ask the GM to apply this effect using the item; no permissions were changed.");
    const action = actor.items.find((entry) => entry.type === "action" && entry.getFlag(MODULE, "itemActivation")?.sourceItemId === item.id && entry.getFlag(MODULE, "itemActivation")?.activationId === activationId);
    const limited = Number(activation.frequencyMax) > 0;
    if (limited && (!action || Number(action.system.frequency?.value) < 1)) throw new Error("No activation uses remain. Restore uses through the native action sheet when its frequency resets.");
    const source = lsItemEffectSource(item, activation, effects);
    const existing = recipient.items.find((entry) => entry.type === "effect" && entry.getFlag(MODULE, "itemActivationEffect")?.sourceItemUuid === item.uuid && entry.getFlag(MODULE, "itemActivationEffect")?.activationId === activationId);
    const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
    if (Dialog) {
      const confirmed = await Dialog.confirm({ window: { title: "Apply item effect" }, content: `<p>${existing ? "Refresh" : "Apply"} <strong>${esc(source.name)}</strong> on <strong>${esc(recipient.name)}</strong> for ${esc(lsItemDurationLabel(activation))}?</p><p>${limited ? "This spends one activation use. " : ""}Check range, requirements, saving throws, and the action cost first. Consumable charges/quantity are handled separately on the native sheet.</p>`, yes: { label: existing ? "Refresh effect" : "Apply effect" }, no: { label: "Cancel" } });
      if (!confirmed) return;
    }
    // Recheck after a potentially long confirmation dialog; never spend a missing use.
    const remaining = Number(action?.system.frequency?.value);
    if (limited && (!Number.isFinite(remaining) || remaining < 1)) throw new Error("No activation uses remain.");
    const previousEffect = existing?.toObject();
    let created;
    if (existing) await existing.update(source);
    else [created] = await recipient.createEmbeddedDocuments("Item", [source]);
    try { if (limited) await action.update({ "system.frequency.value": remaining - 1 }); }
    catch (error) {
      if (created) await created.delete();
      else if (existing && previousEffect) await existing.update(previousEffect);
      throw error;
    }
    ui.notifications.info(`${source.name} ${existing ? "refreshed" : "applied"} on ${recipient.name}.`);
    return created || existing;
  } catch (error) { ui.notifications.error(error.message || "The activation could not be applied."); }
  finally { runningActivations.delete(key); }
}

const boundContainers = new WeakSet();
export function lsBindItemActivationButtons(container) {
  const root = container?.[0] || container;
  if (!root?.addEventListener || boundContainers.has(root)) return;
  boundContainers.add(root);
  root.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-ls-item-activate]");
    if (!button || !root.contains(button)) return;
    event.preventDefault(); event.stopPropagation();
    const item = await fromUuid(button.dataset.lsSourceUuid);
    await lsActivateBuiltItem(item, button.dataset.lsItemActivate);
  });
}
