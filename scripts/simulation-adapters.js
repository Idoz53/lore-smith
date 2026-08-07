import { getTacticalProfile } from "./tactical-profiles.js";

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
  if (!adapters.length) unsupported.push("No mechanical fields were found");
  if (option.utility && !option.conditions?.length && !option.defensive) {
    unsupported.push("Rules text has no explicit numeric or condition effect");
  }
  if (option.damage && !/\d|@/.test(option.damage)) unsupported.push("Damage formula is not evaluable");
  if (option.healing && !/\d|@/.test(option.healing)) unsupported.push("Healing formula is not evaluable");

  const native = {
    check: option.kind === "strike" && Boolean(option.nativeAction?.variants?.[0]?.roll)
      || Boolean(option.nativeStatistic?.check?.roll),
    damage: Boolean(option.damage),
    healing: Boolean(option.healing),
    condition: Boolean(option.conditions?.length),
    template: Boolean(option.area),
    resource: option.limitedUses !== null,
  };
  const status = unsupported.length
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
    const counts = { native: 0, modeled: 0, partial: 0, unsupported: 0 };
    for (const option of options) counts[option.coverage?.status ?? "unsupported"] += 1;
    return {
      id: token.actor.id,
      name: token.name || token.actor.name,
      className: token.actor.items?.find?.((item) => item.type === "class")?.name ?? token.actor.type,
      profile: profile.label,
      roles: profile.roles,
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
  };
}

function normalizeNativeResult(result, fallbackDc, checkDegree) {
  const roll = result?.roll ?? result;
  const total = Number(roll?.total ?? result?.total);
  const die = Number(roll?.dice?.[0]?.total ?? roll?.terms?.find?.((term) => term?.faces === 20)?.total);
  const nativeDegree = Number(result?.degreeOfSuccess ?? roll?.degreeOfSuccess);
  return {
    total: finite(total) ? total : null,
    natural: finite(die) ? die : null,
    degree: finite(nativeDegree) ? nativeDegree
      : finite(total) && finite(fallbackDc) ? checkDegree(total, fallbackDc, finite(die) ? die : 10)
        : null,
  };
}

async function rollNativeStatistic(statistic, options) {
  if (!statistic?.check?.roll) return null;
  return statistic.check.roll({
    ...options,
    createMessage: false,
    skipDialog: true,
    rollMode: "roll",
  });
}

export async function resolveNativeCheck({
  option,
  attacker,
  target,
  mapPenalty = 0,
  dc,
  checkDegree,
}) {
  try {
    if (option.kind === "strike" && option.nativeAction?.variants?.length) {
      const variantIndex = mapPenalty >= 10 ? 2 : mapPenalty >= 5 ? 1 : 0;
      const variant = option.nativeAction.variants[Math.min(variantIndex, option.nativeAction.variants.length - 1)];
      const result = await variant?.roll?.({
        createMessage: false,
        skipDialog: true,
        target: target.token?.object ?? null,
        options: ["lore-smith", "action:live-combat"],
      });
      const normalized = normalizeNativeResult(result, dc, checkDegree);
      if (normalized.total !== null) return { ...normalized, dc, source: "PF2e Strike" };
    }

    if (option.save) {
      const statistic = target.actor?.getStatistic?.(option.save);
      const result = await rollNativeStatistic(statistic, {
        dc: { value: Number(option.dc), slug: option.item?.slug ?? option.id },
        target: attacker.token?.object ?? null,
        options: ["lore-smith", "action:live-combat"],
      });
      const normalized = normalizeNativeResult(result, option.dc, checkDegree);
      if (normalized.total !== null) return { ...normalized, dc: option.dc, source: `PF2e ${option.save} save` };
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
    console.warn("Lore Smith | Native PF2e check failed; using the explicit modeled adapter.", error);
  }
  return null;
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

export async function consumeNativeResource(option, actor) {
  if (option.limitedUses === null || !option.item) return { consumed: false, source: "Unlimited" };
  const item = option.item;
  try {
    if (item.type === "spell") {
      if (option.traits?.includes("cantrip")) return { consumed: false, source: "Cantrip" };
      const location = item.system?.location ?? {};
      const entryId = location.value;
      const entry = actor.spellcasting?.get?.(entryId) ?? actor.items?.get?.(entryId);
      const mode = entry?.system?.prepared?.value ?? "";
      const rank = Math.max(1, Number(location.heightenedLevel ?? item.system?.level?.value ?? item.system?.level ?? 1));
      if (mode === "focus" || option.traits?.includes("focus")) {
        const current = Number(actor.system?.resources?.focus?.value ?? 0);
        if (current > 0) {
          await actor.update({ "system.resources.focus.value": current - 1 });
          return { consumed: true, source: "PF2e focus pool" };
        }
      }
      const slotKey = `slot${rank}`;
      const slot = entry?.system?.slots?.[slotKey];
      if (mode === "prepared" && slot?.prepared) {
        const index = slot.prepared.findIndex((prepared) =>
          prepared?.id === item.id && prepared?.expended !== true);
        if (index >= 0) {
          await entry.update({ [`system.slots.${slotKey}.prepared.${index}.expended`]: true });
          return { consumed: true, source: "PF2e prepared slot" };
        }
      }
      if (entry && slot && Number(slot.value) > 0) {
        await entry.update({ [`system.slots.${slotKey}.value`]: Number(slot.value) - 1 });
        return { consumed: true, source: `PF2e ${mode || "spell"} slot` };
      }
      const uses = location.uses ?? item.system?.uses;
      if (Number(uses?.value) > 0) {
        const path = location.uses ? "system.location.uses.value" : "system.uses.value";
        await item.update({ [path]: Number(uses.value) - 1 });
        return { consumed: true, source: "PF2e innate uses" };
      }
    }

    const frequency = item.system?.frequency;
    if (Number(frequency?.value) > 0) {
      await item.update({ "system.frequency.value": Number(frequency.value) - 1 });
      return { consumed: true, source: "PF2e frequency" };
    }
    if (item.type === "consumable" && Number(item.system?.quantity) > 0) {
      await item.update({ "system.quantity": Number(item.system.quantity) - 1 });
      return { consumed: true, source: "PF2e consumable quantity" };
    }
  } catch (error) {
    console.warn("Lore Smith | Could not consume the native PF2e resource.", error);
  }
  return { consumed: false, source: "Virtual resource tracker" };
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
