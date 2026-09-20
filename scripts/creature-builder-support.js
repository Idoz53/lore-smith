import { creatureTableRow } from "./building-creatures-data.js";

const number = (value, fallback = 0) => Number.isFinite(Number(value?.value ?? value?.mod ?? value)) ? Number(value?.value ?? value?.mod ?? value) : fallback;
const copy = (value) => structuredClone(value);
const formula = (value) => String(value ?? "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, "");

/** New item IDs and every internal reference are assigned together before creation. */
export function cloneCreatureItems(items, randomID, sourceUuid = "", targetUuid = "") {
  const originals = Array.from(items, (item) => typeof item.toObject === "function" ? item.toObject() : copy(item));
  const ids = new Map(originals.map((item) => [item._id, randomID()]));
  const remap = (value) => {
    if (typeof value === "string") {
      if (ids.has(value)) return ids.get(value);
      if (sourceUuid && targetUuid) for (const [oldId, newId] of ids) value = value.replaceAll(`${sourceUuid}.Item.${oldId}`, `${targetUuid}.Item.${newId}`);
      return value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
  };
  return originals.map(remap);
}

/** Editing the maximum never heals damage or revives a defeated creature. */
export function creatureHpAfterMaximum(hp, maximum) {
  const nextMax = Math.max(1, number(maximum, 1));
  const current = number(hp?.value, number(hp?.max, 1));
  if (current <= 0) return 0;
  return Math.max(0, Math.min(nextMax, nextMax - Math.max(0, number(hp?.max, current) - current)));
}

/** Rescale recognizable benchmark values only. Unrecognized/custom values remain untouched. */
export function creatureScalePlan(actor, targetLevel) {
  const source = actor._source ?? actor;
  const system = source.system;
  const from = number(system.details?.level);
  const to = Math.max(-1, Math.min(24, number(targetLevel)));
  const actorUpdate = { "system.details.level.value": to };
  const itemUpdates = [];
  const rows = [];
  const skipped = [];
  const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
  const row = (table, level) => creatureTableRow(table, level).map((value) => Array.isArray(value) ? Math.round((value[0] + value[1]) / 2) : value);
  const match = (label, before, previous, next, update, path) => {
    if (before == null) return;
    const index = previous.findIndex((value) => value != null && number(before, NaN) === number(value, NaN));
    if (index < 0 || next[index] == null) { skipped.push(label); return; }
    if (number(before) === number(next[index])) return;
    update[path] = next[index];
    rows.push({ label, before: number(before), after: next[index] });
  };
  const stats = [
    ["AC", "attributes.ac.value", "armorClass"], ["HP maximum", "attributes.hp.max", "hitPoints"], ["Perception", "perception.mod", "perception"],
    ...["fortitude", "reflex", "will"].map((save) => [save, `saves.${save}.value`, "saves"]),
    ...["str", "dex", "con", "int", "wis", "cha"].map((ability) => [ability.toUpperCase(), `abilities.${ability}.mod`, "attributes"]),
    ...Object.keys(system.skills ?? {}).map((skill) => [skill, `skills.${skill}.base`, "skills"]),
  ];
  for (const [label, path, table] of stats) match(label, get(system, path), row(table, from), row(table, to), actorUpdate, `system.${path}`);
  if (actorUpdate["system.attributes.hp.max"] != null) actorUpdate["system.attributes.hp.value"] = creatureHpAfterMaximum(system.attributes.hp, actorUpdate["system.attributes.hp.max"]);
  for (const item of source.items ?? []) {
    const data = item.toObject?.() ?? item;
    const update = { _id: data._id ?? data.id };
    const link = data.flags?.["lore-smith"]?.creatureDamageLink;
    if (data.type === "spellcastingEntry") {
      if (link?.dcTier === "custom") { skipped.push(`${data.name}: custom spell DC and attack`); continue; }
      const oldRow = creatureTableRow("spell", from), newRow = creatureTableRow("spell", to);
      const tier = link?.autoScale && link.kind === "spellcasting" ? { extreme: 0, high: 2, moderate: 4 }[link.dcTier] : null;
      for (const [key, offset] of [["dc", 0], ["value", 1]]) {
        const before = data.system?.spelldc?.[key];
        if (tier != null) {
          update[`system.spelldc.${key}`] = newRow[tier + offset];
          rows.push({ label: `${data.name}: spell ${key === "dc" ? "DC" : "attack"}`, before, after: newRow[tier + offset] });
        } else match(`${data.name}: spell ${key === "dc" ? "DC" : "attack"}`, before, [oldRow[offset], oldRow[2 + offset], oldRow[4 + offset]], [newRow[offset], newRow[2 + offset], newRow[4 + offset]], update, `system.spelldc.${key}`);
      }
    }
    if (data.type === "melee" && !link?.autoScale) {
      if (link?.attackTier !== "custom") match(`${data.name}: attack`, data.system?.bonus?.value, row("strikeAttack", from), row("strikeAttack", to), update, "system.bonus.value");
      if (link?.damageTier !== "custom") {
        const damages = Object.entries(data.system?.damageRolls ?? {});
        if (damages.length === 1) {
          const [id, damage] = damages[0];
          const index = creatureTableRow("strikeDamage", from).findIndex((value) => formula(value) === formula(damage.damage));
          if (index >= 0) {
            const after = String(creatureTableRow("strikeDamage", to)[index]).replace(/\s*\([^)]*\)\s*$/, "").trim();
            update[`system.damageRolls.${id}.damage`] = after;
            rows.push({ label: `${data.name}: damage`, before: damage.damage, after });
          } else skipped.push(`${data.name}: damage`);
        } else skipped.push(`${data.name}: multiple damage components`);
      }
    }
    if (Object.keys(update).length > 1) itemUpdates.push(update);
  }
  return { from, to, actorUpdate, itemUpdates, rows, skipped };
}

/** Deliberately bounded: do not evaluate arbitrary Foundry formulas or actor data. */
export function creatureDamageAverage(value) {
  const source = formula(value);
  if (!source || !/^[+-]?(?:\d*d\d+|\d+(?:\.\d+)?)(?:[+-](?:\d*d\d+|\d+(?:\.\d+)?))*$/i.test(source)) return null;
  return (source.match(/[+-]?[^+-]+/g) ?? []).reduce((sum, term) => {
    const sign = term.startsWith("-") ? -1 : 1;
    const atom = term.replace(/^[+-]/, "");
    if (!atom.toLowerCase().includes("d")) return sum + sign * Number(atom);
    const [count, faces] = atom.toLowerCase().split("d");
    return sum + sign * Number(count || 1) * (Number(faces) + 1) / 2;
  }, 0);
}

export function creatureOffenseReview(actor) {
  const level = number(actor.system.details?.level);
  const issues = [];
  const offense = [];
  const attackRow = creatureTableRow("strikeAttack", level);
  const damageRow = creatureTableRow("strikeDamage", level).map(creatureDamageAverage);
  const spellRow = creatureTableRow("spell", level);
  const items = Array.from(actor.items ?? []);
  const closest = (value, values, labels) => labels[values.reduce((best, candidate, index) => Math.abs(value - candidate) < Math.abs(value - values[best]) ? index : best, 0)];
  for (const item of items) {
    const system = item.system ?? {};
    const link = item.getFlag?.("lore-smith", "creatureDamageLink") ?? item.flags?.["lore-smith"]?.creatureDamageLink;
    if (item.type === "melee") {
      const attack = number(system.bonus);
      const damages = Object.values(system.damageRolls ?? {}).filter((roll) => !["persistent", "precision"].includes(roll.category));
      const averages = damages.map((roll) => creatureDamageAverage(roll.damage));
      const average = averages.length && averages.every((value) => value != null) ? averages.reduce((a, b) => a + b, 0) : null;
      const attackTier = closest(attack, attackRow, ["Extreme", "High", "Moderate", "Low"]);
      const damageTier = average == null ? "Review formula" : closest(average, damageRow, ["Extreme", "High", "Moderate", "Low"]);
      offense.push({ name: item.name, summary: `Attack +${attack} (${attackTier}); damage ${average == null ? "not estimated" : `${average} average (${damageTier})`}` });
      if (attack > attackRow[0]) issues.push({ severity: "warning", text: `${item.name}: attack +${attack} exceeds the extreme benchmark +${attackRow[0]}.` });
      if (average != null && average > damageRow[0]) issues.push({ severity: "warning", text: `${item.name}: ${average} average immediate damage exceeds the extreme benchmark ${damageRow[0]}. Additional effects also increase its impact.` });
      if (attackTier === "Extreme" && damageTier === "Extreme") issues.push({ severity: "warning", text: `${item.name} combines extreme accuracy and damage. Review the trade-off against its defenses and other attacks.` });
    }
    if (item.type === "spellcastingEntry") {
      const dc = number(system.spelldc?.dc), attack = number(system.spelldc?.value);
      offense.push({ name: item.name, summary: `Spell DC ${dc}; attack +${attack}` });
      if (dc > spellRow[0] || attack > spellRow[1]) issues.push({ severity: "warning", text: `${item.name}: spell DC or attack exceeds this level's extreme spellcasting benchmark.` });
      if (!items.some((spell) => spell.type === "spell" && spell.system?.location?.value === (item.id ?? item._id))) issues.push({ severity: "info", text: `${item.name} has no assigned spells. Add spells and configure native slots or uses before play.` });
    }
    if (item.type === "spell") {
      if (!items.some((entry) => entry.type === "spellcastingEntry" && (entry.id ?? entry._id) === system.location?.value)) issues.push({ severity: "warning", text: `${item.name} has no valid spellcasting entry. Move it into an entry on the native sheet.` });
      const rank = number(system.location?.heightenedLevel, number(system.level, 1));
      if (!system.traits?.value?.includes("cantrip") && rank > Math.max(1, Math.ceil(level / 2))) issues.push({ severity: "warning", text: `${item.name}: rank ${rank} is above the usual spellcaster rank for level ${level}. Review the exception.` });
    }
    if (link?.kind === "ability") {
      const formulaValue = link.damageTier === "custom" ? link.customDamage : link.damageTier?.startsWith("area-") ? creatureTableRow("areaDamage", level)[link.damageTier === "area-limited" ? 1 : 0] : null;
      const average = creatureDamageAverage(formulaValue);
      if (link.delivery === "area" && link.damageTier !== "none" && (link.usage !== "action" || number(link.actions, 2) < 2)) issues.push({ severity: "warning", text: `${item.name}: area-damage benchmarks assume two actions. Cheaper, reactive, or passive damage can be repeated or combined with other offense; reduce damage or limit uses.` });
      if (link.damageTier === "area-limited" && !number(system.frequency?.max)) issues.push({ severity: "warning", text: `${item.name} uses limited-use damage without a usage limit.` });
      if (link.usage === "reaction" && !link.trigger?.trim()) issues.push({ severity: "warning", text: `${item.name} is a reaction without a trigger.` });
      if (average != null && average > creatureDamageAverage(creatureTableRow("areaDamage", level)[1]) && link.delivery === "area") issues.push({ severity: "warning", text: `${item.name}: area damage exceeds the limited-use benchmark. Check its actions, range, targets, and frequency.` });
    }
  }
  const reactions = items.filter((item) => item.system?.actionType?.value === "reaction");
  if (reactions.length > 1) issues.push({ severity: "info", text: `${reactions.length} reactions are available choices; a creature normally has only one reaction per round unless an ability grants more.` });
  issues.push({ severity: "info", text: "Plan a three-action turn plus one reaction. Check multi-Strike activities, multiple attack penalty, control effects, and repeated damage together; numbers alone cannot certify encounter balance." });
  return { offense, issues };
}
