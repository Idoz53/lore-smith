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
if (nativeScript.includes("lsMountAlwaysEditableJournalPages") || nativeScript.includes('data-action="editPage"')) {
  throw new Error("Lore Smith must leave Foundry's native read view and edit button intact.");
}
if (!nativeScript.includes("lsEnableJournalWikiLinksInEditor")
  || !nativeScript.includes("lsEnhanceJournalPageEditor")
  || !nativeScript.includes("lsOpenOrCreateJournalPage")
  || !nativeScript.includes("lsJournalWikiDraftFromSelection")
  || !nativeScript.includes("ls-journal-link-autocomplete")
  || !nativeScript.includes("lore-smith-wiki-brackets")
  || !nativeScript.includes("lore-smith-wiki-links")) {
  throw new Error("Journal page-editor wiki-link handling is missing.");
}
if (!script.includes("combatantInsideTemplate") || !script.includes("rollNativeDamage")) {
  throw new Error("Live area hit-testing or native PF2e damage controls are missing.");
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
