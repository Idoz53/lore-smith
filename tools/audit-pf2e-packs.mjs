import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass the root of a PF2e system source checkout.");

async function* jsonFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield path;
  }
}

function active(item) {
  const time = String(item.system?.time?.value ?? "").trim();
  const actionType = item.system?.actionType?.value;
  return Boolean(time || ["action", "reaction", "free"].includes(actionType));
}

function classify(item) {
  const system = item.system ?? {};
  const description = String(system.description?.value ?? "");
  const damage = Object.values(system.damage ?? {}).some((entry) => entry?.formula || entry?.dice)
    || /@Damage\[/i.test(description);
  const save = Boolean(system.defense?.save?.statistic);
  const basicSave = Boolean(system.defense?.save?.basic);
  const selfEffect = Boolean(system.selfEffect?.uuid);
  const linkedConditionOperation = /(?:loses?|removes?|gains?|becomes?)[^@.]{0,90}@UUID\[Compendium\.pf2e\.conditionitems\.Item\./i.test(description);
  const linkedEffects = [...description.matchAll(/@UUID\[Compendium\.pf2e\.(?:spell-effects|bestiary-effects|equipment-effects)\.Item\./gi)].length;
  const conditionLinks = [...description.matchAll(/@UUID\[Compendium\.pf2e\.conditionitems\.Item\./gi)].length;
  const attack = system.traits?.value?.includes?.("attack") ?? false;
  const healing = Object.values(system.damage ?? {}).some((entry) => entry?.kinds?.includes?.("healing"));
  const variants = Object.values(system.overlays ?? {}).filter((overlay) => overlay?.overlayType === "override").length;
  const safe = selfEffect || linkedConditionOperation || healing || (damage && (attack || !save || basicSave));
  return {
    safe,
    partial: safe && (linkedEffects > (selfEffect ? 1 : 0) || conditionLinks > (linkedConditionOperation ? 1 : 0)),
    proseOnly: !safe,
    selfEffect,
    linkedConditionOperation,
    structuredDamage: damage,
    structuredSave: save,
    basicSave,
    variants,
  };
}

const counts = {
  files: 0, actors: 0, activeEntries: 0, safe: 0, partial: 0, proseOnly: 0,
  selfEffect: 0, linkedConditionOperation: 0, structuredDamage: 0, structuredSave: 0,
  basicSave: 0, variants: 0,
};
const byType = {};

for await (const path of jsonFiles(resolve(root, "packs"))) {
  counts.files += 1;
  let source;
  try { source = JSON.parse(await readFile(path, "utf8")); } catch { continue; }
  const documents = source.type === "npc" || source.type === "character"
    ? (counts.actors += 1, source.items ?? [])
    : [source];
  for (const item of documents) {
    if (!active(item)) continue;
    counts.activeEntries += 1;
    const result = classify(item);
    const type = item.type ?? "unknown";
    byType[type] ??= { total: 0, safe: 0, partial: 0, proseOnly: 0 };
    byType[type].total += 1;
    for (const key of ["safe", "partial", "proseOnly", "selfEffect", "linkedConditionOperation", "structuredDamage", "structuredSave", "basicSave"]) {
      if (result[key]) counts[key] += 1;
    }
    counts.variants += result.variants;
    if (result.safe) byType[type].safe += 1;
    if (result.partial) byType[type].partial += 1;
    if (result.proseOnly) byType[type].proseOnly += 1;
  }
}

console.log(JSON.stringify({ root, counts, byType }, null, 2));
