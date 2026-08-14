import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));

if (manifest.id !== "lore-smith") throw new Error("Unexpected module id.");
if (!manifest.relationships?.systems?.some((system) => system.id === "pf2e")) {
  throw new Error("PF2e system relationship is missing.");
}

const templateFiles = [
  "templates/dashboard.hbs",
  "templates/creature-builder.hbs",
  "templates/item-builder.hbs",
  "templates/live-combat.hbs",
];

for (const relativePath of [...manifest.esmodules, ...manifest.styles, ...templateFiles]) {
  await access(resolve(root, relativePath), constants.R_OK);
}

const script = await readFile(resolve(root, "scripts/main.js"), "utf8");
const nativeScript = await readFile(resolve(root, "scripts/native-workflows.js"), "utf8");
const template = await readFile(resolve(root, "templates/dashboard.hbs"), "utf8");
const creatureTemplate = await readFile(resolve(root, "templates/creature-builder.hbs"), "utf8");
const itemTemplate = await readFile(resolve(root, "templates/item-builder.hbs"), "utf8");
const liveTemplate = await readFile(resolve(root, "templates/live-combat.hbs"), "utf8");
if (manifest.esmodules.some((path) => path.includes("journal-editor"))
  || nativeScript.includes('Hooks.on("renderJournalSheet"')
  || nativeScript.includes('Hooks.on("renderJournalPageSheet"')
  || nativeScript.includes('Hooks.on("renderJournalEntryPageSheet"')) {
  throw new Error("Lore Smith must leave Foundry's Journal sheets and page editors unmodified.");
}
if (!script.includes("combatantInsideTemplate") || !script.includes("rollNativeDamage")) {
  throw new Error("Live area hit-testing or native PF2e damage controls are missing.");
}
for (const requiredWorldMapFeature of [
  "normalizeWorldMapBuild",
  "worldPointInPolygon",
  "worldPolygonSelfIntersects",
  "ensureWorldRegionJournal",
  "createWorldAtlas",
  "worldMapBuilderWorldDraft",
]) {
  if (!script.includes(requiredWorldMapFeature)) throw new Error(`World Map Builder feature missing: ${requiredWorldMapFeature}`);
}
for (const requiredWorldMapTemplate of [
  'data-tab="worldMap"',
  'data-world-map',
  'data-world-region-id',
  'data-action="openWorldRegionJournal"',
]) {
  if (!template.includes(requiredWorldMapTemplate)) throw new Error(`World Map Builder template feature missing: ${requiredWorldMapTemplate}`);
}
if (/async saveWorldMapDraft\(\)[\s\S]{0,500}this\.worldMap\s*=\s*normalizeWorldMapBuild/.test(script)) {
  throw new Error("World Map Builder saves must not replace gesture state with a detached object graph.");
}
if (script.includes("nativeCheck ?? await resolveModeledCheckWithRoll")) {
  throw new Error("Live combat must not silently replace a failed PF2e control with a modeled roll.");
}
const adapterScript = await readFile(resolve(root, "scripts/simulation-adapters.js"), "utf8");
if (!adapterScript.includes('"spell-save"') || !adapterScript.includes('"spell-damage"')) {
  throw new Error("Native PF2e spell-card Save and Damage controls are not wired.");
}
const templateActions = [...template.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
for (const action of new Set(templateActions)) {
  if (!new RegExp(`\\b${action}:\\s*LoreSmithDashboard\\.`).test(script)) {
    throw new Error(`Template action "${action}" is not wired in the dashboard.`);
  }
}

for (const action of new Set([...liveTemplate.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]))) {
  if (!new RegExp(`\\b${action}:\\s*LoreSmithLiveLog\\.`).test(nativeScript)) {
    throw new Error(`Template action "${action}" is not wired in the live combat window.`);
  }
}

for (const [name, contents, className] of [
  ["creature builder", creatureTemplate, "LoreSmithCreatureBuilder"],
  ["item builder", itemTemplate, "LoreSmithItemBuilder"],
]) {
  const actions = [...contents.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
  for (const action of new Set(actions)) {
    if (!new RegExp(`\\b${action}:\\s*${className}\\.`).test(nativeScript)) {
      throw new Error(`Template action "${action}" is not wired in the ${name}.`);
    }
  }
}

for (const requiredItemBuilderFeature of [
  "lsCompileItemBuilderDescription",
  "lsCompileActivationRows",
  "lsSyncOwnedItemActivations",
  'type: "action"',
  'itemActivation: { sourceItemId: item.id, activationId: activation.id }',
  "lsGeneratedRule",
  'key: "FlatModifier"',
  'key: "DamageDice"',
  'key: "Resistance"',
  'key: "Weakness"',
  'key: "Immunity"',
  'key: "FastHealing"',
  'key: "RollOption"',
  "persistBuilderAutomation",
]) {
  if (!nativeScript.includes(requiredItemBuilderFeature)) throw new Error(`Native item builder feature missing: ${requiredItemBuilderFeature}`);
}
for (const requiredStep of ["Starting point", "Identity", "Activations", "Effects", "Review"]) {
  if (!itemTemplate.includes(requiredStep)) throw new Error(`Item builder step missing: ${requiredStep}`);
}

console.log(JSON.stringify({
  module: manifest.id,
  version: manifest.version,
  actions: new Set([
    ...templateActions,
    ...[...creatureTemplate.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
    ...[...itemTemplate.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]),
  ]).size,
  status: "valid",
}));
