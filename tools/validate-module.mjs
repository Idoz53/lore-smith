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

for (const relativePath of [...manifest.esmodules, ...manifest.styles, "templates/dashboard.hbs"]) {
  await access(resolve(root, relativePath), constants.R_OK);
}

const script = await readFile(resolve(root, "scripts/main.js"), "utf8");
const template = await readFile(resolve(root, "templates/dashboard.hbs"), "utf8");
const templateActions = [...template.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
for (const action of new Set(templateActions)) {
  if (!new RegExp(`\\b${action}:\\s*LoreSmithDashboard\\.`).test(script)) {
    throw new Error(`Template action "${action}" is not wired in the dashboard.`);
  }
}

console.log(JSON.stringify({
  module: manifest.id,
  version: manifest.version,
  actions: new Set(templateActions).size,
  status: "valid",
}));
