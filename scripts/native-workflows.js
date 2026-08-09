import { coverageReportHtml } from "./simulation-adapters.js";
import { creatureTableRow, safeItemGuidance } from "./building-creatures-data.js";

const LS_MODULE_ID = "lore-smith";
const { ApplicationV2: LSApplicationV2, HandlebarsApplicationMixin: LSHandlebarsMixin, DialogV2: LSDialogV2 } = foundry.applications.api;

function lsNumber(value, fallback = 0) {
  const result = Number(value?.value ?? value?.mod ?? value);
  return Number.isFinite(result) ? result : fallback;
}

function lsRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
}

function lsTraits(document) {
  return [...(document.system?.traits?.value ?? [])];
}

function lsSplitTraits(value) {
  return [...new Set(String(value ?? "").split(",").map((trait) => trait.trim().toLowerCase()).filter(Boolean))];
}

function lsParseTagify(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return [...new Set((Array.isArray(parsed) ? parsed : []).map((tag) => tag.id ?? tag.value).filter(Boolean))];
  } catch {
    return lsSplitTraits(value);
  }
}

function lsTraitChoices(...records) {
  const choices = new Map();
  for (const record of records) {
    for (const [value, data] of Object.entries(record ?? {})) {
      const label = game.i18n.localize(data?.label ?? data ?? value);
      choices.set(value, { value, label });
    }
  }
  return [...choices.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function lsMeaningfulNpcSkill(skill) {
  return lsNumber(skill?.base, 0) !== 0
    || Boolean(String(skill?.note ?? "").trim())
    || (Array.isArray(skill?.special) && skill.special.length > 0);
}

function lsBenchmarks(level) {
  const named = (names, values) => names.map((label, index) => ({ label, value: values[index] })).filter((entry) => entry.value != null);
  const hp = creatureTableRow("hitPoints", level);
  const skill = creatureTableRow("skills", level);
  return {
    attributes: named(["Extreme", "High", "Moderate", "Low"], creatureTableRow("attributes", level)),
    ac: named(["Extreme", "High", "Moderate", "Low"], creatureTableRow("armorClass", level)),
    hp: ["High", "Moderate", "Low"].map((label, index) => ({ label: `${label} ${hp[index][0]}–${hp[index][1]}`, value: Math.round((hp[index][0] + hp[index][1]) / 2), range: hp[index] })),
    perception: named(["Extreme", "High", "Moderate", "Low", "Terrible"], creatureTableRow("perception", level)),
    saves: named(["Extreme", "High", "Moderate", "Low", "Terrible"], creatureTableRow("saves", level)),
    skills: [
      ...named(["Extreme", "High", "Moderate"], skill.slice(0, 3)),
      { label: `Low (${skill[3][0]}–${skill[3][1]})`, value: Math.round((skill[3][0] + skill[3][1]) / 2) },
    ],
  };
}

const LS_SPEED_TYPES = [["land", "Land / walk"], ["fly", "Fly"], ["swim", "Swim"], ["climb", "Climb"], ["burrow", "Burrow"]];
const LS_SENSE_TYPES = [
  ["darkvision", "Darkvision", "precise"], ["greater-darkvision", "Greater darkvision", "precise"],
  ["low-light-vision", "Low-light vision", "precise"], ["scent", "Scent", "imprecise"],
  ["tremorsense", "Tremorsense", "imprecise"], ["echolocation", "Echolocation", "precise"],
  ["lifesense", "Lifesense", "imprecise"], ["motionsense", "Motionsense", "imprecise"],
  ["thoughtsense", "Thoughtsense", "imprecise"], ["wavesense", "Wavesense", "imprecise"],
  ["see-invisibility", "See invisibility", "precise"], ["truesight", "Truesight", "precise"],
];

const LS_CREATURE_ROADMAPS = {
  brute: { label: "Brute", description: "Tough and forceful: high HP and Fortitude, but weaker AC, Reflex, Will, and Perception.", stats: { ac: "moderate", hp: "high", perception: "low", fortitude: "high", reflex: "low", will: "low", speed: 25, str: "high", dex: "low", con: "high", int: "low", wis: "moderate", cha: "low" } },
  magicalStriker: { label: "Magical Striker", description: "A weapon threat backed by a smaller magical toolkit and a moderate-to-high spell DC.", stats: { ac: "moderate", hp: "moderate", perception: "moderate", fortitude: "moderate", reflex: "moderate", will: "high", speed: 25, str: "high", dex: "moderate", con: "moderate", int: "high", wis: "moderate", cha: "moderate" } },
  skillParagon: { label: "Skill Paragon", description: "Excels at several skills, with one or two signature extreme skills and a skill-driven combat trick.", stats: { ac: "moderate", hp: "moderate", perception: "high", fortitude: "low", reflex: "high", will: "moderate", speed: 25, str: "moderate", dex: "high", con: "low", int: "high", wis: "moderate", cha: "moderate" } },
  skirmisher: { label: "Skirmisher", description: "A mobile combatant with high Reflex, a faster Speed, and weaker Fortitude.", stats: { ac: "moderate", hp: "moderate", perception: "moderate", fortitude: "low", reflex: "high", will: "moderate", speed: 35, str: "moderate", dex: "high", con: "low", int: "moderate", wis: "moderate", cha: "low" } },
  sniper: { label: "Sniper", description: "A perceptive ranged threat with strong accuracy, low HP, and a deliberately weaker melee option.", stats: { ac: "moderate", hp: "low", perception: "high", fortitude: "low", reflex: "high", will: "moderate", speed: 25, str: "low", dex: "high", con: "low", int: "moderate", wis: "high", cha: "moderate" } },
  soldier: { label: "Soldier", description: "A durable frontliner with high AC, Fortitude, attack accuracy, and tactical reactions.", stats: { ac: "high", hp: "moderate", perception: "moderate", fortitude: "high", reflex: "moderate", will: "low", speed: 25, str: "high", dex: "moderate", con: "high", int: "low", wis: "moderate", cha: "low" } },
  spellcaster: { label: "Spellcaster", description: "A fragile magical specialist with high Will and spell DCs, but low HP, Fortitude, and weapon offense.", stats: { ac: "low", hp: "low", perception: "moderate", fortitude: "low", reflex: "moderate", will: "high", speed: 25, str: "low", dex: "moderate", con: "low", int: "high", wis: "high", cha: "high" } },
};

function lsCreatureConcept(actor) {
  return foundry.utils.mergeObject({
    concept: "", roadmap: "", intendedUse: "combatant", complexity: "standard", combatFeel: "", strengths: "", weaknesses: "",
  }, actor.getFlag(LS_MODULE_ID, "creatureConcept") ?? {}, { inplace: false });
}

function lsClosestTier(value, values, labels) {
  let best = 0;
  values.forEach((candidate, index) => {
    if (Math.abs(Number(value) - Number(candidate)) < Math.abs(Number(value) - Number(values[best]))) best = index;
  });
  return { label: labels[best], rank: best, value: values[best] };
}

function lsHpTier(value, level) {
  const ranges = creatureTableRow("hitPoints", level);
  const labels = ["High", "Moderate", "Low"];
  const distance = ([minimum, maximum]) => value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
  let best = 0;
  ranges.forEach((range, index) => { if (distance(range) < distance(ranges[best])) best = index; });
  return { label: labels[best], rank: best, range: ranges[best] };
}

function lsBenchmarkReference(level) {
  const format = (labels, values, prefix = "+") => labels.map((label, index) => `${label} ${values[index] == null ? "—" : `${prefix}${values[index]}`}`).join(" · ");
  const hp = creatureTableRow("hitPoints", level);
  const resistance = creatureTableRow("resistance", level);
  const spell = creatureTableRow("spell", level);
  const safe = safeItemGuidance(level);
  return [
    { name: "Attribute modifiers", values: format(["Extreme", "High", "Moderate", "Low"], creatureTableRow("attributes", level)) },
    { name: "Perception", values: format(["Extreme", "High", "Moderate", "Low", "Terrible"], creatureTableRow("perception", level)) },
    { name: "Skills", values: `${format(["Extreme", "High", "Moderate"], creatureTableRow("skills", level).slice(0, 3))} · Low +${creatureTableRow("skills", level)[3][0]} to +${creatureTableRow("skills", level)[3][1]}` },
    { name: "Armor Class", values: format(["Extreme", "High", "Moderate", "Low"], creatureTableRow("armorClass", level), "") },
    { name: "Saving throws", values: format(["Extreme", "High", "Moderate", "Low", "Terrible"], creatureTableRow("saves", level)) },
    { name: "Hit Points", values: ["High", "Moderate", "Low"].map((label, index) => `${label} ${hp[index][0]}–${hp[index][1]}`).join(" · ") },
    { name: "Resistances / weaknesses", values: `Maximum ${resistance[0]} · Minimum ${resistance[1]}` },
    { name: "Strike attack", values: format(["Extreme", "High", "Moderate", "Low"], creatureTableRow("strikeAttack", level)) },
    { name: "Strike damage", values: format(["Extreme", "High", "Moderate", "Low"], creatureTableRow("strikeDamage", level), "") },
    { name: "Spell DC / attack", values: `Extreme DC ${spell[0]}, +${spell[1]} · High DC ${spell[2]}, +${spell[3]} · Moderate DC ${spell[4]}, +${spell[5]}` },
    { name: "Area damage", values: `Unlimited ${creatureTableRow("areaDamage", level)[0]} · Limited ${creatureTableRow("areaDamage", level)[1]}` },
    { name: "Safe item", values: `Item level ${safe.level}${safe.note ? ` · ${safe.note}` : ""}` },
  ];
}

function lsBalanceReport(actor, concept) {
  const level = lsNumber(actor.system.details?.level, 0);
  const system = actor.system;
  const core = [
    { name: "AC", ...lsClosestTier(lsNumber(system.attributes?.ac, 10), creatureTableRow("armorClass", level), ["Extreme", "High", "Moderate", "Low"]) },
    { name: "Perception", ...lsClosestTier(lsNumber(system.perception, 0), creatureTableRow("perception", level), ["Extreme", "High", "Moderate", "Low", "Terrible"]) },
    { name: "Fortitude", ...lsClosestTier(lsNumber(system.saves?.fortitude, 0), creatureTableRow("saves", level), ["Extreme", "High", "Moderate", "Low", "Terrible"]) },
    { name: "Reflex", ...lsClosestTier(lsNumber(system.saves?.reflex, 0), creatureTableRow("saves", level), ["Extreme", "High", "Moderate", "Low", "Terrible"]) },
    { name: "Will", ...lsClosestTier(lsNumber(system.saves?.will, 0), creatureTableRow("saves", level), ["Extreme", "High", "Moderate", "Low", "Terrible"]) },
  ];
  const hp = lsHpTier(lsNumber(system.attributes?.hp?.max, 1), level);
  const issues = [];
  const extremeCount = core.filter((stat) => stat.label === "Extreme").length;
  const allowedExtreme = level >= 20 ? 4 : level >= 15 ? 2 : 1;
  if (extremeCount > allowedExtreme) issues.push({ severity: "warning", text: `${extremeCount} extreme core statistics is unusual at level ${level}; GM Core guidance suggests about ${allowedExtreme}.` });
  if (core[0].label === "Extreme" && hp.label === "High") issues.push({ severity: "warning", text: "Extreme AC paired with high HP can make the creature frustratingly durable. Pull one of them down." });
  if (core.slice(2).filter((stat) => stat.label === "Extreme").length > 1) issues.push({ severity: "warning", text: "A creature should normally have only one extreme saving throw." });
  if (![...core, hp].some((stat) => ["Low", "Terrible"].includes(stat.label))) issues.push({ severity: "warning", text: "No low statistic is visible. Most creatures need a clear weakness to pay for their strengths." });
  const size = system.traits?.size?.value ?? "med";
  const minimumSizeLevel = { lg: 1, huge: 5, grg: 10 }[size];
  if (minimumSizeLevel != null && level < minimumSizeLevel) issues.push({ severity: "info", text: "This size is uncommon at the selected level. It can work, but review reach, space, and encounter impact." });
  const roadmap = LS_CREATURE_ROADMAPS[concept.roadmap];
  if (roadmap && ["spellcaster", "magicalStriker"].includes(concept.roadmap) && !actor.items.some((item) => item.type === "spell")) issues.push({ severity: "info", text: `${roadmap.label} expects a magical toolkit, but no spells are attached yet.` });
  if (!issues.some((issue) => issue.severity === "warning")) issues.unshift({ severity: "good", text: "The visible core statistics follow the GM Core push-and-pull guidance." });
  return {
    core: [...core, { name: "HP", label: hp.label, value: lsNumber(system.attributes?.hp?.max, 1) }],
    issues: issues.map((issue) => ({ ...issue, icon: issue.severity === "warning" ? "fa-triangle-exclamation" : issue.severity === "good" ? "fa-circle-check" : "fa-circle-info" })),
    reference: lsBenchmarkReference(level), roadmap,
  };
}

const LS_BENCHMARK_TIERS = ["extreme", "high", "moderate", "low"];
const LS_BENCHMARK_LABELS = {
  extreme: "Extreme", high: "High", moderate: "Moderate", low: "Low", terrible: "Terrible",
  unlimited: "Area: unlimited use", limited: "Area: limited use", "area-unlimited": "Area: unlimited use",
  "area-limited": "Area: limited use", "strike-extreme": "Single target: extreme", "strike-high": "Single target: high",
  "strike-moderate": "Single target: moderate", "strike-low": "Single target: low", none: "No damage", custom: "Custom",
};

function lsStrikeFormula(value) {
  return String(value ?? "1d4").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function lsTierValue(table, level, tier) {
  const index = LS_BENCHMARK_TIERS.indexOf(tier);
  return index >= 0 ? creatureTableRow(table, level)[index] : null;
}

function lsStrikeWorkshop(level) {
  const attack = creatureTableRow("strikeAttack", level);
  const damage = creatureTableRow("strikeDamage", level);
  const area = creatureTableRow("areaDamage", level);
  const spell = creatureTableRow("spell", level);
  return {
    attackTiers: LS_BENCHMARK_TIERS.map((tier, index) => ({ value: tier, label: `${LS_BENCHMARK_LABELS[tier]} (+${attack[index]})`, result: attack[index], selected: tier === "high" })).concat({ value: "custom", label: "Custom attack bonus" }),
    damageTiers: LS_BENCHMARK_TIERS.map((tier, index) => ({ value: tier, label: `${LS_BENCHMARK_LABELS[tier]} — ${damage[index]}`, result: lsStrikeFormula(damage[index]), selected: tier === "high" })).concat({ value: "custom", label: "Custom damage formula" }),
    areaTiers: [
      { value: "none", label: "No damage", result: "" },
      ...LS_BENCHMARK_TIERS.map((tier, index) => ({ value: `strike-${tier}`, label: `Single target: ${LS_BENCHMARK_LABELS[tier]} — ${damage[index]}`, result: lsStrikeFormula(damage[index]) })),
      { value: "area-unlimited", label: `Area: unlimited use — ${area[0]}`, result: lsStrikeFormula(area[0]), selected: true },
      { value: "area-limited", label: `Area: limited use — ${area[1]}`, result: lsStrikeFormula(area[1]) },
      { value: "custom", label: "Custom damage formula", result: "" },
    ],
    dcTiers: [
      { value: "extreme", label: `Extreme DC ${spell[0]}`, result: spell[0] },
      { value: "high", label: `High DC ${spell[2]}`, result: spell[2], selected: true },
      { value: "moderate", label: `Moderate DC ${spell[4]}`, result: spell[4] },
      { value: "custom", label: "Custom DC", result: "" },
    ],
  };
}

function lsAreaDamageFormula(level, tier) {
  if (tier === "unlimited" || tier === "area-unlimited") return lsStrikeFormula(creatureTableRow("areaDamage", level)[0]);
  if (tier === "limited" || tier === "area-limited") return lsStrikeFormula(creatureTableRow("areaDamage", level)[1]);
  if (tier?.startsWith?.("strike-")) return lsStrikeFormula(lsTierValue("strikeDamage", level, tier.slice(7)));
  return "";
}

function lsSpellDc(level, tier) {
  const values = creatureTableRow("spell", level);
  return tier === "extreme" ? values[0] : tier === "high" ? values[2] : tier === "moderate" ? values[4] : null;
}

function lsAbilityDescription(link, level) {
  const formula = link.damageTier === "custom" ? link.customDamage : lsAreaDamageFormula(level, link.damageTier);
  const dc = link.dcTier === "custom" ? Number(link.customDc) : lsSpellDc(level, link.dcTier);
  const save = link.save ?? "reflex";
  const hasArea = link.delivery === "area";
  const hasSave = save !== "none";
  const template = hasArea && link.areaShape && link.areaDistance
    ? `@Template[type:${link.areaShape}|distance:${Number(link.areaDistance)}]`
    : "";
  const check = hasSave && Number.isFinite(dc) ? `@Check[${save}|dc:${dc}|basic]` : "";
  const damage = formula ? `@Damage[${formula}[${link.damageType ?? "untyped"}]]` : "";
  const requirements = link.requirements ? `<p><strong>Requirements</strong> ${lsEscapeHtml(link.requirements)}</p>` : "";
  const trigger = link.trigger ? `<p><strong>Trigger</strong> ${lsEscapeHtml(link.trigger)}</p>` : "";
  const duration = link.duration ? `<p><strong>Duration</strong> ${lsEscapeHtml(link.duration)}</p>` : "";
  const condition = link.condition ? ` On the specified result, it gains <strong>${lsEscapeHtml(link.condition)}</strong>${link.conditionValue ? ` ${Number(link.conditionValue)}` : ""}.` : "";
  const area = hasArea ? `<p><strong>Area</strong> ${Number(link.areaDistance) || 5}-foot ${lsEscapeHtml(link.areaShape ?? "burst")} ${template}</p>` : "";
  const range = link.delivery === "target" && Number(link.range) > 0 ? `<p><strong>Range</strong> ${Number(link.range)} feet</p>` : "";
  const target = link.delivery === "self" ? "<p><strong>Targets</strong> Self</p>" : "";
  const defense = hasSave ? `<p><strong>Defense</strong> basic ${lsEscapeHtml(save)} ${check}</p>` : "";
  const defaultEffect = formula
    ? `${hasArea ? "Creatures in the area" : "The target"} take the listed damage.`
    : "Apply the listed effect.";
  const effect = link.effectText ? lsEscapeHtml(link.effectText) : defaultEffect;
  return `${requirements}${trigger}${range}${target}${area}${defense}<p><strong>Effect</strong> ${effect} ${damage}${condition}</p>${duration}`;
}

function lsAbilityActionData(usage, actions) {
  if (usage === "reaction") return { actionType: "reaction", actions: null, icon: "Reaction.webp" };
  if (usage === "free") return { actionType: "free", actions: null, icon: "FreeAction.webp" };
  if (usage === "passive") return { actionType: "passive", actions: null, icon: "Passive.webp" };
  const count = Math.max(1, Math.min(3, Number(actions) || 1));
  return { actionType: "action", actions: count, icon: ["OneAction.webp", "TwoActions.webp", "ThreeActions.webp"][count - 1] };
}

function lsCreatureDamageLink(item) {
  return item.getFlag(LS_MODULE_ID, "creatureDamageLink") ?? null;
}

async function lsRecalculateLinkedCreatureEntries(actor, level, { notify = false } = {}) {
  const updates = [];
  for (const item of actor.items) {
    const link = lsCreatureDamageLink(item);
    if (!link?.autoScale) continue;
    if (link.kind === "strike" && item.type === "melee") {
      const update = { _id: item.id, [`flags.${LS_MODULE_ID}.creatureDamageLink.levelApplied`]: level };
      if (link.attackTier !== "custom") update["system.bonus.value"] = lsTierValue("strikeAttack", level, link.attackTier);
      if (link.damageTier !== "custom" && link.primaryDamageId) update[`system.damageRolls.${link.primaryDamageId}.damage`] = lsStrikeFormula(lsTierValue("strikeDamage", level, link.damageTier));
      updates.push(update);
    } else if (link.kind === "ability" && item.type === "action") {
      updates.push({
        _id: item.id,
        "system.description.value": lsAbilityDescription(link, level),
        [`flags.${LS_MODULE_ID}.creatureDamageLink.levelApplied`]: level,
      });
    }
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, { loreSmithAutoScale: true });
  if (notify) ui.notifications.info(`Recalculated ${updates.length} level-linked entr${updates.length === 1 ? "y" : "ies"} for level ${level}.`);
  return updates.length;
}

function lsItemTraitConfig() {
  return Object.assign({},
    CONFIG.PF2E.actionTraits,
    CONFIG.PF2E.armorTraits,
    CONFIG.PF2E.consumableTraits,
    CONFIG.PF2E.equipmentTraits,
    CONFIG.PF2E.featTraits,
    CONFIG.PF2E.spellTraits,
    CONFIG.PF2E.weaponTraits);
}

function lsIsBestiaryAbilityGlossary(pack) {
  const identity = `${pack.collection ?? ""} ${pack.metadata?.label ?? ""}`.toLowerCase();
  return /bestiary[\s._-]*abilit(?:y|ies)[\s._-]*glossary/.test(identity)
    || identity.includes("bestiary ability glossary");
}

const LS_CREATURE_CONTENT_TYPES = new Set(["action", "feat", "melee", "spell", "effect"]);
let lsEmbeddedCreatureContentPromise = null;

function lsPlainSearchText(value) {
  return String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function lsEmbeddedItemResult(pack, actor, item) {
  const actorLevel = lsNumber(actor.system?.details?.level, 0);
  const traits = item.system?.traits?.value ?? [];
  const itemId = item._id ?? item.id;
  const actorId = actor._id ?? actor.id;
  return {
    name: item.name,
    img: item.img,
    type: item.type,
    level: lsNumber(item.system?.level, actorLevel),
    traits,
    pack: pack.metadata?.label ?? pack.collection,
    sourceCreature: actor.name,
    description: lsPlainSearchText(item.system?.description?.value),
    uuid: `Compendium.${pack.collection}.Actor.${actorId}.Item.${itemId}`,
  };
}

async function lsBuildEmbeddedCreatureContentIndex() {
  if (lsEmbeddedCreatureContentPromise) return lsEmbeddedCreatureContentPromise;
  lsEmbeddedCreatureContentPromise = (async () => {
    const results = [];
    for (const pack of game.packs.filter((candidate) => candidate.documentName === "Actor")) {
      try {
        // Use the lightweight compendium index where possible. Foundry versions that
        // do not expose embedded arrays here fall back to loading that pack once.
        let actors = [];
        try {
          const index = await pack.getIndex({
            fields: ["name", "type", "system.details.level.value", "items"],
          });
          actors = [...index];
        } catch (indexError) {
          console.debug(`${LS_MODULE_ID} | ${pack.collection} requires full-document ability indexing.`, indexError);
        }
        const npcEntries = actors.filter((actor) => actor.type === "npc");
        if (!actors.length || (npcEntries.length && !npcEntries.some((actor) => Array.isArray(actor.items) && actor.items.length))) {
          actors = await pack.getDocuments();
        }
        for (const actor of actors) {
          if (actor.type !== "npc") continue;
          const items = Array.isArray(actor.items) ? actor.items : [...(actor.items ?? [])];
          for (const item of items) {
            if (!LS_CREATURE_CONTENT_TYPES.has(item.type)) continue;
            results.push(lsEmbeddedItemResult(pack, actor, item));
          }
        }
      } catch (error) {
        console.warn(`${LS_MODULE_ID} | Could not index embedded NPC abilities from ${pack.collection}`, error);
      }
    }
    return results;
  })();
  return lsEmbeddedCreatureContentPromise;
}

function lsContentSearchScore(entry, normalized) {
  if (!normalized) return 0;
  const name = String(entry.name ?? "").toLowerCase();
  if (name === normalized) return 100;
  if (name.startsWith(normalized)) return 80;
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(normalized))) return 60;
  if (name.includes(normalized)) return 50;
  return 10;
}

async function lsSearchCreatureContent({ query = "", types = [], limit = 250, bestiaryGlossaryOnly = false }) {
  if (bestiaryGlossaryOnly) {
    return lsSearchPacks({ documentName: "Item", query, types, limit, bestiaryGlossaryOnly: true });
  }
  const normalized = String(query ?? "").trim().toLowerCase();
  const [standalone, embedded] = await Promise.all([
    lsSearchPacks({ documentName: "Item", query, types, limit: Number.POSITIVE_INFINITY }),
    lsBuildEmbeddedCreatureContentIndex(),
  ]);
  const matchingEmbedded = embedded.filter((entry) => {
    if (types.length && !types.includes(entry.type)) return false;
    if (!normalized) return true;
    const haystack = `${entry.name} ${entry.traits.join(" ")} ${entry.description} ${entry.sourceCreature}`.toLowerCase();
    return haystack.includes(normalized);
  });
  const seen = new Set();
  return [...standalone, ...matchingEmbedded]
    .sort((left, right) => {
      const score = lsContentSearchScore(right, normalized) - lsContentSearchScore(left, normalized);
      return score || left.name.localeCompare(right.name)
        || String(left.sourceCreature ?? "").localeCompare(String(right.sourceCreature ?? ""));
    })
    .filter((entry) => {
      // Collapse exact copies repeated on multiple creatures while retaining variants
      // with different text, traits, or action mechanics.
      const key = `${entry.type}|${entry.name}|${entry.description ?? ""}|${entry.traits.join(" ")}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function lsSearchPacks({
  documentName,
  query = "",
  types = [],
  level = "",
  trait = "",
  limit = Number.POSITIVE_INFINITY,
  bestiaryGlossaryOnly = false,
}) {
  const normalized = String(query ?? "").trim().toLowerCase();
  const results = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === documentName)) {
    if (bestiaryGlossaryOnly && !lsIsBestiaryAbilityGlossary(pack)) continue;
    const fields = documentName === "Actor"
      ? ["name", "img", "type", "system.details.level.value", "system.traits.value", "system.traits.size.value"]
      : ["name", "img", "type", "system.level.value", "system.traits.value", ...(normalized ? ["system.description.value"] : [])];
    const index = await pack.getIndex({ fields });
    for (const entry of index) {
      if (types.length && !types.includes(entry.type)) continue;
      const traits = entry.system?.traits?.value ?? [];
      const entryLevel = lsNumber(entry.system?.details?.level ?? entry.system?.level, 0);
      const description = String(entry.system?.description?.value ?? "").replace(/<[^>]+>/g, " ");
      const haystack = `${entry.name} ${traits.join(" ")} ${description}`.toLowerCase();
      if (normalized && !haystack.includes(normalized)) continue;
      if (level !== "" && entryLevel !== Number(level)) continue;
      if (trait && !traits.includes(trait)) continue;
      results.push({
        name: entry.name,
        img: entry.img,
        type: entry.type,
        level: entryLevel,
        traits,
        pack: pack.metadata.label,
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${documentName}.${entry._id}`,
      });
      if (results.length >= limit) return results.sort((left, right) => left.name.localeCompare(right.name));
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name));
}

async function lsBuildSourcePreview(uuid) {
  const source = await fromUuid(uuid);
  if (!source) return null;
  const traits = lsTraits(source).map((value) =>
    game.i18n.localize(CONFIG.PF2E.creatureTraits?.[value] ?? lsItemTraitConfig()[value] ?? value));
  if (source.documentName === "Actor") {
    return {
      uuid,
      kind: "creature",
      name: source.name,
      img: source.img,
      type: source.type,
      level: lsNumber(source.system?.details?.level, 0),
      traits,
      ac: lsNumber(source.system?.attributes?.ac, 10),
      hp: lsNumber(source.system?.attributes?.hp?.max, 1),
      perception: lsNumber(source.system?.perception, 0),
      speed: lsNumber(source.system?.attributes?.speed, 25),
      entries: source.items.map((item) => ({ name: item.name, type: item.type })).slice(0, 40),
      description: source.system?.details?.publicNotes ?? "",
    };
  }
  const price = source.system?.price?.value;
  return {
    uuid,
    kind: "item",
    name: source.name,
    img: source.img,
    type: source.type,
    level: lsNumber(source.system?.level, 0),
    traits,
    usage: source.system?.usage?.value ?? source.system?.usage ?? "",
    bulk: source.system?.bulk?.value ?? source.system?.bulk ?? "",
    price: price && typeof price === "object"
      ? Object.entries(price).map(([coin, amount]) => `${amount} ${coin}`).join(", ")
      : price ?? "",
    description: source.system?.description?.value ?? "",
  };
}

function lsActionCostLabel(item) {
  const actionType = item.system?.actionType?.value ?? item.system?.actionType ?? "";
  const actions = lsNumber(item.system?.actions, 0);
  const time = item.system?.time?.value ?? item.system?.time ?? "";
  if (actionType === "reaction") return "Reaction";
  if (actionType === "free") return "Free action";
  if (actionType === "passive") return "Passive";
  if (actions > 0) return `${actions} action${actions === 1 ? "" : "s"}`;
  return String(time || "As described");
}

async function lsBuildContentPreview(uuid) {
  const source = await fromUuid(uuid);
  if (!source || source.documentName !== "Item") return null;
  const description = await TextEditor.enrichHTML(source.system?.description?.value ?? "", {
    async: true,
    secrets: game.user.isGM,
    relativeTo: source,
  });
  const traitConfig = lsItemTraitConfig();
  const traits = lsTraits(source).map((value) => ({
    value,
    label: game.i18n.localize(traitConfig[value] ?? value),
  }));
  const parent = source.parent?.documentName === "Actor" ? source.parent : null;
  return {
    uuid,
    name: source.name,
    img: source.img,
    type: source.type,
    level: lsNumber(source.system?.level, lsNumber(parent?.system?.details?.level, 0)),
    traits,
    actionCost: lsActionCostLabel(source),
    sourceCreature: parent?.name ?? "",
    sourcePack: source.compendium?.title ?? parent?.compendium?.title ?? "PF2e content",
    description,
  };
}

class LoreSmithCreatureBuilder extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-creature-builder-{id}",
    classes: ["lore-smith-builder"],
    position: { width: 1180, height: 800 },
    window: { title: "Lore Smith Creature Builder", icon: "fa-solid fa-dragon", resizable: true },
    actions: {
      previous: LoreSmithCreatureBuilder.previous,
      next: LoreSmithCreatureBuilder.next,
      searchSource: LoreSmithCreatureBuilder.searchSource,
      previousSources: LoreSmithCreatureBuilder.previousSources,
      nextSources: LoreSmithCreatureBuilder.nextSources,
      previewSource: LoreSmithCreatureBuilder.previewSource,
      useSource: LoreSmithCreatureBuilder.useSource,
      useCurrent: LoreSmithCreatureBuilder.useCurrent,
      applyRoadmap: LoreSmithCreatureBuilder.applyRoadmap,
      createLinkedStrike: LoreSmithCreatureBuilder.createLinkedStrike,
      createLinkedAbility: LoreSmithCreatureBuilder.createLinkedAbility,
      createLinkedPassive: LoreSmithCreatureBuilder.createLinkedPassive,
      recalculateLinked: LoreSmithCreatureBuilder.recalculateLinked,
      toggleLinkedScaling: LoreSmithCreatureBuilder.toggleLinkedScaling,
      addTrait: LoreSmithCreatureBuilder.addTrait,
      removeTrait: LoreSmithCreatureBuilder.removeTrait,
      addSkill: LoreSmithCreatureBuilder.addSkill,
      removeSkill: LoreSmithCreatureBuilder.removeSkill,
      addSpeed: LoreSmithCreatureBuilder.addSpeed,
      removeSpeed: LoreSmithCreatureBuilder.removeSpeed,
      addSense: LoreSmithCreatureBuilder.addSense,
      removeSense: LoreSmithCreatureBuilder.removeSense,
      createSpellcastingEntry: LoreSmithCreatureBuilder.createSpellcastingEntry,
      goToStep: LoreSmithCreatureBuilder.goToStep,
      searchContent: LoreSmithCreatureBuilder.searchContent,
      previewContent: LoreSmithCreatureBuilder.previewContent,
      addContent: LoreSmithCreatureBuilder.addContent,
      removeContent: LoreSmithCreatureBuilder.removeContent,
      finish: LoreSmithCreatureBuilder.finish,
    },
  };

  static PARTS = {
    builder: { template: `modules/${LS_MODULE_ID}/templates/creature-builder.hbs` },
  };

  constructor(actor, options = {}) {
    super({ ...options, id: `lore-smith-creature-builder-${actor.id}` });
    this.actor = actor;
  }

  step = 0;
  sourceQuery = "";
  sourceLevel = "";
  sourceTrait = "";
  sourcePage = 0;
  sourcePageSize = 60;
  sourceAllResults = [];
  sourcesLoaded = false;
  contentQuery = "";
  contentType = "";
  contentGlossaryOnly = false;
  contentScrollTop = 0;
  builderScrollTop = 0;
  resetBuilderScroll = false;
  loadedContentStep = null;
  spellcastingEntryId = "";
  sourceResults = [];
  sourcePreview = null;
  contentPreview = null;
  contentResults = [];

  async _prepareContext(options) {
    const oldViewport = this.element?.querySelector?.(".ls-builder-body") ?? this.element?.closest?.(".window-content");
    if (this.resetBuilderScroll) {
      this.builderScrollTop = 0;
      this.resetBuilderScroll = false;
    } else if (oldViewport) this.builderScrollTop = oldViewport.scrollTop;
    if (this.step === 0 && !this.sourcesLoaded) await this.loadSources();
    if ([4, 5].includes(this.step) && this.loadedContentStep !== this.step) {
      this.contentQuery = "";
      this.contentType = this.step === 5 ? "spell" : "";
      this.contentGlossaryOnly = false;
      this.contentResults = await lsSearchCreatureContent({
        types: this.step === 5 ? ["spell"] : ["action", "feat", "melee", "effect"],
        limit: 250,
      });
      if (this.contentResults[0]) this.contentPreview = await lsBuildContentPreview(this.contentResults[0].uuid);
      this.loadedContentStep = this.step;
    }
    const actor = this.actor;
    const system = actor.system;
    const level = lsNumber(system.details?.level, 0);
    const actorSize = system.traits?.size?.value ?? "med";
    const concept = lsCreatureConcept(actor);
    const benchmarkRows = lsBenchmarks(level);
    const damageWorkshop = lsStrikeWorkshop(level);
    const markSelected = (rows, value) => rows.map((row) => ({ ...row, selected: Number(row.value) === Number(value) }));
    const traitChoices = lsTraitChoices(CONFIG.PF2E.creatureTraits);
    const attackTraitChoices = lsTraitChoices(CONFIG.PF2E.npcAttackTraits, CONFIG.PF2E.weaponTraits, CONFIG.PF2E.actionTraits);
    const actionTraitChoices = lsTraitChoices(CONFIG.PF2E.actionTraits, CONFIG.PF2E.featTraits, CONFIG.PF2E.spellTraits);
    const storedSkills = actor._source?.system?.skills ?? {};
    const builderSkillSlugs = new Set(actor.getFlag(LS_MODULE_ID, "builderSkills") ?? []);
    const visibleSkillSlugs = new Set(Object.entries(storedSkills)
      .filter(([slug, skill]) => builderSkillSlugs.has(slug) || lsMeaningfulNpcSkill(skill))
      .map(([slug]) => slug));
    const existingSkills = system.skills ?? {};
    const skillConfig = CONFIG.PF2E.skills ?? {};
    const skillRows = [...visibleSkillSlugs].map((slug) => {
      const skill = existingSkills[slug] ?? storedSkills[slug] ?? {};
      return {
      slug,
      label: game.i18n.localize(skillConfig[slug]?.label ?? skillConfig[slug] ?? slug),
      value: lsNumber(skill.base, 0),
      benchmarks: markSelected(benchmarkRows.skills, lsNumber(skill.base, 0)),
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
    const speedRows = [
      { type: "land", label: "Land / walk", value: lsNumber(system.attributes?.speed, 25) },
      ...(system.attributes?.speed?.otherSpeeds ?? []).map((speed) => ({ type: speed.type, label: LS_SPEED_TYPES.find(([value]) => value === speed.type)?.[1] ?? speed.type, value: lsNumber(speed.value, 0) })),
    ];
    const senseRows = (system.perception?.senses ?? []).map((sense, index) => ({
      index, type: sense.type, label: LS_SENSE_TYPES.find(([value]) => value === sense.type)?.[1] ?? sense.type,
      acuity: sense.acuity ?? "imprecise", range: sense.range ?? "",
    }));
    const configuredSenses = Object.entries(CONFIG.PF2E.senses ?? {}).map(([value, data]) => ({
      value, label: game.i18n.localize(data?.label ?? data ?? value), acuity: data?.acuity ?? LS_SENSE_TYPES.find(([slug]) => slug === value)?.[2] ?? "imprecise",
    }));
    const senseTypeOptions = configuredSenses.length
      ? configuredSenses.sort((a, b) => a.label.localeCompare(b.label))
      : LS_SENSE_TYPES.map(([value, label, acuity]) => ({ value, label, acuity }));
    const spellEntries = actor.itemTypes?.spellcastingEntry ?? actor.items.filter((item) => item.type === "spellcastingEntry");
    if (!this.spellcastingEntryId && spellEntries[0]) this.spellcastingEntryId = spellEntries[0].id;
    return {
      ...await super._prepareContext(options),
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        level,
        size: actorSize,
        traits: lsTraits(actor).map((value) => ({
          value,
          label: game.i18n.localize(CONFIG.PF2E.creatureTraits?.[value] ?? value),
        })),
        ac: lsNumber(system.attributes?.ac, 10),
        hp: lsNumber(system.attributes?.hp?.max, 1),
        perception: lsNumber(system.perception, 0),
        abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((ability) => [ability, lsNumber(system.abilities?.[ability], 0)])),
        fortitude: lsNumber(system.saves?.fortitude, 0),
        reflex: lsNumber(system.saves?.reflex, 0),
        will: lsNumber(system.saves?.will, 0),
        speed: lsNumber(system.attributes?.speed, 25),
        speeds: speedRows,
        senses: senseRows,
        skills: skillRows,
        items: actor.items.filter((item) => !["spellcastingEntry"].includes(item.type)).map((item) => ({ id: item.id, name: item.name, img: item.img, type: item.type })),
        actionItems: actor.items.filter((item) => ["action", "feat", "melee", "effect"].includes(item.type)).map((item) => ({ id: item.id, name: item.name, img: item.img, type: item.type })),
        spellItems: actor.items.filter((item) => item.type === "spell").map((item) => ({ id: item.id, name: item.name, img: item.img, type: item.type })),
      },
      sourceQuery: this.sourceQuery,
      contentQuery: this.contentQuery,
      sourceResults: this.sourceResults,
      sourcePreview: this.sourcePreview,
      sourceLevel: this.sourceLevel,
      sourceTrait: this.sourceTrait,
      sourcePageLabel: `${this.sourcePage + 1} / ${Math.max(1, Math.ceil(this.sourceAllResults.length / this.sourcePageSize))}`,
      sourceCount: this.sourceAllResults.length,
      hasPreviousSources: this.sourcePage > 0,
      hasNextSources: (this.sourcePage + 1) * this.sourcePageSize < this.sourceAllResults.length,
      levelFilters: Array.from({ length: 26 }, (_value, index) => ({ value: index - 1, label: index - 1, selected: String(index - 1) === String(this.sourceLevel) })),
      creatureLevels: Array.from({ length: 26 }, (_value, index) => ({
        value: index - 1,
        label: index - 1,
        selected: index - 1 === level,
      })),
      sizeOptions: [
        ["tiny", "Tiny"], ["sm", "Small"], ["med", "Medium"],
        ["lg", "Large"], ["huge", "Huge"], ["grg", "Gargantuan"],
      ].map(([value, label]) => ({ value, label, selected: value === actorSize })),
      creatureTraitOptions: traitChoices.map(({ value, label }) => ({
        value, label,
        selected: value === this.sourceTrait,
      })),
      creatureTraitValue: lsTraits(actor).join(","),
      creatureTraitChoices: traitChoices,
      attackTraitChoices,
      actionTraitChoices,
      skillOptions: Object.entries(skillConfig).filter(([slug]) => !visibleSkillSlugs.has(slug)).map(([value, data]) => ({ value, label: game.i18n.localize(data?.label ?? data ?? value) })).sort((a, b) => a.label.localeCompare(b.label)),
      speedTypeOptions: LS_SPEED_TYPES.filter(([value]) => value !== "land" && !speedRows.some((speed) => speed.type === value)).map(([value, label]) => ({ value, label })),
      senseTypeOptions,
      senseAcuityOptions: [["precise", "Precise"], ["imprecise", "Imprecise"], ["vague", "Vague"]].map(([value, label]) => ({ value, label })),
      spellcastingEntries: spellEntries.map((item) => ({ id: item.id, name: item.name, selected: item.id === this.spellcastingEntryId })),
      contentResults: this.contentResults.map((entry) => ({
        ...entry,
        selected: entry.uuid === this.contentPreview?.uuid,
      })),
      contentPreview: this.contentPreview,
      concept,
      roadmapOptions: Object.entries(LS_CREATURE_ROADMAPS).map(([value, roadmap]) => ({ value, label: roadmap.label, description: roadmap.description, selected: value === concept.roadmap })),
      intendedUseOptions: [["combatant", "Combatant"], ["social", "Social creature"], ["ally", "Trusted ally"]].map(([value, label]) => ({ value, label, selected: value === concept.intendedUse })),
      complexityOptions: [["simple", "Simple / group creature"], ["standard", "Standard"], ["solo", "Solo / complex"]].map(([value, label]) => ({ value, label, selected: value === concept.complexity })),
      balance: lsBalanceReport(actor, concept),
      damageWorkshop,
      damageTypes: Object.entries(CONFIG.PF2E.damageTypes ?? {}).map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: value === "slashing" })).sort((left, right) => left.label.localeCompare(right.label)),
      conditionOptions: Object.entries(CONFIG.PF2E.conditionTypes ?? {}).map(([value, label]) => ({ value, label: game.i18n.localize(label) })).sort((left, right) => left.label.localeCompare(right.label)),
      linkedDamageEntries: actor.items.map((item) => {
        const link = lsCreatureDamageLink(item);
        if (!link) return null;
        const primary = Object.values(item.system?.damageRolls ?? {})[0];
        const formula = link.kind === "strike" ? primary?.damage ?? "—" : link.damageTier === "custom" ? link.customDamage : lsAreaDamageFormula(level, link.damageTier);
        const attack = link.kind === "strike" ? lsNumber(item.system?.bonus, 0) : null;
        return { id: item.id, name: item.name, img: item.img, kind: link.kind, formula, attack, damageType: link.damageType, attackTier: LS_BENCHMARK_LABELS[link.attackTier] ?? "", damageTier: LS_BENCHMARK_LABELS[link.damageTier] ?? link.damageTier, autoScale: Boolean(link.autoScale), levelApplied: link.levelApplied };
      }).filter(Boolean),
      benchmarks: {
        attributes: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((ability) => [ability, markSelected(benchmarkRows.attributes, lsNumber(system.abilities?.[ability], 0))])),
        ac: markSelected(benchmarkRows.ac, lsNumber(system.attributes?.ac, 10)),
        hp: markSelected(benchmarkRows.hp, lsNumber(system.attributes?.hp?.max, 1)),
        perception: markSelected(benchmarkRows.perception, lsNumber(system.perception, 0)),
        fortitude: markSelected(benchmarkRows.saves, lsNumber(system.saves?.fortitude, 0)),
        reflex: markSelected(benchmarkRows.saves, lsNumber(system.saves?.reflex, 0)),
        will: markSelected(benchmarkRows.saves, lsNumber(system.saves?.will, 0)),
      },
      contentType: this.contentType,
      contentGlossaryOnly: this.contentGlossaryOnly,
      contentTypes: [
        { value: "", label: "All attacks, actions, and passives" },
        { value: "action", label: "Actions and abilities" },
        { value: "feat", label: "Passive abilities and feats" },
        { value: "melee", label: "NPC attacks" },
        { value: "effect", label: "Effects and conditions" },
      ].map((type) => ({ ...type, selected: type.value === this.contentType })),
      step: this.step,
      stepNumber: this.step + 1,
      steps: {
        source: this.step === 0,
        concept: this.step === 1,
        identity: this.step === 2,
        defenses: this.step === 3,
        content: this.step === 4,
        spells: this.step === 5,
        review: this.step === 6,
      },
      canBack: this.step > 0,
      canNext: this.step > 0 && this.step < 6,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    requestAnimationFrame(() => {
      const viewport = this.element?.querySelector?.(".ls-builder-body") ?? this.element?.closest?.(".window-content");
      if (viewport) viewport.scrollTop = this.builderScrollTop;
    });
    const contentList = this.element?.querySelector(".ls-content-columns .ls-builder-results");
    if (contentList) contentList.scrollTop = this.contentScrollTop;
    for (const select of this.element?.querySelectorAll("[data-benchmark-target]") ?? []) {
      select.addEventListener("change", () => {
        const input = this.element.querySelector(`[name="${select.dataset.benchmarkTarget}"]`);
        if (input && select.value !== "") input.value = select.value;
      });
    }
    const root = this.element;
    for (const picker of root?.querySelectorAll("[data-ls-trait-picker]") ?? []) {
      const search = picker.querySelector("[data-ls-trait-search]");
      const hidden = picker.querySelector("[data-ls-trait-value]");
      const chips = picker.querySelector("[data-ls-trait-chips]");
      const options = [...picker.querySelectorAll("datalist option")].map((option) => ({
        value: option.dataset.value,
        label: option.value,
      }));
      let selected = lsSplitTraits(hidden?.value);
      const redraw = () => {
        if (hidden) hidden.value = selected.join(",");
        if (!chips) return;
        chips.replaceChildren(...selected.map((value) => {
          const option = options.find((choice) => choice.value === value);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ls-trait-chip";
          button.dataset.value = value;
          button.innerHTML = `${option?.label ?? value} <i class="fa-solid fa-xmark"></i>`;
          button.addEventListener("click", () => {
            selected = selected.filter((trait) => trait !== value);
            redraw();
          });
          return button;
        }));
        if (!selected.length) {
          const empty = document.createElement("small");
          empty.textContent = "No traits selected.";
          chips.append(empty);
        }
      };
      const add = () => {
        const query = search?.value.trim() ?? "";
        if (!query) return;
        const option = options.find((choice) => choice.value === query || choice.label.localeCompare(query, undefined, { sensitivity: "accent" }) === 0);
        if (!option) return ui.notifications.warn("Choose a trait from the PF2e suggestions.");
        if (!selected.includes(option.value)) selected.push(option.value);
        if (search) search.value = "";
        redraw();
      };
      picker.querySelector("[data-ls-trait-add]")?.addEventListener("click", add);
      search?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        add();
      });
      redraw();
    }
    const field = (name) => root?.querySelector(`[name="${name}"]`);
    const setEnabled = (name, enabled) => {
      const input = field(name);
      if (!input) return;
      input.disabled = !enabled;
      input.closest("label")?.classList.toggle("is-disabled", !enabled);
    };
    const syncWorkshop = () => {
      setEnabled("strikeCustomAttack", field("strikeAttackTier")?.value === "custom");
      setEnabled("strikeCustomDamage", field("strikeDamageTier")?.value === "custom");
      const usage = field("abilityUsage")?.value ?? "action";
      const delivery = field("abilityDelivery")?.value ?? "area";
      setEnabled("abilityActions", usage === "action");
      setEnabled("abilityRange", delivery === "target");
      setEnabled("abilityAreaShape", delivery === "area");
      setEnabled("abilityAreaDistance", delivery === "area");
      setEnabled("abilityCustomDamage", field("abilityDamageTier")?.value === "custom");
      setEnabled("abilityCustomDc", field("abilityDcTier")?.value === "custom");
    };
    for (const name of ["strikeAttackTier", "strikeDamageTier", "abilityUsage", "abilityDelivery", "abilityDamageTier", "abilityDcTier"]) {
      field(name)?.addEventListener("change", syncWorkshop);
    }
    field("abilityDelivery")?.addEventListener("change", () => {
      const delivery = field("abilityDelivery")?.value;
      const damageTier = field("abilityDamageTier");
      if (!damageTier || damageTier.value === "custom") return;
      damageTier.value = delivery === "target" ? "strike-high" : delivery === "area" ? "area-unlimited" : "none";
      syncWorkshop();
    });
    syncWorkshop();
  }

  async loadSources() {
    this.sourceAllResults = await lsSearchPacks({
      documentName: "Actor",
      query: this.sourceQuery,
      types: ["npc"],
      level: this.sourceLevel,
      trait: this.sourceTrait,
    });
    const start = this.sourcePage * this.sourcePageSize;
    this.sourceResults = this.sourceAllResults.slice(start, start + this.sourcePageSize);
    this.sourcesLoaded = true;
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      const previousConcept = lsCreatureConcept(this.actor);
      const conceptData = {
        concept: root.querySelector('[name="concept"]')?.value.trim() ?? "",
        roadmap: root.querySelector('[name="roadmap"]')?.value ?? "",
        intendedUse: root.querySelector('[name="intendedUse"]')?.value ?? "combatant",
        complexity: root.querySelector('[name="complexity"]')?.value ?? "standard",
        combatFeel: root.querySelector('[name="combatFeel"]')?.value.trim() ?? "",
        strengths: root.querySelector('[name="strengths"]')?.value.trim() ?? "",
        weaknesses: root.querySelector('[name="weaknesses"]')?.value.trim() ?? "",
      };
      const conceptLevel = Math.max(-1, Math.min(24, lsNumber(root.querySelector('[name="conceptLevel"]')?.value, 0)));
      await this.actor.update({
        "system.details.level.value": conceptLevel,
      });
      await this.actor.setFlag(LS_MODULE_ID, "creatureConcept", conceptData);
      if (conceptData.roadmap && conceptData.roadmap !== previousConcept.roadmap) {
        await this.applyRoadmapDefaults(conceptData.roadmap, { notify: false, render: false });
      }
    }
    if (this.step === 2) {
      const traitField = root.querySelector('[name="creatureTraits"]');
      await this.actor.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.actor.name,
        "system.details.level.value": Math.max(-1, Math.min(24, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.size.value": root.querySelector('[name="size"]')?.value || "med",
        ...(traitField ? { "system.traits.value": lsParseTagify(traitField.value) } : {}),
      });
    }
    if (this.step === 3) {
      const otherSpeeds = [...root.querySelectorAll("[data-speed-type]")].filter((input) => input.dataset.speedType !== "land").map((input) => ({
        type: input.dataset.speedType,
        value: Math.max(0, lsNumber(input.value, 0)),
      })).filter((speed) => speed.value > 0);
      const senses = [...root.querySelectorAll("[data-sense-row]")].map((row) => ({
        type: row.dataset.senseType,
        acuity: row.querySelector('[data-sense-acuity]')?.value || "imprecise",
        range: row.querySelector('[data-sense-range]')?.value === "" ? null : Math.max(0, lsNumber(row.querySelector('[data-sense-range]')?.value, 0)),
      }));
      const skillInputs = [...root.querySelectorAll("[data-skill-slug]")];
      const selectedSkillSlugs = new Set(skillInputs.map((input) => input.dataset.skillSlug));
      const skillUpdates = Object.fromEntries(skillInputs.map((input) => [`system.skills.${input.dataset.skillSlug}.base`, lsNumber(input.value, 0)]));
      for (const [slug, skill] of Object.entries(this.actor._source?.system?.skills ?? {})) {
        if (!selectedSkillSlugs.has(slug) && !lsMeaningfulNpcSkill(skill)) skillUpdates[`system.skills.-=${slug}`] = null;
      }
      await this.actor.update({
        ...Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((ability) => [`system.abilities.${ability}.mod`, lsNumber(root.querySelector(`[name="${ability}"]`)?.value, 0)])),
        "system.attributes.ac.value": lsNumber(root.querySelector('[name="ac"]')?.value, 10),
        "system.attributes.hp.max": Math.max(1, lsNumber(root.querySelector('[name="hp"]')?.value, 1)),
        "system.attributes.hp.value": Math.max(1, lsNumber(root.querySelector('[name="hp"]')?.value, 1)),
        "system.perception.mod": lsNumber(root.querySelector('[name="perception"]')?.value, 0),
        "system.saves.fortitude.value": lsNumber(root.querySelector('[name="fortitude"]')?.value, 0),
        "system.saves.reflex.value": lsNumber(root.querySelector('[name="reflex"]')?.value, 0),
        "system.saves.will.value": lsNumber(root.querySelector('[name="will"]')?.value, 0),
        "system.attributes.speed.value": Math.max(0, lsNumber(root.querySelector('[data-speed-type="land"]')?.value, 25)),
        "system.attributes.speed.otherSpeeds": otherSpeeds,
        "system.perception.senses": senses,
        ...skillUpdates,
      });
    }
  }

  static async previous() {
    await this.saveStep();
    this.step = Math.max(0, this.step - 1);
    this.resetBuilderScroll = true;
    await this.render();
  }

  static async next() {
    await this.saveStep();
    this.step = Math.min(6, this.step + 1);
    this.resetBuilderScroll = true;
    await this.render();
  }

  static async goToStep(_event, target) {
    await this.saveStep();
    this.step = Math.max(0, Math.min(6, Number(target.dataset.step) || 0));
    this.resetBuilderScroll = true;
    await this.render();
  }

  static async searchSource() {
    this.sourceQuery = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.sourceLevel = this.element.querySelector('[name="sourceLevel"]')?.value ?? "";
    this.sourceTrait = this.element.querySelector('[name="sourceTrait"]')?.value ?? "";
    this.sourcePage = 0;
    await this.loadSources();
    await this.render();
  }

  static async previousSources() {
    this.sourcePage = Math.max(0, this.sourcePage - 1);
    await this.loadSources();
    await this.render();
  }

  static async nextSources() {
    this.sourcePage += 1;
    await this.loadSources();
    await this.render();
  }

  static async previewSource(_event, target) {
    this.sourcePreview = await lsBuildSourcePreview(target.dataset.uuid);
    await this.render();
  }

  static async useSource(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source?.isOfType?.("npc") && source?.type !== "npc") return ui.notifications.error("That compendium entry is not a PF2e NPC.");
    const confirmed = await LSDialogV2.confirm({
      window: { title: "Use creature as the starting point?" },
      content: `<p>This replaces the current NPC’s statistics and embedded actions with <strong>${source.name}</strong>. You can edit every field afterward.</p>`,
      yes: { label: "Use this creature" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    const sourceData = source.toObject();
    await this.actor.update({
      name: source.name,
      img: source.img,
      system: sourceData.system,
      prototypeToken: sourceData.prototypeToken,
      [`flags.${LS_MODULE_ID}.sourceUuid`]: source.uuid,
    });
    const currentIds = this.actor.items.map((item) => item.id);
    if (currentIds.length) await this.actor.deleteEmbeddedDocuments("Item", currentIds);
    const itemData = source.items.map((item) => {
      const data = item.toObject();
      delete data._id;
      return data;
    });
    if (itemData.length) await this.actor.createEmbeddedDocuments("Item", itemData);
    this.step = 1;
    await this.render();
  }

  static async useCurrent() {
    this.step = 1;
    await this.render();
  }

  static async applyRoadmap() {
    await this.saveStep();
    const concept = lsCreatureConcept(this.actor);
    await this.applyRoadmapDefaults(concept.roadmap, { notify: true, render: true });
  }

  async applyRoadmapDefaults(roadmapKey, { notify = true, render = true } = {}) {
    const roadmap = LS_CREATURE_ROADMAPS[roadmapKey];
    if (!roadmap) return ui.notifications.warn("Choose a GM Core road map first.");
    const level = lsNumber(this.actor.system.details?.level, 0);
    const benchmarks = lsBenchmarks(level);
    const find = (group, tier) => benchmarks[group].find((entry) => entry.label.toLowerCase().startsWith(tier))?.value;
    const stats = roadmap.stats;
    const hp = find("hp", stats.hp);
    await this.actor.update({
      "system.attributes.ac.value": find("ac", stats.ac),
      "system.attributes.hp.max": hp,
      "system.attributes.hp.value": hp,
      "system.perception.mod": find("perception", stats.perception),
      "system.saves.fortitude.value": find("saves", stats.fortitude),
      "system.saves.reflex.value": find("saves", stats.reflex),
      "system.saves.will.value": find("saves", stats.will),
      "system.attributes.speed.value": stats.speed,
      ...Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((ability) => [`system.abilities.${ability}.mod`, find("attributes", stats[ability] ?? "moderate")])),
    });
    if (notify) ui.notifications.info(`${roadmap.label} suggestions applied for level ${level}. Every value remains editable.`);
    if (render) await this.render();
  }

  static async addTrait() {
    await this.saveStep();
    const trait = this.element.querySelector('[name="traitToAdd"]')?.value;
    if (!trait) return;
    const traits = new Set(lsTraits(this.actor));
    traits.add(trait);
    await this.actor.update({ "system.traits.value": [...traits] });
    await this.render();
  }

  static async removeTrait(_event, target) {
    const traits = lsTraits(this.actor).filter((trait) => trait !== target.dataset.trait);
    await this.actor.update({ "system.traits.value": traits });
    await this.render();
  }

  static async addSkill() {
    await this.saveStep();
    const slug = this.element.querySelector('[name="skillToAdd"]')?.value;
    if (!slug) return;
    const moderate = lsBenchmarks(lsNumber(this.actor.system.details?.level, 0)).skills.find((entry) => entry.label === "Moderate")?.value ?? 0;
    await this.actor.update({ [`system.skills.${slug}`]: { base: moderate, note: "", special: [] } });
    const selected = new Set(this.actor.getFlag(LS_MODULE_ID, "builderSkills") ?? []);
    selected.add(slug);
    await this.actor.setFlag(LS_MODULE_ID, "builderSkills", [...selected]);
    await this.render();
  }

  static async removeSkill(_event, target) {
    await this.saveStep();
    await this.actor.update({ [`system.skills.-=${target.dataset.skill}`]: null });
    const selected = new Set(this.actor.getFlag(LS_MODULE_ID, "builderSkills") ?? []);
    selected.delete(target.dataset.skill);
    await this.actor.setFlag(LS_MODULE_ID, "builderSkills", [...selected]);
    await this.render();
  }

  static async addSpeed() {
    await this.saveStep();
    const type = this.element.querySelector('[name="speedTypeToAdd"]')?.value;
    if (!type) return;
    const otherSpeeds = foundry.utils.deepClone(this.actor.system.attributes?.speed?.otherSpeeds ?? []);
    if (!otherSpeeds.some((speed) => speed.type === type)) otherSpeeds.push({ type, value: 25 });
    await this.actor.update({ "system.attributes.speed.otherSpeeds": otherSpeeds });
    await this.render();
  }

  static async removeSpeed(_event, target) {
    await this.saveStep();
    const otherSpeeds = (this.actor.system.attributes?.speed?.otherSpeeds ?? []).filter((speed) => speed.type !== target.dataset.speed);
    await this.actor.update({ "system.attributes.speed.otherSpeeds": otherSpeeds });
    await this.render();
  }

  static async addSense() {
    await this.saveStep();
    const type = this.element.querySelector('[name="senseTypeToAdd"]')?.value;
    if (!type) return;
    const definition = LS_SENSE_TYPES.find(([value]) => value === type);
    const senses = foundry.utils.deepClone(this.actor.system.perception?.senses ?? []);
    senses.push({ type, acuity: definition?.[2] ?? "imprecise", range: ["darkvision", "greater-darkvision", "low-light-vision", "see-invisibility", "truesight"].includes(type) ? null : 30 });
    await this.actor.update({ "system.perception.senses": senses });
    await this.render();
  }

  static async removeSense(_event, target) {
    await this.saveStep();
    const index = Number(target.dataset.index);
    const senses = foundry.utils.deepClone(this.actor.system.perception?.senses ?? []);
    senses.splice(index, 1);
    await this.actor.update({ "system.perception.senses": senses });
    await this.render();
  }

  static async createSpellcastingEntry() {
    const root = this.element;
    const level = lsNumber(this.actor.system.details?.level, 0);
    const tier = root.querySelector('[name="spellDcTier"]')?.value ?? "high";
    const values = creatureTableRow("spell", level);
    const pair = tier === "extreme" ? [values[0], values[1]] : tier === "moderate" ? [values[4], values[5]] : [values[2], values[3]];
    const dc = tier === "custom" ? lsNumber(root.querySelector('[name="spellCustomDc"]')?.value, pair[0]) : pair[0];
    const attack = tier === "custom" ? lsNumber(root.querySelector('[name="spellCustomAttack"]')?.value, pair[1]) : pair[1];
    const tradition = root.querySelector('[name="spellTradition"]')?.value || "arcane";
    const prepared = root.querySelector('[name="spellPrepared"]')?.value || "innate";
    const [entry] = await this.actor.createEmbeddedDocuments("Item", [{
      name: root.querySelector('[name="spellEntryName"]')?.value.trim() || `${tradition.charAt(0).toUpperCase()}${tradition.slice(1)} Spellcasting`,
      type: "spellcastingEntry",
      system: {
        ability: { value: root.querySelector('[name="spellAbility"]')?.value || "cha" },
        spelldc: { value: attack, dc }, tradition: { value: tradition }, prepared: { value: prepared },
        showSlotlessLevels: { value: true }, proficiency: { value: 1 }, autoHeightenLevel: { value: null },
      },
    }]);
    this.spellcastingEntryId = entry?.id ?? "";
    ui.notifications.info("Created a native PF2e spellcasting entry.");
    await this.render();
  }

  static async createLinkedStrike() {
    const root = this.element;
    const level = lsNumber(this.actor.system.details?.level, 0);
    const attackTier = root.querySelector('[name="strikeAttackTier"]')?.value ?? "high";
    const damageTier = root.querySelector('[name="strikeDamageTier"]')?.value ?? "high";
    const attack = attackTier === "custom"
      ? lsNumber(root.querySelector('[name="strikeCustomAttack"]')?.value, 0)
      : lsTierValue("strikeAttack", level, attackTier);
    const primaryFormula = damageTier === "custom"
      ? root.querySelector('[name="strikeCustomDamage"]')?.value.trim()
      : lsStrikeFormula(lsTierValue("strikeDamage", level, damageTier));
    if (!primaryFormula) return ui.notifications.warn("Enter a valid custom damage formula.");
    const name = root.querySelector('[name="strikeName"]')?.value.trim() || "New Strike";
    const damageType = root.querySelector('[name="strikeDamageType"]')?.value || "slashing";
    const traits = lsParseTagify(root.querySelector('[name="strikeTraits"]')?.value);
    const attackEffects = String(root.querySelector('[name="strikeAttackEffects"]')?.value ?? "").split(",").map((effect) => effect.trim()).filter(Boolean);
    const rangeValue = root.querySelector('[name="strikeRange"]')?.value ?? "";
    const primaryDamageId = foundry.utils.randomID();
    const damageRolls = {
      [primaryDamageId]: { damage: primaryFormula, damageType, category: null },
    };
    const secondaryFormula = root.querySelector('[name="strikeSecondaryDamage"]')?.value.trim();
    if (secondaryFormula) {
      const secondaryType = root.querySelector('[name="strikeSecondaryType"]')?.value || damageType;
      damageRolls[foundry.utils.randomID()] = { damage: secondaryFormula, damageType: secondaryType, category: null };
    }
    const autoScale = Boolean(root.querySelector('[name="strikeAutoScale"]')?.checked);
    const link = { kind: "strike", attackTier, damageTier, customAttack: attack, customDamage: primaryFormula, damageType, primaryDamageId, autoScale, levelApplied: level };
    await this.actor.createEmbeddedDocuments("Item", [{
      name,
      type: "melee",
      img: "systems/pf2e/icons/actions/OneAction.webp",
      system: {
        description: { value: "", gm: "" }, rules: [], slug: null,
        traits: { value: traits, otherTags: [] }, action: "strike", bonus: { value: attack }, damageRolls,
        attackEffects: { value: attackEffects }, range: rangeValue === "" ? null : { increment: Math.max(5, lsNumber(rangeValue, 5)), max: null },
      },
      flags: { [LS_MODULE_ID]: { creatureDamageLink: link } },
    }]);
    ui.notifications.info(`Created native PF2e Strike: ${name}.`);
    await this.render();
  }

  static async createLinkedAbility() {
    const root = this.element;
    const level = lsNumber(this.actor.system.details?.level, 0);
    const damageTier = root.querySelector('[name="abilityDamageTier"]')?.value ?? "unlimited";
    const dcTier = root.querySelector('[name="abilityDcTier"]')?.value ?? "high";
    const damageType = root.querySelector('[name="abilityDamageType"]')?.value || "fire";
    const customDamage = root.querySelector('[name="abilityCustomDamage"]')?.value.trim() ?? "";
    const customDc = lsNumber(root.querySelector('[name="abilityCustomDc"]')?.value, 10);
    if (damageTier === "custom" && !customDamage) return ui.notifications.warn("Enter a custom ability damage formula.");
    const usage = root.querySelector('[name="abilityUsage"]')?.value ?? "action";
    const actions = Math.max(1, Math.min(3, lsNumber(root.querySelector('[name="abilityActions"]')?.value, 2)));
    const actionData = lsAbilityActionData(usage, actions);
    const frequencyInput = root.querySelector('[name="abilityFrequencyMax"]')?.value?.trim() ?? "";
    const frequencyMax = frequencyInput === "" ? (["limited", "area-limited"].includes(damageTier) ? 1 : 0) : Math.max(0, lsNumber(frequencyInput, 0));
    const link = {
      kind: "ability", damageTier, dcTier, customDamage, customDc, damageType,
      usage, actions: actionData.actions,
      delivery: root.querySelector('[name="abilityDelivery"]')?.value || "area",
      range: Math.max(0, lsNumber(root.querySelector('[name="abilityRange"]')?.value, 0)),
      save: root.querySelector('[name="abilitySave"]')?.value || "reflex",
      areaShape: root.querySelector('[name="abilityAreaShape"]')?.value || "burst",
      areaDistance: Math.max(5, lsNumber(root.querySelector('[name="abilityAreaDistance"]')?.value, 5)),
      requirements: root.querySelector('[name="abilityRequirements"]')?.value.trim() ?? "",
      trigger: root.querySelector('[name="abilityTrigger"]')?.value.trim() ?? "",
      duration: root.querySelector('[name="abilityDuration"]')?.value.trim() ?? "",
      effectText: root.querySelector('[name="abilityEffectText"]')?.value.trim() ?? "",
      condition: root.querySelector('[name="abilityCondition"]')?.value ?? "",
      conditionValue: Math.max(0, lsNumber(root.querySelector('[name="abilityConditionValue"]')?.value, 0)),
      autoScale: Boolean(root.querySelector('[name="abilityAutoScale"]')?.checked), levelApplied: level,
    };
    const traits = lsParseTagify(root.querySelector('[name="abilityTraits"]')?.value);
    if (damageTier !== "none" && !traits.includes(damageType) && damageType !== "untyped") traits.push(damageType);
    const system = {
      description: { value: lsAbilityDescription(link, level), gm: "" }, rules: [], slug: null,
      traits: { value: traits, otherTags: [] }, actionType: { value: actionData.actionType }, actions: { value: actionData.actions }, category: null,
    };
    if (frequencyMax) system.frequency = { max: frequencyMax, per: root.querySelector('[name="abilityFrequencyPer"]')?.value || "day" };
    if (link.delivery === "target" && link.range > 0) system.range = { increment: null, max: link.range };
    await this.actor.createEmbeddedDocuments("Item", [{
      name: root.querySelector('[name="abilityName"]')?.value.trim() || "New Ability",
      type: "action",
      img: `systems/pf2e/icons/actions/${actionData.icon}`,
      system,
      flags: { [LS_MODULE_ID]: { creatureDamageLink: link } },
    }]);
    ui.notifications.info("Created a native PF2e ability with the selected action, target, roll, and effect modules.");
    await this.render();
  }

  static async createLinkedPassive() {
    const root = this.element;
    const level = lsNumber(this.actor.system.details?.level, 0);
    const damageTier = root.querySelector('[name="passiveDamageTier"]')?.value ?? "none";
    const dcTier = root.querySelector('[name="passiveDcTier"]')?.value ?? "high";
    const damageType = root.querySelector('[name="passiveDamageType"]')?.value || "untyped";
    const customDamage = root.querySelector('[name="passiveCustomDamage"]')?.value.trim() ?? "";
    const customDc = lsNumber(root.querySelector('[name="passiveCustomDc"]')?.value, 10);
    if (damageTier === "custom" && !customDamage) return ui.notifications.warn("Enter a custom passive damage formula.");
    const link = {
      kind: "ability", damageTier, dcTier, customDamage, customDc, damageType,
      usage: "passive", actions: null,
      delivery: root.querySelector('[name="passiveDelivery"]')?.value || "self",
      range: Math.max(0, lsNumber(root.querySelector('[name="passiveRange"]')?.value, 0)),
      save: root.querySelector('[name="passiveSave"]')?.value || "none",
      areaShape: root.querySelector('[name="passiveAreaShape"]')?.value || "emanation",
      areaDistance: Math.max(5, lsNumber(root.querySelector('[name="passiveAreaDistance"]')?.value, 5)),
      requirements: root.querySelector('[name="passiveRequirements"]')?.value.trim() ?? "",
      trigger: "", duration: root.querySelector('[name="passiveDuration"]')?.value.trim() ?? "",
      effectText: root.querySelector('[name="passiveEffectText"]')?.value.trim() ?? "",
      condition: root.querySelector('[name="passiveCondition"]')?.value ?? "",
      conditionValue: Math.max(0, lsNumber(root.querySelector('[name="passiveConditionValue"]')?.value, 0)),
      autoScale: Boolean(root.querySelector('[name="passiveAutoScale"]')?.checked), levelApplied: level,
    };
    const traits = lsParseTagify(root.querySelector('[name="passiveTraits"]')?.value);
    if (damageTier !== "none" && damageType !== "untyped" && !traits.includes(damageType)) traits.push(damageType);
    await this.actor.createEmbeddedDocuments("Item", [{
      name: root.querySelector('[name="passiveName"]')?.value.trim() || "New Passive",
      type: "action",
      img: "systems/pf2e/icons/actions/Passive.webp",
      system: {
        description: { value: lsAbilityDescription(link, level), gm: "" }, rules: [], slug: null,
        traits: { value: traits, otherTags: [] }, actionType: { value: "passive" }, actions: { value: null }, category: null,
      },
      flags: { [LS_MODULE_ID]: { creatureDamageLink: link } },
    }]);
    ui.notifications.info("Created a native PF2e passive ability.");
    await this.render();
  }

  static async recalculateLinked() {
    await lsRecalculateLinkedCreatureEntries(this.actor, lsNumber(this.actor.system.details?.level, 0), { notify: true });
    await this.render();
  }

  static async toggleLinkedScaling(_event, target) {
    const item = this.actor.items.get(target.dataset.id);
    const link = item ? lsCreatureDamageLink(item) : null;
    if (!item || !link) return;
    const enabled = !link.autoScale;
    await item.update({ [`flags.${LS_MODULE_ID}.creatureDamageLink.autoScale`]: enabled }, { loreSmithAutoScale: true });
    if (enabled) await lsRecalculateLinkedCreatureEntries(this.actor, lsNumber(this.actor.system.details?.level, 0));
    await this.render();
  }

  static async searchContent() {
    this.contentQuery = this.element.querySelector('[name="contentQuery"]')?.value ?? "";
    this.contentType = this.step === 5 ? "spell" : this.element.querySelector('[name="contentType"]')?.value ?? "";
    this.spellcastingEntryId = this.element.querySelector('[name="spellcastingEntry"]')?.value ?? this.spellcastingEntryId;
    this.contentGlossaryOnly = Boolean(this.element.querySelector('[name="contentGlossaryOnly"]')?.checked);
    this.contentResults = await lsSearchCreatureContent({
      query: this.contentQuery,
      types: this.step === 5 ? ["spell"] : this.contentType ? [this.contentType] : ["action", "feat", "melee", "effect"],
      limit: 250,
      bestiaryGlossaryOnly: this.contentGlossaryOnly,
    });
    const selectedStillVisible = this.contentResults.some((entry) => entry.uuid === this.contentPreview?.uuid);
    if (!selectedStillVisible) {
      this.contentPreview = this.contentResults[0]
        ? await lsBuildContentPreview(this.contentResults[0].uuid)
        : null;
    }
    await this.render();
  }

  static async previewContent(_event, target) {
    this.contentScrollTop = this.element.querySelector(".ls-content-columns .ls-builder-results")?.scrollTop ?? 0;
    this.contentPreview = await lsBuildContentPreview(target.dataset.uuid);
    await this.render();
  }

  static async addContent(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e compendium entry.");
    const data = source.toObject();
    delete data._id;
    if (source.type === "spell") {
      this.spellcastingEntryId = this.element.querySelector('[name="spellcastingEntry"]')?.value ?? this.spellcastingEntryId;
      if (!this.spellcastingEntryId) return ui.notifications.warn("Create or choose a native spellcasting entry first.");
      data.system.location = { ...(data.system.location ?? {}), value: this.spellcastingEntryId };
    }
    await this.actor.createEmbeddedDocuments("Item", [data]);
    ui.notifications.info(`Added ${source.name} to ${this.actor.name}.`);
    await this.render();
  }

  static async removeContent(_event, target) {
    await this.actor.deleteEmbeddedDocuments("Item", [target.dataset.id]);
    await this.render();
  }

  static async finish() {
    await this.saveStep();
    await this.actor.setFlag(LS_MODULE_ID, "builderComplete", true);
    await this.close();
    this.actor.sheet.render(true);
  }
}

const LS_PHYSICAL_ITEM_TYPES = new Set(["ammo", "armor", "backpack", "book", "consumable", "equipment", "kit", "shield", "treasure", "weapon"]);

function lsEscapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function lsSelectOptions(record, current, fallback = []) {
  const entries = record && typeof record === "object" && !Array.isArray(record) ? Object.entries(record) : fallback;
  return entries.map(([value, label]) => ({
    value,
    label: game.i18n.localize(label ?? value),
    selected: String(value) === String(current ?? ""),
  })).sort((left, right) => left.label.localeCompare(right.label));
}

function lsCoinValue(price, denomination) {
  return Math.max(0, lsNumber(price?.[denomination], 0));
}

function lsNewItemActivation(overrides = {}) {
  return {
    id: foundry.utils.randomID(), name: "", type: "action", actions: "1", traits: [], frequencyMax: "", frequencyPer: "day",
    trigger: "", requirements: "", range: "", target: "", areaType: "none", areaSize: "", duration: "", effectText: "", ...overrides,
  };
}

function lsEmptyItemBuilderFlags() {
  return {
    activations: [],
    effects: [],
    generatedRules: [],
  };
}

function lsItemBuilderFlags(item) {
  const stored = foundry.utils.deepClone(item.getFlag(LS_MODULE_ID, "itemBuilder") ?? {});
  const flags = foundry.utils.mergeObject(lsEmptyItemBuilderFlags(), stored, { inplace: false });
  if (!Array.isArray(stored.activations) && stored.activation?.type && stored.activation.type !== "none") {
    flags.activations = [lsNewItemActivation(stored.activation)];
  }
  flags.activations = (flags.activations ?? []).map((activation) => lsNewItemActivation({ ...activation, id: activation.id || foundry.utils.randomID(), traits: Array.isArray(activation.traits) ? activation.traits : [] }));
  flags.effects = (flags.effects ?? []).map((effect) => ({ ...effect, id: effect.id || foundry.utils.randomID(), activationId: effect.activationId ?? "" }));
  delete flags.activation;
  return flags;
}

function lsEffectView(effect) {
  const kind = effect.kind ?? "damage";
  return {
    id: effect.id, kind, label: effect.label ?? "", formula: effect.formula ?? "", damageType: effect.damageType ?? "",
    save: effect.save ?? "reflex", dc: effect.dc ?? "", basic: effect.basic !== false, selector: effect.selector ?? "",
    value: effect.value ?? "", modifierType: effect.modifierType ?? "item", condition: effect.condition ?? "",
    option: effect.option ?? "", note: effect.note ?? "", activationId: effect.activationId ?? "",
    isDamage: kind === "damage", isHealing: kind === "healing", isCheck: kind === "check", isCondition: kind === "condition",
    isFlatModifier: kind === "flat-modifier", isDamageDice: kind === "damage-dice", isResistance: kind === "resistance",
    isWeakness: kind === "weakness", isImmunity: kind === "immunity", isFastHealing: kind === "fast-healing", isRollOption: kind === "roll-option",
  };
}

function lsGeneratedRule(effect, itemName) {
  const value = String(effect.value ?? "").trim() === "" ? Number.NaN : Number(effect.value);
  switch (effect.kind) {
    case "flat-modifier": return effect.selector && Number.isFinite(value) ? { key: "FlatModifier", selector: effect.selector, type: effect.modifierType || "item", value, label: effect.label || itemName } : null;
    case "damage-dice": {
      const match = String(effect.formula ?? "").trim().match(/^(\d+)d(4|6|8|10|12)$/i);
      return effect.selector && match ? { key: "DamageDice", selector: effect.selector, diceNumber: Number(match[1]), dieSize: `d${match[2]}`, ...(effect.damageType ? { damageType: effect.damageType } : {}), label: effect.label || itemName } : null;
    }
    case "resistance": return effect.damageType && Number.isFinite(value) ? { key: "Resistance", type: effect.damageType, value } : null;
    case "weakness": return effect.damageType && Number.isFinite(value) ? { key: "Weakness", type: effect.damageType, value } : null;
    case "immunity": return effect.damageType ? { key: "Immunity", type: effect.damageType } : null;
    case "fast-healing": return Number.isFinite(value) ? { key: "FastHealing", value, ...(effect.option === "regeneration" ? { type: "regeneration" } : {}) } : null;
    case "roll-option": return effect.option ? { key: "RollOption", domain: effect.selector || "all", option: effect.option, label: effect.label || itemName, toggleable: true } : null;
    default: return null;
  }
}

function lsActionGlyph(activation) {
  if (activation.type === "free") return '<span class="action-glyph">F</span>';
  if (activation.type === "reaction") return '<span class="action-glyph">R</span>';
  if (activation.type !== "action") return "";
  if (activation.actions === "varies") return '<span class="action-glyph">1</span>&ndash;<span class="action-glyph">3</span>';
  return `<span class="action-glyph">${lsEscapeHtml(activation.actions || "1")}</span>`;
}

function lsActivationFrequency(activation) {
  const max = Math.max(0, Number(activation.frequencyMax) || 0);
  if (!max) return "";
  return max === 1 ? `once per ${activation.frequencyPer || "day"}` : `${max} times per ${activation.frequencyPer || "day"}`;
}

function lsInlineItemEffect(effect) {
  const label = effect.label ? `<strong>${lsEscapeHtml(effect.label)}</strong> ` : "";
  if (effect.kind === "damage" && effect.formula) return `${label}@Damage[${effect.formula}${effect.damageType ? `[${effect.damageType}]` : ""}]${effect.note ? ` ${lsEscapeHtml(effect.note)}` : ""}`;
  if (effect.kind === "healing" && effect.formula) return `${label}@Damage[${effect.formula}[healing]]${effect.note ? ` ${lsEscapeHtml(effect.note)}` : ""}`;
  if (effect.kind === "check") {
    const parts = [effect.save || "reflex", effect.dc ? `dc:${effect.dc}` : null, effect.basic ? "basic:true" : null].filter(Boolean);
    return `${label}@Check[${parts.join("|")}]${effect.note ? ` ${lsEscapeHtml(effect.note)}` : ""}`;
  }
  if (effect.kind === "condition" && effect.condition) return `${label}<strong>${lsEscapeHtml(effect.condition)}</strong>${effect.note ? `: ${lsEscapeHtml(effect.note)}` : ""}`;
  return "";
}

function lsCompileActivationRows(activation, effects, { includeHeading = true } = {}) {
  const rows = [];
  if (includeHeading) {
    const title = activation.name ? `Activate&mdash;${lsEscapeHtml(activation.name)}` : "Activate";
    const traits = activation.traits.length ? ` (${activation.traits.map((trait) => lsEscapeHtml(game.i18n.localize(CONFIG.PF2E.actionTraits?.[trait] ?? trait))).join(", ")})` : "";
    rows.push(`<p><strong>${title}</strong> ${lsActionGlyph(activation)}${traits}</p>`);
  }
  for (const [label, value] of [["Frequency", lsActivationFrequency(activation)], ["Trigger", activation.trigger], ["Requirements", activation.requirements], ["Range", activation.range], ["Targets", activation.target], ["Duration", activation.duration]]) {
    if (value) rows.push(`<p><strong>${label}</strong> ${lsEscapeHtml(value)}</p>`);
  }
  if (activation.areaType !== "none" && activation.areaSize) rows.push(`<p>@Template[type:${activation.areaType}|distance:${Math.max(0, lsNumber(activation.areaSize, 0))}]</p>`);
  const effectParts = [];
  if (activation.effectText) effectParts.push(lsEscapeHtml(activation.effectText).replaceAll("\n", "<br>"));
  effectParts.push(...effects.map(lsInlineItemEffect).filter(Boolean));
  if (effectParts.length) rows.push(`<p><strong>Effect</strong> ${effectParts.join(" ")}</p>`);
  return rows;
}

function lsCompileItemBuilderDescription(baseDescription, flags) {
  const start = "<!-- lore-smith:item-builder:start -->", end = "<!-- lore-smith:item-builder:end -->";
  const clean = String(baseDescription ?? "").replace(new RegExp(`${start}[\\s\\S]*?${end}`, "g"), "").trim();
  const rows = [];
  for (const [index, activation] of flags.activations.entries()) {
    const effects = flags.effects.filter((effect) => effect.activationId === activation.id || (!effect.activationId && index === 0));
    if (index > 0) rows.push("<hr>");
    rows.push(...lsCompileActivationRows(activation, effects));
  }
  if (!flags.activations.length) {
    const standalone = flags.effects.map(lsInlineItemEffect).filter(Boolean);
    if (standalone.length) rows.push(`<p><strong>Effect</strong> ${standalone.join(" ")}</p>`);
  }
  return rows.length ? `${clean}${clean ? "\n" : ""}${start}${rows.join("")}${end}` : clean;
}

function lsActivationActionSource(item, activation, effects) {
  const actionType = ["action", "reaction", "free"].includes(activation.type) ? activation.type : "action";
  const actionCount = actionType === "action" ? Math.max(1, Math.min(3, Number(activation.actions) || 1)) : null;
  const frequencyMax = Math.max(0, Number(activation.frequencyMax) || 0);
  return {
    name: activation.name || `Activate ${item.name}`,
    type: "action",
    img: item.img,
    system: {
      description: { value: lsCompileActivationRows(activation, effects, { includeHeading: false }).join("") },
      actionType: { value: actionType }, actions: { value: actionCount },
      traits: { value: foundry.utils.deepClone(activation.traits), otherTags: [] },
      frequency: frequencyMax ? { max: frequencyMax, per: activation.frequencyPer || "day", value: frequencyMax } : null,
      rules: [],
    },
    flags: { [LS_MODULE_ID]: { itemActivation: { sourceItemId: item.id, activationId: activation.id } } },
  };
}

async function lsSyncOwnedItemActivations(item) {
  const actor = item.actor;
  if (!actor || !LS_PHYSICAL_ITEM_TYPES.has(item.type)) return;
  const flags = lsItemBuilderFlags(item);
  const desired = flags.activations.filter((activation) => activation.type !== "none");
  const linked = actor.items.filter((candidate) => candidate.type === "action" && candidate.getFlag(LS_MODULE_ID, "itemActivation")?.sourceItemId === item.id);
  const linkedByActivation = new Map(linked.map((candidate) => [candidate.getFlag(LS_MODULE_ID, "itemActivation")?.activationId, candidate]));
  const updates = [], creates = [];
  for (const [index, activation] of desired.entries()) {
    const source = lsActivationActionSource(item, activation, flags.effects.filter((effect) => effect.activationId === activation.id || (!effect.activationId && index === 0)));
    const existing = linkedByActivation.get(activation.id);
    if (existing) {
      if (source.system.frequency) {
        const remaining = Number(existing.system.frequency?.value);
        source.system.frequency.value = Number.isFinite(remaining) ? Math.min(source.system.frequency.max, Math.max(0, remaining)) : source.system.frequency.max;
      }
      const { type: _type, ...changes } = source;
      updates.push({ _id: existing.id, ...changes });
      linkedByActivation.delete(activation.id);
    } else creates.push(source);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (creates.length) await actor.createEmbeddedDocuments("Item", creates);
  const staleIds = [...linkedByActivation.values()].map((candidate) => candidate.id);
  if (staleIds.length) await actor.deleteEmbeddedDocuments("Item", staleIds);
}

function lsStripItemBuilderDescription(description) {
  return String(description ?? "").replace(/<!-- lore-smith:item-builder:start -->[\s\S]*?<!-- lore-smith:item-builder:end -->/g, "").trim();
}

class LoreSmithItemBuilder extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-item-builder-{id}",
    classes: ["lore-smith-builder"],
    position: { width: 980, height: 780 },
    window: { title: "Lore Smith Item Builder", icon: "fa-solid fa-hammer", resizable: true },
    actions: {
      previous: LoreSmithItemBuilder.previous,
      next: LoreSmithItemBuilder.next,
      searchSource: LoreSmithItemBuilder.searchSource,
      previousSources: LoreSmithItemBuilder.previousSources,
      nextSources: LoreSmithItemBuilder.nextSources,
      previewSource: LoreSmithItemBuilder.previewSource,
      useSource: LoreSmithItemBuilder.useSource,
      useCurrent: LoreSmithItemBuilder.useCurrent,
      addTrait: LoreSmithItemBuilder.addTrait,
      removeTrait: LoreSmithItemBuilder.removeTrait,
      addActivation: LoreSmithItemBuilder.addActivation,
      removeActivation: LoreSmithItemBuilder.removeActivation,
      addActivationTrait: LoreSmithItemBuilder.addActivationTrait,
      removeActivationTrait: LoreSmithItemBuilder.removeActivationTrait,
      addEffect: LoreSmithItemBuilder.addEffect,
      removeEffect: LoreSmithItemBuilder.removeEffect,
      goToStep: LoreSmithItemBuilder.goToStep,
      finish: LoreSmithItemBuilder.finish,
    },
  };

  static PARTS = {
    builder: { template: `modules/${LS_MODULE_ID}/templates/item-builder.hbs` },
  };

  constructor(item, options = {}) {
    super({ ...options, id: `lore-smith-item-builder-${item.id}` });
    this.item = item;
    this.builderFlags = lsItemBuilderFlags(item);
  }

  step = 0;
  query = "";
  sourceLevel = "";
  sourceTrait = "";
  sourcePage = 0;
  sourcePageSize = 60;
  sourceAllResults = [];
  sourcesLoaded = false;
  results = [];
  sourcePreview = null;

  async _prepareContext(options) {
    if (this.step === 0 && !this.sourcesLoaded) await this.loadSources();
    const item = this.item, system = item.system ?? {}, traitConfig = lsItemTraitConfig();
    const price = system.price?.value ?? {};
    const typeFlags = {
      weapon: item.type === "weapon", armor: item.type === "armor", shield: item.type === "shield",
      consumable: ["consumable", "ammo"].includes(item.type),
      equipment: ["equipment", "backpack", "kit"].includes(item.type), treasure: ["treasure", "book"].includes(item.type),
    };
    const activationChoices = this.builderFlags.activations.map((activation, index) => ({ value: activation.id, label: activation.name || `Activation ${index + 1}` }));
    const effects = this.builderFlags.effects.map((effect) => ({
      ...lsEffectView(effect),
      damageTypes: lsSelectOptions(CONFIG.PF2E.damageTypes, effect.damageType),
      effectTypes: lsSelectOptions(effect.kind === "resistance" ? (CONFIG.PF2E.resistanceTypes ?? CONFIG.PF2E.damageTypes)
        : effect.kind === "weakness" ? (CONFIG.PF2E.weaknessTypes ?? CONFIG.PF2E.damageTypes)
          : { ...(CONFIG.PF2E.damageTypes ?? {}), ...(CONFIG.PF2E.conditionTypes ?? {}) }, effect.damageType),
      saves: lsSelectOptions(null, effect.save, [["fortitude", "Fortitude"], ["reflex", "Reflex"], ["will", "Will"]]),
      modifierTypes: lsSelectOptions(null, effect.modifierType, [["item", "Item"], ["status", "Status"], ["circumstance", "Circumstance"], ["untyped", "Untyped"]]),
      regeneration: effect.option === "regeneration",
      activationOptions: [{ value: "", label: "Constant / unassigned", selected: !effect.activationId }, ...activationChoices.map((choice) => ({ ...choice, selected: choice.value === effect.activationId }))],
    }));
    const activations = this.builderFlags.activations.map((activation, index) => ({
      ...activation,
      number: index + 1,
      traitChips: activation.traits.map((value) => ({ value, label: game.i18n.localize(CONFIG.PF2E.actionTraits?.[value] ?? value) })),
      activationTraitOptions: lsSelectOptions(CONFIG.PF2E.actionTraits, ""),
      activationTypeOptions: lsSelectOptions(null, activation.type, [["free", "Free action"], ["reaction", "Reaction"], ["action", "Action"]]),
      activationActionOptions: lsSelectOptions(null, activation.actions, [["1", "One action"], ["2", "Two actions"], ["3", "Three actions"], ["varies", "One to three actions"]]),
      frequencyOptions: lsSelectOptions(null, activation.frequencyPer, [["round", "round"], ["minute", "minute"], ["hour", "hour"], ["day", "day"], ["week", "week"]]),
      areaOptions: lsSelectOptions(null, activation.areaType, [["none", "No area"], ["burst", "Burst"], ["cone", "Cone"], ["emanation", "Emanation"], ["line", "Line"]]),
    }));
    const generatedRules = this.builderFlags.generatedRules ?? [], rules = Array.isArray(system.rules) ? system.rules : [];
    const validation = [];
    if (!item.name?.trim()) validation.push("Add an item name.");
    if (typeFlags.weapon && !system.damage?.die) validation.push("Choose a weapon damage die.");
    if (typeFlags.armor && !system.category) validation.push("Choose an armor category.");
    if (typeFlags.consumable && lsNumber(system.uses?.max, 0) < 1) validation.push("Consumables need at least one use.");
    for (const effect of this.builderFlags.effects) {
      if (["flat-modifier", "damage-dice"].includes(effect.kind) && !effect.selector) validation.push(`${effect.label || "An automation effect"} needs a PF2e selector.`);
      if (["damage", "healing", "damage-dice"].includes(effect.kind) && !effect.formula) validation.push(`${effect.label || "An effect"} needs a dice formula.`);
      if (["resistance", "weakness", "immunity"].includes(effect.kind) && !effect.damageType) validation.push(`${effect.label || "An IWR effect"} needs a damage or condition type.`);
      if (["flat-modifier", "resistance", "weakness", "fast-healing"].includes(effect.kind) && String(effect.value ?? "").trim() === "") validation.push(`${effect.label || "An automation effect"} needs a numeric value.`);
    }
    return {
      ...await super._prepareContext(options),
      item: {
        name: item.name, img: item.img, type: item.type, typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
        level: lsNumber(system.level, 0), rarity: system.traits?.rarity ?? "common",
        traits: lsTraits(item).map((value) => ({ value, label: game.i18n.localize(traitConfig[value] ?? value) })),
        description: lsStripItemBuilderDescription(system.description?.value), isPhysical: LS_PHYSICAL_ITEM_TYPES.has(item.type), hasUsage: "usage" in system, hasCategory: "category" in system, ...typeFlags,
        quantity: lsNumber(system.quantity, 1), bulk: lsNumber(system.bulk, 0), hardness: lsNumber(system.hardness, 0), hpMax: lsNumber(system.hp?.max, 0), usage: system.usage?.value ?? "",
        price: { pp: lsCoinValue(price, "pp"), gp: lsCoinValue(price, "gp"), sp: lsCoinValue(price, "sp"), cp: lsCoinValue(price, "cp") },
        category: system.category ?? "", group: system.group ?? "", damageDice: lsNumber(system.damage?.dice, 1), damageDie: system.damage?.die ?? "d6",
        damageType: system.damage?.damageType ?? "", range: system.range ?? "", reload: system.reload?.value ?? "", splashDamage: lsNumber(system.splashDamage, 0),
        acBonus: lsNumber(system.acBonus, item.type === "shield" ? 2 : 0), strength: lsNumber(system.strength, 0), dexCap: lsNumber(system.dexCap, 0),
        checkPenalty: lsNumber(system.checkPenalty, 0), speedPenalty: lsNumber(system.speedPenalty, 0), usesValue: lsNumber(system.uses?.value, 1), usesMax: lsNumber(system.uses?.max, 1), autoDestroy: system.uses?.autoDestroy !== false,
      },
      activations, effects, query: this.query, results: this.results, sourcePreview: this.sourcePreview,
      sourceLevel: this.sourceLevel, sourceTrait: this.sourceTrait, sourceCount: this.sourceAllResults.length,
      sourcePageLabel: `${this.sourcePage + 1} / ${Math.max(1, Math.ceil(this.sourceAllResults.length / this.sourcePageSize))}`,
      hasPreviousSources: this.sourcePage > 0, hasNextSources: (this.sourcePage + 1) * this.sourcePageSize < this.sourceAllResults.length,
      levelFilters: Array.from({ length: 31 }, (_value, level) => ({ value: level, label: level, selected: String(level) === String(this.sourceLevel) })),
      itemLevels: Array.from({ length: 31 }, (_value, level) => ({ value: level, label: level, selected: level === lsNumber(system.level, 0) })),
      rarityOptions: ["common", "uncommon", "rare", "unique"].map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1), selected: value === (system.traits?.rarity ?? "common") })),
      itemTraitOptions: Object.entries(traitConfig).map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: value === this.sourceTrait })).sort((a, b) => a.label.localeCompare(b.label)),
      effectKindOptions: [["damage", "Damage roll"], ["healing", "Healing roll"], ["check", "Save or check"], ["condition", "Condition or reminder"], ["flat-modifier", "Flat modifier"], ["damage-dice", "Extra damage dice"], ["resistance", "Resistance"], ["weakness", "Weakness"], ["immunity", "Immunity"], ["fast-healing", "Fast healing / regeneration"], ["roll-option", "Toggleable roll option"]].map(([value, label]) => ({ value, label })),
      damageTypes: lsSelectOptions(CONFIG.PF2E.damageTypes, system.damage?.damageType),
      usageOptions: lsSelectOptions(CONFIG.PF2E.usages, system.usage?.value, [["held-in-one-hand", "Held in 1 hand"], ["held-in-two-hands", "Held in 2 hands"], ["worn", "Worn"], ["wornarmor", "Worn armor"]]),
      weaponCategories: lsSelectOptions(CONFIG.PF2E.weaponCategories, system.category, [["unarmed", "Unarmed"], ["simple", "Simple"], ["martial", "Martial"], ["advanced", "Advanced"]]),
      weaponGroups: lsSelectOptions(CONFIG.PF2E.weaponGroups, system.group),
      armorCategories: lsSelectOptions(CONFIG.PF2E.armorCategories, system.category, [["unarmored", "Unarmored"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]]),
      armorGroups: lsSelectOptions(CONFIG.PF2E.armorGroups, system.group),
      consumableCategories: lsSelectOptions(CONFIG.PF2E.consumableCategories, system.category, [["ammunition", "Ammunition"], ["elixir", "Elixir"], ["oil", "Oil"], ["other", "Other"], ["poison", "Poison"], ["potion", "Potion"], ["scroll", "Scroll"], ["snare", "Snare"], ["talisman", "Talisman"], ["tool", "Tool"]]),
      bulkOptions: [["0", "Negligible"], ["0.1", "Light"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["10", "10"]].map(([value, label]) => ({ value, label, selected: Number(value) === lsNumber(system.bulk, 0) })),
      dieOptions: ["d4", "d6", "d8", "d10", "d12"].map((value) => ({ value, selected: value === system.damage?.die })),
      nativeRuleCount: Math.max(0, rules.length - generatedRules.length), generatedRuleCount: this.builderFlags.effects.map((effect) => lsGeneratedRule(effect, item.name)).filter(Boolean).length, validation, valid: validation.length === 0,
      step: this.step, stepNumber: this.step + 1,
      steps: { source: this.step === 0, basics: this.step === 1, mechanics: this.step === 2, activation: this.step === 3, automation: this.step === 4, review: this.step === 5 },
      canBack: this.step > 0, canNext: this.step > 0 && this.step < 5,
    };
  }

  async loadSources() {
    this.sourceAllResults = await lsSearchPacks({
      documentName: "Item",
      query: this.query,
      types: [this.item.type],
      level: this.sourceLevel,
      trait: this.sourceTrait,
    });
    const start = this.sourcePage * this.sourcePageSize;
    this.results = this.sourceAllResults.slice(start, start + this.sourcePageSize);
    this.sourcesLoaded = true;
  }

  async saveStep() {
    const root = this.element;
    if (!root) return;
    if (this.step === 1) {
      await this.item.update({
        name: root.querySelector('[name="name"]')?.value.trim() || this.item.name,
        "system.level.value": Math.max(0, Math.min(30, lsNumber(root.querySelector('[name="level"]')?.value, 0))),
        "system.traits.rarity": root.querySelector('[name="rarity"]')?.value || "common",
      });
    }
    if (this.step === 2) {
      const updates = { "system.description.value": root.querySelector('[name="description"]')?.value ?? "" };
      if (LS_PHYSICAL_ITEM_TYPES.has(this.item.type)) Object.assign(updates, {
        "system.quantity": Math.max(1, lsNumber(root.querySelector('[name="quantity"]')?.value, 1)),
        "system.bulk.value": lsNumber(root.querySelector('[name="bulk"]')?.value, 0),
        "system.hardness": Math.max(0, lsNumber(root.querySelector('[name="hardness"]')?.value, 0)),
        "system.hp.max": Math.max(0, lsNumber(root.querySelector('[name="hpMax"]')?.value, 0)),
        "system.hp.value": Math.max(0, lsNumber(root.querySelector('[name="hpMax"]')?.value, 0)),
        "system.price.value": Object.fromEntries(["pp", "gp", "sp", "cp"].map((coin) => [coin, Math.max(0, lsNumber(root.querySelector(`[name="price${coin.toUpperCase()}"]`)?.value, 0))])),
      });
      if (this.item.system?.usage) updates["system.usage.value"] = root.querySelector('[name="usage"]')?.value || this.item.system.usage.value;
      if (this.item.type === "weapon") Object.assign(updates, {
        "system.category": root.querySelector('[name="category"]')?.value || "simple", "system.group": root.querySelector('[name="group"]')?.value || null,
        "system.damage.dice": Math.max(1, lsNumber(root.querySelector('[name="damageDice"]')?.value, 1)), "system.damage.die": root.querySelector('[name="damageDie"]')?.value || "d6",
        "system.damage.damageType": root.querySelector('[name="damageType"]')?.value || "bludgeoning", "system.range": root.querySelector('[name="range"]')?.value === "" ? null : lsNumber(root.querySelector('[name="range"]')?.value, null),
        "system.reload.value": root.querySelector('[name="reload"]')?.value || null, "system.splashDamage.value": Math.max(0, lsNumber(root.querySelector('[name="splashDamage"]')?.value, 0)),
      });
      if (this.item.type === "armor") Object.assign(updates, {
        "system.category": root.querySelector('[name="category"]')?.value || "light", "system.group": root.querySelector('[name="group"]')?.value || null,
        "system.acBonus": lsNumber(root.querySelector('[name="acBonus"]')?.value, 0), "system.strength": Math.max(0, lsNumber(root.querySelector('[name="strength"]')?.value, 0)),
        "system.dexCap": lsNumber(root.querySelector('[name="dexCap"]')?.value, 0), "system.checkPenalty": lsNumber(root.querySelector('[name="checkPenalty"]')?.value, 0), "system.speedPenalty": lsNumber(root.querySelector('[name="speedPenalty"]')?.value, 0),
      });
      if (this.item.type === "shield") Object.assign(updates, { "system.acBonus": lsNumber(root.querySelector('[name="acBonus"]')?.value, 2), "system.speedPenalty": lsNumber(root.querySelector('[name="speedPenalty"]')?.value, 0) });
      if (["consumable", "ammo"].includes(this.item.type)) Object.assign(updates, {
        ...(this.item.type === "consumable" ? { "system.category": root.querySelector('[name="category"]')?.value || "other" } : {}),
        "system.uses.value": Math.max(0, lsNumber(root.querySelector('[name="usesValue"]')?.value, 1)), "system.uses.max": Math.max(1, lsNumber(root.querySelector('[name="usesMax"]')?.value, 1)),
        "system.uses.autoDestroy": Boolean(root.querySelector('[name="autoDestroy"]')?.checked),
      });
      await this.item.update(updates);
    }
    if (this.step === 3) {
      this.syncActivationsFromForm();
      await this.item.setFlag(LS_MODULE_ID, "itemBuilder", this.builderFlags);
    }
    if (this.step === 4) {
      this.syncEffectsFromForm();
      await this.item.setFlag(LS_MODULE_ID, "itemBuilder", this.builderFlags);
    }
  }

  syncActivationsFromForm() {
    const root = this.element;
    if (!root) return;
    const previous = new Map(this.builderFlags.activations.map((activation) => [activation.id, activation]));
    this.builderFlags.activations = [...root.querySelectorAll("[data-activation-id]")].map((card) => {
      const id = card.dataset.activationId;
      return lsNewItemActivation({
        id, traits: previous.get(id)?.traits ?? [],
        name: card.querySelector('[name="activationName"]')?.value.trim() || "",
        type: card.querySelector('[name="activationType"]')?.value || "action", actions: card.querySelector('[name="activationActions"]')?.value || "1",
        frequencyMax: card.querySelector('[name="activationFrequencyMax"]')?.value ?? "", frequencyPer: card.querySelector('[name="activationFrequencyPer"]')?.value || "day",
        trigger: card.querySelector('[name="activationTrigger"]')?.value.trim() || "", requirements: card.querySelector('[name="activationRequirements"]')?.value.trim() || "",
        range: card.querySelector('[name="activationRange"]')?.value.trim() || "", target: card.querySelector('[name="activationTarget"]')?.value.trim() || "",
        areaType: card.querySelector('[name="activationAreaType"]')?.value || "none", areaSize: card.querySelector('[name="activationAreaSize"]')?.value ?? "",
        duration: card.querySelector('[name="activationDuration"]')?.value.trim() || "", effectText: card.querySelector('[name="activationEffectText"]')?.value.trim() || "",
      });
    });
  }

  syncEffectsFromForm() {
    const root = this.element;
    if (!root) return;
    this.builderFlags.effects = [...root.querySelectorAll("[data-effect-id]")].map((card) => {
      const optionControl = card.querySelector('[name="effectOption"]');
      return {
        id: card.dataset.effectId, kind: card.dataset.effectKind, label: card.querySelector('[name="effectLabel"]')?.value.trim() || "",
        activationId: card.querySelector('[name="effectActivationId"]')?.value || "",
        formula: card.querySelector('[name="effectFormula"]')?.value.trim() || "", damageType: card.querySelector('[name="effectDamageType"]')?.value || "",
        save: card.querySelector('[name="effectSave"]')?.value || "reflex", dc: card.querySelector('[name="effectDc"]')?.value.trim() || "", basic: Boolean(card.querySelector('[name="effectBasic"]')?.checked),
        selector: card.querySelector('[name="effectSelector"]')?.value.trim() || "", value: card.querySelector('[name="effectValue"]')?.value.trim() || "",
        modifierType: card.querySelector('[name="effectModifierType"]')?.value || "item", condition: card.querySelector('[name="effectCondition"]')?.value.trim() || "",
        option: optionControl?.type === "checkbox" ? (optionControl.checked ? optionControl.value : "") : optionControl?.value.trim() || "",
        note: card.querySelector('[name="effectNote"]')?.value.trim() || "",
      };
    });
  }

  async persistBuilderAutomation() {
    const previous = this.builderFlags.generatedRules ?? [];
    const existing = (this.item.system.rules ?? []).filter((rule) => !previous.some((generated) => JSON.stringify(generated) === JSON.stringify(rule)));
    const generated = this.builderFlags.effects.map((effect) => lsGeneratedRule(effect, this.item.name)).filter(Boolean);
    this.builderFlags.generatedRules = generated;
    await this.item.update({
      "system.rules": [...existing, ...generated],
      "system.description.value": lsCompileItemBuilderDescription(this.item.system.description?.value, this.builderFlags),
      [`flags.${LS_MODULE_ID}.itemBuilder`]: this.builderFlags,
    });
  }

  static async previous() {
    await this.saveStep();
    this.step = Math.max(0, this.step - 1);
    await this.render();
  }

  static async next() {
    await this.saveStep();
    this.step = Math.min(5, this.step + 1);
    await this.render();
  }

  static async goToStep(_event, target) {
    await this.saveStep();
    this.step = Math.max(0, Math.min(5, Number(target.dataset.step) || 0));
    await this.render();
  }

  static async searchSource() {
    this.query = this.element.querySelector('[name="sourceQuery"]')?.value ?? "";
    this.sourceLevel = this.element.querySelector('[name="sourceLevel"]')?.value ?? "";
    this.sourceTrait = this.element.querySelector('[name="sourceTrait"]')?.value ?? "";
    this.sourcePage = 0;
    await this.loadSources();
    await this.render();
  }

  static async previousSources() {
    this.sourcePage = Math.max(0, this.sourcePage - 1);
    await this.loadSources();
    await this.render();
  }

  static async nextSources() {
    this.sourcePage += 1;
    await this.loadSources();
    await this.render();
  }

  static async previewSource(_event, target) {
    this.sourcePreview = await lsBuildSourcePreview(target.dataset.uuid);
    await this.render();
  }

  static async useSource(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source || source.type !== this.item.type) return ui.notifications.error("That source is not the same PF2e item type.");
    const confirmed = await LSDialogV2.confirm({
      window: { title: "Use item as the starting point?" },
      content: `<p>This replaces the current item’s mechanics with <strong>${source.name}</strong>. You can edit it afterward.</p>`,
      yes: { label: "Use this item" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    await this.item.update({
      name: source.name,
      img: source.img,
      system: source.toObject().system,
      [`flags.${LS_MODULE_ID}.sourceUuid`]: source.uuid,
    });
    this.builderFlags = lsEmptyItemBuilderFlags();
    this.step = 1;
    await this.render();
  }

  static async useCurrent() {
    this.step = 1;
    await this.render();
  }

  static async addTrait() {
    const trait = this.element.querySelector('[name="traitToAdd"]')?.value;
    if (!trait) return;
    const traits = new Set(lsTraits(this.item));
    await this.saveStep();
    traits.add(trait);
    await this.item.update({ "system.traits.value": [...traits] });
    await this.render();
  }

  static async removeTrait(_event, target) {
    await this.saveStep();
    const traits = lsTraits(this.item).filter((trait) => trait !== target.dataset.trait);
    await this.item.update({ "system.traits.value": traits });
    await this.render();
  }

  static async addActivationTrait(_event, target) {
    this.syncActivationsFromForm();
    const card = this.element.querySelector(`[data-activation-id="${CSS.escape(target.dataset.id ?? "")}"]`);
    const activation = this.builderFlags.activations.find((entry) => entry.id === target.dataset.id);
    const trait = card?.querySelector('[name="activationTraitToAdd"]')?.value;
    if (activation && trait && !activation.traits.includes(trait)) activation.traits.push(trait);
    await this.render();
  }

  static async removeActivationTrait(_event, target) {
    this.syncActivationsFromForm();
    const activation = this.builderFlags.activations.find((entry) => entry.id === target.dataset.id);
    if (activation) activation.traits = activation.traits.filter((trait) => trait !== target.dataset.trait);
    await this.render();
  }

  static async addActivation() {
    this.syncActivationsFromForm();
    this.builderFlags.activations.push(lsNewItemActivation());
    await this.render();
  }

  static async removeActivation(_event, target) {
    this.syncActivationsFromForm();
    this.builderFlags.activations = this.builderFlags.activations.filter((activation) => activation.id !== target.dataset.id);
    this.builderFlags.effects = this.builderFlags.effects.map((effect) => effect.activationId === target.dataset.id ? { ...effect, activationId: "" } : effect);
    await this.render();
  }

  static async addEffect() {
    this.syncEffectsFromForm();
    const kind = this.element.querySelector('[name="effectKindToAdd"]')?.value || "damage";
    this.builderFlags.effects.push({ id: foundry.utils.randomID(), kind, basic: true });
    await this.render();
  }

  static async removeEffect(_event, target) {
    this.syncEffectsFromForm();
    this.builderFlags.effects = this.builderFlags.effects.filter((effect) => effect.id !== target.dataset.id);
    await this.render();
  }

  static async finish() {
    await this.saveStep();
    await this.persistBuilderAutomation();
    await this.item.setFlag(LS_MODULE_ID, "builderComplete", true);
    await lsSyncOwnedItemActivations(this.item);
    await this.close();
    this.item.sheet.render(true);
  }
}

class LoreSmithLiveLog extends LSHandlebarsMixin(LSApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-live-log",
    classes: ["lore-smith-live-log"],
    position: { width: 1040, height: 760, left: 40, top: 40 },
    window: { title: "Lore Smith Live Combat", icon: "fa-solid fa-swords", resizable: true },
    actions: {
      togglePause: LoreSmithLiveLog.togglePause,
      stop: LoreSmithLiveLog.stop,
      previousEntry: LoreSmithLiveLog.previousEntry,
      nextEntry: LoreSmithLiveLog.nextEntry,
      resetBattlefieldView: LoreSmithLiveLog.resetBattlefieldView,
    },
  };

  static PARTS = {
    log: { template: `modules/${LS_MODULE_ID}/templates/live-combat.hbs` },
  };

  entries = [];
  running = true;
  paused = false;
  stopped = false;
  status = "Preparing encounter";
  summary = null;
  coverageHtml = "";
  timelineIndex = -1;
  followingLatest = true;
  mapZoom = 1;
  mapPan = { x: 0, y: 0 };
  mapSceneKey = "";
  currentBattlefieldScene = null;
  battlefieldObserver = null;

  async _prepareContext(options) {
    return {
      ...await super._prepareContext(options),
      entries: this.entries,
      delay: game.settings.get(LS_MODULE_ID, "liveActionDelay"),
      delaySeconds: (game.settings.get(LS_MODULE_ID, "liveActionDelay") / 1000).toFixed(2),
      running: this.running,
      paused: this.paused,
      stopped: this.stopped,
      status: this.status,
      summary: this.summary,
      coverageHtml: this.coverageHtml
        ? new Handlebars.SafeString(this.coverageHtml)
        : null,
      timelineIndex: Math.max(0, this.timelineIndex),
      timelinePosition: this.entries.length ? this.timelineIndex + 1 : 0,
      timelineMax: Math.max(0, this.entries.length - 1),
      timelineTotal: this.entries.length,
      timelineAtStart: this.timelineIndex <= 0,
      timelineAtEnd: this.timelineIndex >= this.entries.length - 1,
      hasTimelineEntries: this.entries.length > 0,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const slider = this.element?.querySelector('[name="liveDelay"]');
    const label = this.element?.querySelector('[data-role="delayLabel"]');
    slider?.addEventListener("input", async () => {
      const value = Number(slider.value);
      if (label) label.textContent = `${(value / 1000).toFixed(2)} seconds`;
      await game.settings.set(LS_MODULE_ID, "liveActionDelay", value);
    });
    const log = this.element?.querySelector(".ls-live-entries");
    const timeline = this.element?.querySelector('[name="timelineIndex"]');
    timeline?.addEventListener("input", () => this.seekTimeline(Number(timeline.value)));
    if (log && this.followingLatest) log.scrollTop = log.scrollHeight;
    this.bindBattlefieldNavigation();
    this.renderBattlefield(this.entries[this.timelineIndex]?.snapshot, this.entries[this.timelineIndex]?.text);
    this.syncTimelineControls();
    this.bringToTop?.();
  }

  bindBattlefieldNavigation() {
    const stage = this.element?.querySelector('[data-role="battlefield"]');
    if (!stage) return;
    this.battlefieldObserver?.disconnect?.();
    this.battlefieldObserver = new ResizeObserver(() => this.applyBattlefieldTransform());
    this.battlefieldObserver.observe(stage);
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (!this.currentBattlefieldScene) return;
      const rect = stage.getBoundingClientRect();
      const scene = this.currentBattlefieldScene;
      const fit = Math.min(rect.width / Math.max(1, scene.width), rect.height / Math.max(1, scene.height));
      const previousScale = fit * this.mapZoom;
      const previousBase = {
        x: (rect.width - scene.width * previousScale) / 2 + this.mapPan.x,
        y: (rect.height - scene.height * previousScale) / 2 + this.mapPan.y,
      };
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const worldPoint = {
        x: (pointer.x - previousBase.x) / Math.max(0.0001, previousScale),
        y: (pointer.y - previousBase.y) / Math.max(0.0001, previousScale),
      };
      this.mapZoom = Math.max(0.5, Math.min(8, this.mapZoom * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
      const nextScale = fit * this.mapZoom;
      const centered = {
        x: (rect.width - scene.width * nextScale) / 2,
        y: (rect.height - scene.height * nextScale) / 2,
      };
      this.mapPan = {
        x: pointer.x - worldPoint.x * nextScale - centered.x,
        y: pointer.y - worldPoint.y * nextScale - centered.y,
      };
      this.applyBattlefieldTransform();
    }, { passive: false });
    let dragging = false;
    let previous = null;
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      dragging = true;
      previous = { x: event.clientX, y: event.clientY };
      stage.setPointerCapture?.(event.pointerId);
      stage.classList.add("panning");
    });
    stage.addEventListener("pointermove", (event) => {
      if (!dragging || !previous) return;
      this.mapPan.x += event.clientX - previous.x;
      this.mapPan.y += event.clientY - previous.y;
      previous = { x: event.clientX, y: event.clientY };
      this.applyBattlefieldTransform();
    });
    const finishPan = (event) => {
      if (!dragging) return;
      dragging = false;
      previous = null;
      stage.releasePointerCapture?.(event.pointerId);
      stage.classList.remove("panning");
    };
    stage.addEventListener("pointerup", finishPan);
    stage.addEventListener("pointercancel", finishPan);
  }

  applyBattlefieldTransform() {
    const stage = this.element?.querySelector('[data-role="battlefield"]');
    const world = this.element?.querySelector('[data-role="battlefieldWorld"]');
    const scene = this.currentBattlefieldScene;
    if (!stage || !world || !scene) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    const fit = Math.min(width / Math.max(1, scene.width), height / Math.max(1, scene.height));
    const scale = fit * this.mapZoom;
    const left = (width - scene.width * scale) / 2 + this.mapPan.x;
    const top = (height - scene.height * scale) / 2 + this.mapPan.y;
    world.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }

  resetMapView() {
    this.mapZoom = 1;
    this.mapPan = { x: 0, y: 0 };
    this.applyBattlefieldTransform();
  }

  async showMovementFrame(snapshot, captionText = "") {
    if (!this.followingLatest || !this.element) return;
    this.renderBattlefield(snapshot, captionText);
  }

  async add(entry) {
    entry.index = this.entries.length;
    this.entries.push(entry);
    if (this.entries.length > 500) {
      this.entries.shift();
      this.entries.forEach((candidate, index) => { candidate.index = index; });
    }
    if (this.followingLatest || this.timelineIndex < 0) this.timelineIndex = this.entries.length - 1;
    const list = this.element?.querySelector(".ls-live-entries");
    if (!list) return this.render({ force: true });
    list.querySelector(".empty")?.remove();
    const row = document.createElement("p");
    row.className = entry.kind ?? "action";
    row.dataset.entryIndex = String(entry.index);
    row.textContent = entry.text;
    list.append(row);
    if (this.followingLatest) list.scrollTop = list.scrollHeight;
    if (this.followingLatest) this.renderBattlefield(entry.snapshot, entry.text);
    this.syncTimelineControls();
  }

  syncTimelineControls() {
    const root = this.element;
    if (!root) return;
    const slider = root.querySelector('[name="timelineIndex"]');
    const label = root.querySelector('[data-role="timelineLabel"]');
    const previous = root.querySelector('[data-action="previousEntry"]');
    const next = root.querySelector('[data-action="nextEntry"]');
    if (slider) {
      slider.max = String(Math.max(0, this.entries.length - 1));
      slider.value = String(Math.max(0, this.timelineIndex));
      slider.disabled = this.entries.length < 2;
    }
    if (label) label.textContent = this.entries.length
      ? `Action ${this.timelineIndex + 1} of ${this.entries.length}`
      : "No actions yet";
    if (previous) previous.disabled = this.timelineIndex <= 0;
    if (next) next.disabled = this.timelineIndex >= this.entries.length - 1;
    for (const row of root.querySelectorAll("[data-entry-index]")) {
      row.classList.toggle("timeline-selected", Number(row.dataset.entryIndex) === this.timelineIndex);
    }
  }

  async applyTimelineSnapshot(snapshot) {
    this.renderBattlefield(snapshot, this.entries[this.timelineIndex]?.text);
  }

  renderBattlefield(snapshot, captionText = "") {
    const stage = this.element?.querySelector('[data-role="battlefield"]');
    const world = this.element?.querySelector('[data-role="battlefieldWorld"]');
    const background = this.element?.querySelector('[data-role="battlefieldBackground"]');
    const grid = this.element?.querySelector('[data-role="battlefieldGrid"]');
    const layer = this.element?.querySelector('[data-role="battlefieldTokens"]');
    const wallLayer = this.element?.querySelector('[data-role="battlefieldWalls"]');
    const overlayLayer = this.element?.querySelector('[data-role="battlefieldOverlay"]');
    const caption = this.element?.querySelector('[data-role="battlefieldCaption"]');
    if (!stage || !world || !background || !grid || !layer || !wallLayer || !overlayLayer || !snapshot?.scene) return;
    const scene = snapshot.scene;
    const sceneKey = `${scene.id}:${scene.x}:${scene.y}:${scene.width}:${scene.height}:${scene.gridSize}`;
    if (this.mapSceneKey !== sceneKey) {
      this.mapSceneKey = sceneKey;
      this.mapZoom = 1;
      this.mapPan = { x: 0, y: 0 };
    }
    this.currentBattlefieldScene = scene;
    const safeBackground = String(scene.background ?? "").replace(/["\\]/g, (character) => `\\${character}`);
    world.style.width = `${scene.width}px`;
    world.style.height = `${scene.height}px`;
    background.style.backgroundImage = safeBackground ? `url("${safeBackground}")` : "none";
    grid.style.backgroundSize = `${Math.max(1, scene.gridSize)}px ${Math.max(1, scene.gridSize)}px`;
    grid.hidden = Number(scene.gridType) === Number(CONST.GRID_TYPES.GRIDLESS);
    if (caption) caption.textContent = captionText || "Isolated combat state";
    const existingTokens = new Map([...layer.children].map((node) => [node.dataset.tokenId, node]));
    const visibleTokenIds = new Set();
    for (const token of snapshot.tokens ?? []) {
      const tokenId = String(token.tokenId ?? token.actorId ?? token.name);
      visibleTokenIds.add(tokenId);
      let node = existingTokens.get(tokenId);
      if (!node) {
        node = document.createElement("article");
        node.dataset.tokenId = tokenId;
        const portrait = document.createElement("img");
        portrait.alt = "";
        const label = document.createElement("strong");
        const hp = document.createElement("span");
        hp.className = "ls-live-token-hp";
        hp.append(document.createElement("i"));
        const details = document.createElement("small");
        node.append(portrait, label, hp, details);
        layer.append(node);
      }
      node.className = `ls-live-token ${token.team}${token.defeated ? " defeated" : ""}`;
      node.style.left = `${token.x - scene.x}px`;
      node.style.top = `${token.y - scene.y}px`;
      node.style.width = `${token.width}px`;
      node.style.height = `${token.height}px`;
      node.title = `${token.name} — ${token.hp}/${token.maxHp} HP`;
      const portrait = node.querySelector("img");
      portrait.src = token.image;
      const label = node.querySelector("strong");
      label.textContent = token.name;
      const hpFill = node.querySelector(".ls-live-token-hp i");
      hpFill.style.width = `${Math.max(0, Math.min(100, token.hp / Math.max(1, token.maxHp) * 100))}%`;
      const details = node.querySelector("small");
      const conditions = (token.conditions ?? []).map((condition) => `${condition.slug}${condition.value > 1 ? ` ${condition.value}` : ""}${condition.reason ? ` — ${condition.reason}` : ""}`);
      details.textContent = `${token.hp}/${token.maxHp} HP${conditions.length ? ` · ${conditions.join(", ")}` : ""}`;
    }
    for (const [tokenId, node] of existingTokens) if (!visibleTokenIds.has(tokenId)) node.remove();
    const namespace = "http://www.w3.org/2000/svg";
    wallLayer.replaceChildren();
    wallLayer.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    for (const wall of scene.walls ?? []) {
      const [x1, y1, x2, y2] = wall.coordinates;
      const line = document.createElementNS(namespace, "line");
      line.setAttribute("x1", Number(x1) - scene.x);
      line.setAttribute("y1", Number(y1) - scene.y);
      line.setAttribute("x2", Number(x2) - scene.x);
      line.setAttribute("y2", Number(y2) - scene.y);
      line.classList.add("ls-live-wall");
      if (wall.door) line.classList.add("door");
      if (wall.doorState === Number(CONST.WALL_DOOR_STATES?.OPEN ?? 1)) line.classList.add("open");
      wallLayer.append(line);
    }
    overlayLayer.replaceChildren();
    overlayLayer.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    const area = snapshot.overlay;
    if (!area) {
      requestAnimationFrame(() => this.applyBattlefieldTransform());
      return;
    }
    const pixelsPerFoot = scene.gridSize / Math.max(1, scene.gridDistance);
    const length = Number(area.distance ?? 0) * pixelsPerFoot;
    const areaX = Number(area.x) - scene.x;
    const areaY = Number(area.y) - scene.y;
    let shape = null;
    if (area.t === "circle") {
      shape = document.createElementNS(namespace, "circle");
      shape.setAttribute("cx", areaX);
      shape.setAttribute("cy", areaY);
      shape.setAttribute("r", length);
    } else if (area.t === "cone") {
      const radians = Number(area.direction ?? 0) * Math.PI / 180;
      const half = Number(area.angle ?? 90) / 2 * Math.PI / 180;
      const points = [
        [areaX, areaY],
        [areaX + Math.cos(radians - half) * length, areaY + Math.sin(radians - half) * length],
        [areaX + Math.cos(radians + half) * length, areaY + Math.sin(radians + half) * length],
      ];
      shape = document.createElementNS(namespace, "polygon");
      shape.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    } else if (area.t === "ray") {
      const radians = Number(area.direction ?? 0) * Math.PI / 180;
      const halfWidth = Number(area.width ?? 5) * pixelsPerFoot / 2;
      const perpendicular = { x: -Math.sin(radians) * halfWidth, y: Math.cos(radians) * halfWidth };
      const end = { x: areaX + Math.cos(radians) * length, y: areaY + Math.sin(radians) * length };
      const points = [
        [areaX + perpendicular.x, areaY + perpendicular.y],
        [end.x + perpendicular.x, end.y + perpendicular.y],
        [end.x - perpendicular.x, end.y - perpendicular.y],
        [areaX - perpendicular.x, areaY - perpendicular.y],
      ];
      shape = document.createElementNS(namespace, "polygon");
      shape.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    } else {
      shape = document.createElementNS(namespace, "rect");
      shape.setAttribute("x", areaX - length / 2);
      shape.setAttribute("y", areaY - length / 2);
      shape.setAttribute("width", length);
      shape.setAttribute("height", length);
    }
    shape.classList.add("ls-live-area-shape");
    overlayLayer.append(shape);
    requestAnimationFrame(() => this.applyBattlefieldTransform());
  }

  async seekTimeline(index) {
    if (!this.entries.length) return;
    this.timelineIndex = Math.max(0, Math.min(this.entries.length - 1, Number(index) || 0));
    this.followingLatest = this.timelineIndex === this.entries.length - 1;
    if (this.running && !this.followingLatest) {
      this.paused = true;
      this.status = "Paused for timeline review";
    }
    await this.applyTimelineSnapshot(this.entries[this.timelineIndex]?.snapshot);
    this.syncTimelineControls();
    this.element?.querySelector(`[data-entry-index="${this.timelineIndex}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async complete() {
    this.running = false;
    this.status = this.stopped ? "Stopped by the GM"
      : this.status === "Running" ? "Simulation complete" : this.status;
    await this.render({ force: true });
  }

  isPaused() {
    return this.paused;
  }

  isStopped() {
    return this.stopped;
  }

  static async togglePause() {
    if (!this.running || this.stopped) return;
    if (this.paused && !this.followingLatest && this.entries.length) {
      await this.seekTimeline(this.entries.length - 1);
    }
    this.paused = !this.paused;
    this.status = this.paused ? "Paused" : "Running";
    await this.render({ force: true });
  }

  static async stop() {
    if (!this.running) return;
    this.stopped = true;
    this.paused = false;
    this.status = "Stopping";
    await this.render({ force: true });
  }

  static resetBattlefieldView() {
    this.resetMapView();
  }

  async close(options = {}) {
    this.battlefieldObserver?.disconnect?.();
    if (this.running) {
      this.stopped = true;
      this.paused = false;
      this.running = false;
      this.status = "Stopped because the replay window was closed";
    }
    return super.close(options);
  }

  static async previousEntry() {
    await this.seekTimeline(this.timelineIndex - 1);
  }

  static async nextEntry() {
    await this.seekTimeline(this.timelineIndex + 1);
  }
}

function lsCombatSides() {
  const combat = game.combat;
  if (!combat) return null;
  const tokens = [];
  const partyIds = new Set();
  const enemyIds = new Set();
  for (const combatant of combat.combatants) {
    const token = combatant.token;
    if (!token?.actor) continue;
    tokens.push(token);
    const disposition = token.disposition;
    const friendly = disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
      || (disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE && token.actor.type === "character");
    (friendly ? partyIds : enemyIds).add(token.id);
  }
  return { combat, tokens, partyIds, enemyIds };
}

const LS_CREATURE_XP = new Map([
  [-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40],
  [1, 60], [2, 80], [3, 120], [4, 160],
]);

const LS_DIFFICULTY_BUDGETS = [
  { name: "Trivial", xp: 40 },
  { name: "Low", xp: 60 },
  { name: "Moderate", xp: 80 },
  { name: "Severe", xp: 120 },
  { name: "Extreme", xp: 160 },
];

function lsInterpolatedDifficulty(xp) {
  if (xp < LS_DIFFICULTY_BUDGETS[0].xp) return "Trivial-";
  for (let index = 0; index < LS_DIFFICULTY_BUDGETS.length; index += 1) {
    const current = LS_DIFFICULTY_BUDGETS[index];
    if (xp === current.xp) return current.name;
    const next = LS_DIFFICULTY_BUDGETS[index + 1];
    if (!next || xp > next.xp) continue;
    const progress = (xp - current.xp) / (next.xp - current.xp);
    if (progress < 0.25) return current.name;
    if (progress < 0.58) return `${current.name}+`;
    return `${next.name}-`;
  }
  return "Extreme+";
}

function lsEncounterDifficulty(sides) {
  const party = sides.tokens.filter((token) => sides.partyIds.has(token.id));
  const enemies = sides.tokens.filter((token) => sides.enemyIds.has(token.id));
  const partyLevel = Math.round(party.reduce((sum, token) =>
    sum + lsNumber(token.actor?.system?.details?.level, 0), 0) / Math.max(1, party.length));
  const creatureXp = enemies.reduce((sum, token) => {
    const difference = lsNumber(token.actor?.system?.details?.level, 0) - partyLevel;
    if (difference > 4) return sum + 240;
    if (difference < -4) return sum;
    return sum + (LS_CREATURE_XP.get(difference) ?? 0);
  }, 0);
  const adjustedXp = creatureXp * 4 / Math.max(1, party.length);
  return {
    label: lsInterpolatedDifficulty(adjustedXp),
    creatureXp,
    adjustedXp: Math.round(adjustedXp),
    partyLevel,
    partySize: party.length,
  };
}

function lsRunEncounterSample(sides, iterations, captureCount = 0) {
  let wins = 0;
  let rounds = 0;
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const result = game.loreSmith.simulateEncounter(sides.tokens, sides.partyIds, sides.enemyIds, {
      captureLog: index < captureCount,
    });
    if (result.partyWon) wins += 1;
    rounds += result.rounds;
    if (index < captureCount) samples.push(result);
  }
  return {
    wins,
    iterations,
    victoryRate: ((wins / iterations) * 100).toFixed(1),
    averageRounds: (rounds / iterations).toFixed(1),
    samples,
    difficulty: lsEncounterDifficulty(sides),
  };
}

async function lsRunIterations() {
  await game.loreSmith.ensureDecisionFlows?.();
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    return ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
  }
  const iterations = Math.max(1, Math.min(1000, game.settings.get(LS_MODULE_ID, "combatIterations")));
  const report = lsRunEncounterSample(sides, iterations, 20);
  const coverage = game.loreSmith.buildCoverageReport(sides.tokens, sides.partyIds, sides.enemyIds);
  const coverageHtml = coverageReportHtml(coverage, foundry.utils.escapeHTML);
  const logHtml = report.samples.map((sample, index) => `
    <details ${index === 0 ? "open" : ""}>
      <summary>Iteration ${index + 1} · ${sample.partyWon ? "Characters win" : "Opposition wins"} · ${sample.rounds} rounds</summary>
      ${sample.log.map((entry) => `<p class="${entry.kind}">${foundry.utils.escapeHTML(entry.text)}</p>`).join("")}
    </details>`).join("");
  const content = `<div class="ls-combat-report">
    <header>
      <article><span>Character victory</span><strong>${report.victoryRate}%</strong><small>${report.wins}/${iterations} combats</small></article>
      <article><span>Rules-based difficulty</span><strong>${report.difficulty.label}</strong><small>${report.difficulty.creatureXp} creature XP · ${report.difficulty.adjustedXp} party-adjusted XP · party level ${report.difficulty.partyLevel}</small></article>
      <article><span>Average duration</span><strong>${report.averageRounds}</strong><small>rounds</small></article>
    </header>
    <p>Victory is a randomized simulation estimate. Difficulty is calculated separately from PF2e encounter XP, adjusted for a ${report.difficulty.partySize}-character party.</p>
    <p>Iterations are configured in <strong>Game Settings → Configure Settings → Module Settings → Lore Smith</strong>.</p>
    ${coverageHtml}
    <section>${logHtml}</section>
  </div>`;
  new LSDialogV2({
    window: { title: `Lore Smith Combat Logs · ${iterations} iterations`, resizable: true },
    position: { width: 850, height: 760 },
    content,
    buttons: [{ action: "close", label: "Close", default: true }],
  }).render(true);
}

async function lsRunLiveCombat() {
  await game.loreSmith.ensureDecisionFlows?.();
  const viewportMargin = 8;
  const log = new LoreSmithLiveLog({
    id: `lore-smith-live-log-${foundry.utils.randomID(6)}`,
    position: {
      left: viewportMargin,
      top: viewportMargin,
      width: Math.max(320, window.innerWidth - viewportMargin * 2),
      height: Math.max(360, window.innerHeight - viewportMargin * 2),
    },
  });
  await log.render(true);
  await log.add({ text: "Preparing the current Combat Tracker encounter...", kind: "round" });
  const sides = lsCombatSides();
  if (!sides || !sides.partyIds.size || !sides.enemyIds.size) {
    log.status = "Cannot start";
    await log.add({ text: "Add at least one friendly and one hostile combatant to the active Combat Tracker, then press Live Combat again.", kind: "error" });
    await log.complete();
    ui.notifications.error("Start an encounter with at least one friendly and one hostile combatant.");
    return;
  }
  try {
    const previewIterations = Math.max(20, Math.min(200, game.settings.get(LS_MODULE_ID, "combatIterations")));
    const preview = lsRunEncounterSample(sides, previewIterations);
    const coverage = game.loreSmith.buildCoverageReport(sides.tokens, sides.partyIds, sides.enemyIds);
    log.coverageHtml = coverageReportHtml(coverage, foundry.utils.escapeHTML);
    log.summary = {
      victoryRate: `${preview.victoryRate}%`,
      difficulty: preview.difficulty.label,
      difficultyDetail: `${preview.difficulty.creatureXp} creature XP · ${preview.difficulty.adjustedXp} adjusted XP`,
      averageRounds: preview.averageRounds,
      iterations: previewIterations,
    };
    const liveCombat = sides.combat;
    log.status = "Running";
    await log.render({ force: true });
    ui.notifications.info("Lore Smith live combat started. Use the separate window to read the log and change its speed.");
    await game.loreSmith.runLiveReplay(sides.tokens, sides.partyIds, sides.enemyIds, {
      combat: liveCombat,
      onLog: (entry) => log.add(entry),
      delay: () => game.settings.get(LS_MODULE_ID, "liveActionDelay"),
      control: log,
      isolated: true,
    });
  } catch (error) {
    console.error(`${LS_MODULE_ID} | Live combat failed`, error);
    log.status = "Stopped by an error";
    await log.add({ text: `Live combat stopped: ${error.message}`, kind: "error" });
    ui.notifications.error(`Lore Smith live combat stopped: ${error.message}`);
  } finally {
    await log.complete();
  }
}

function lsActivateJournalWikiLinks(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(".ls-journal-wiki-link, [contenteditable='true'], script, style, textarea")) {
        return NodeFilter.FILTER_REJECT;
      }
      return /\[\[[^\]\n]{1,100}\]\]/.test(node.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/\[\[([^\]\n]{1,100})\]\]/g)) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const name = match[1].trim();
      const link = document.createElement("a");
      link.className = "ls-journal-wiki-link";
      link.dataset.pageName = name;
      link.href = "#";
      link.tabIndex = 0;
      link.title = `Open or create page "${name}" in this Journal`;
      link.textContent = name;
      fragment.append(link);
      cursor = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

const LS_JOURNAL_WIKI_PATTERN = /\[\[([^\]\n]{1,100})\]\]/g;
const lsJournalWikiHighlightRanges = new Map();

function lsRefreshJournalWikiHighlights() {
  if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== "function") return;
  const links = [];
  const brackets = [];
  const active = [];
  for (const [host, hostRanges] of lsJournalWikiHighlightRanges) {
    if (!host.isConnected) {
      lsJournalWikiHighlightRanges.delete(host);
      continue;
    }
    links.push(...hostRanges.links);
    brackets.push(...hostRanges.brackets);
    active.push(...hostRanges.active);
  }

  for (const [name, ranges] of [
    ["lore-smith-wiki-links", links],
    ["lore-smith-wiki-brackets", brackets],
    ["lore-smith-wiki-active", active],
  ]) {
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
  }
}

function lsCollectJournalWikiRanges(root) {
  const ranges = { links: [], brackets: [], active: [] };
  const selection = document.getSelection();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest("script, style, textarea")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.includes("[[") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    for (const match of textNode.nodeValue.matchAll(LS_JOURNAL_WIKI_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      const link = document.createRange();
      link.setStart(textNode, start + 2);
      link.setEnd(textNode, end - 2);
      ranges.links.push(link);
      const isActive = selection?.anchorNode === textNode
        && selection.anchorOffset >= start
        && selection.anchorOffset <= end;
      if (isActive) {
        const full = document.createRange();
        full.setStart(textNode, start);
        full.setEnd(textNode, end);
        ranges.active.push(full);
      } else {
        const open = document.createRange();
        open.setStart(textNode, start);
        open.setEnd(textNode, start + 2);
        const close = document.createRange();
        close.setStart(textNode, end - 2);
        close.setEnd(textNode, end);
        ranges.brackets.push(open, close);
      }
    }
  }
  return ranges;
}

function lsJournalWikiMatchAt(root, node, offset) {
  if (!node || !root.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = element?.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th") ?? root;
  if (block !== root && !root.contains(block)) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(node, offset);
  } catch (_error) {
    return null;
  }
  const cursor = before.toString().length;
  const text = block.textContent ?? "";
  for (const match of text.matchAll(LS_JOURNAL_WIKI_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (cursor >= start && cursor <= end) return { name: match[1].trim(), start, end };
  }
  return null;
}

function lsJournalWikiMatchFromPointer(root, event) {
  const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position) return lsJournalWikiMatchAt(root, position.offsetNode, position.offset);
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  return range ? lsJournalWikiMatchAt(root, range.startContainer, range.startOffset) : null;
}

function lsJournalWikiMatchFromSelection(root) {
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  return lsJournalWikiMatchAt(root, selection.anchorNode, selection.anchorOffset);
}

function lsJournalWikiDraftFromSelection(root) {
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = element?.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th") ?? root;
  if (block !== root && !root.contains(block)) return null;
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(node, selection.anchorOffset);
  } catch (_error) {
    return null;
  }
  const cursor = before.toString().length;
  const text = block.textContent ?? "";
  const open = text.slice(0, cursor).lastIndexOf("[[");
  if (open < 0) return null;
  const tail = text.slice(open, cursor);
  const match = tail.match(/^\[\[([^\]\n]{0,100})$/);
  if (!match) return null;
  return {
    query: match[1],
    hasClosing: text.slice(cursor, cursor + 2) === "]]",
    range: selection.getRangeAt(0).cloneRange(),
  };
}

function lsInsertJournalWikiCompletion(draft, name) {
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !draft || !name) return false;
  for (let index = 0; index < draft.query.length; index += 1) {
    selection.modify?.("extend", "backward", "character");
  }
  document.execCommand("insertText", false, `${name}${draft.hasClosing ? "" : "]]"}`);
  if (draft.hasClosing) {
    selection.modify?.("move", "forward", "character");
    selection.modify?.("move", "forward", "character");
  }
  return true;
}

async function lsEnsureJournalPage(journalSheet, pageName, { notify = true } = {}) {
  const journal = journalSheet?.document;
  const name = pageName?.trim();
  if (!journal || !name) return null;

  let page = journal.pages.find((candidate) =>
    candidate.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
  if (page) return page;
  [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
    name,
    type: "text",
    text: { content: "" },
    sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
  }]);
  if (notify) ui.notifications.info(`Created page "${name}" inside ${journal.name}.`);
  return page;
}

async function lsOpenOrCreateJournalPage(journalSheet, pageName, { currentPage = null, proseMirror = null } = {}) {
  const journal = journalSheet?.document;
  const name = pageName?.trim();
  if (!journal || !name) return;

  const currentContent = proseMirror?._getValue?.();
  if (currentPage && typeof currentContent === "string" && currentContent !== currentPage.text?.content) {
    await currentPage.update({ "text.content": currentContent });
  }

  const page = await lsEnsureJournalPage(journalSheet, name);
  if (!page) return;
  await journalSheet.render(true);
  if (typeof journalSheet.goToPage === "function") await journalSheet.goToPage(page.id);
  else {
    const pageControl = journalSheet.element?.querySelector(`[data-page-id="${page.id}"]`);
    pageControl?.click();
    pageControl?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function lsEnableJournalWikiLinksInEditor(journalSheet, page, proseMirror, host, {
  persistOnChoose = true,
  interactiveLinks = true,
} = {}) {
  const popup = document.createElement("div");
  popup.className = "ls-journal-link-autocomplete";
  popup.hidden = true;
  popup.setAttribute("role", "listbox");
  document.body.append(popup);
  let suggestions = [];
  let selectedIndex = 0;

  const hideAutocomplete = () => {
    popup.hidden = true;
    popup.replaceChildren();
    suggestions = [];
    selectedIndex = 0;
  };

  const chooseSuggestion = async (suggestion = suggestions[selectedIndex]) => {
    const draft = lsJournalWikiDraftFromSelection(proseMirror);
    if (!draft || !suggestion?.name) return;
    const inserted = lsInsertJournalWikiCompletion(draft, suggestion.name);
    hideAutocomplete();
    if (!inserted) return;
    if (persistOnChoose) {
      const currentContent = proseMirror._getValue?.();
      if (typeof currentContent === "string" && currentContent !== page.text?.content) {
        await page.update({ "text.content": currentContent });
      }
    }
    await lsEnsureJournalPage(journalSheet, suggestion.name, { notify: suggestion.create });
  };

  const renderAutocomplete = () => {
    const draft = lsJournalWikiDraftFromSelection(proseMirror);
    if (!draft || !host.isConnected) {
      hideAutocomplete();
      return;
    }
    const query = draft.query.trim();
    const normalized = query.toLocaleLowerCase();
    const pages = journalSheet.document.pages
      .filter((candidate) => candidate.type === "text")
      .map((candidate) => candidate.name)
      .filter((name) => !normalized || name.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => {
        const leftStarts = left.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
        const rightStarts = right.toLocaleLowerCase().startsWith(normalized) ? 0 : 1;
        return leftStarts - rightStarts || left.localeCompare(right);
      })
      .slice(0, 12)
      .map((name) => ({ name, create: false }));
    const exact = pages.some((candidate) => candidate.name.localeCompare(query, undefined, { sensitivity: "accent" }) === 0);
    suggestions = query && !exact ? [{ name: query, create: true }, ...pages].slice(0, 12) : pages;
    if (!suggestions.length) {
      hideAutocomplete();
      return;
    }
    selectedIndex = Math.min(selectedIndex, suggestions.length - 1);
    popup.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "ls-journal-link-autocomplete-heading";
    heading.textContent = query ? `Link pages matching “${query}”` : "Link a page";
    popup.append(heading);
    suggestions.forEach((suggestion, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "ls-journal-link-option";
      option.classList.toggle("selected", index === selectedIndex);
      option.dataset.index = String(index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === selectedIndex));
      option.innerHTML = `<i class="fa-solid ${suggestion.create ? "fa-file-circle-plus" : "fa-file-lines"}"></i><span></span><small>${suggestion.create ? "Create page" : "Journal page"}</small>`;
      option.querySelector("span").textContent = suggestion.name;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectedIndex = index;
        void chooseSuggestion(suggestion);
      });
      popup.append(option);
    });
    const rect = draft.range.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 328);
    const preferredTop = rect.bottom + 8;
    const top = preferredTop + 310 < window.innerHeight ? preferredTop : Math.max(8, rect.top - 310);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.hidden = false;
    popup.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };

  const refresh = () => {
    lsJournalWikiHighlightRanges.set(host, lsCollectJournalWikiRanges(proseMirror));
    lsRefreshJournalWikiHighlights();
    renderAutocomplete();
  };
  const scheduleRefresh = () => queueMicrotask(refresh);

  proseMirror.addEventListener("input", scheduleRefresh);
  proseMirror.addEventListener("mousemove", (event) => {
    if (!interactiveLinks) return;
    const match = lsJournalWikiMatchFromPointer(proseMirror, event);
    proseMirror.classList.toggle("ls-wiki-link-under-pointer", Boolean(match) && !event.ctrlKey && !event.metaKey);
  });
  proseMirror.addEventListener("mouseleave", () => proseMirror.classList.remove("ls-wiki-link-under-pointer"));
  proseMirror.addEventListener("click", (event) => {
    if (!interactiveLinks) return;
    if (event.ctrlKey || event.metaKey) return;
    const match = lsJournalWikiMatchFromPointer(proseMirror, event);
    if (!match?.name) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void lsOpenOrCreateJournalPage(journalSheet, match.name, { currentPage: page, proseMirror });
  }, { capture: true });
  proseMirror.addEventListener("keydown", (event) => {
    if (event.key === "[" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selection = document.getSelection();
      if (selection?.isCollapsed && selection.anchorNode && proseMirror.contains(selection.anchorNode)) {
        const prefix = selection.anchorNode.nodeType === Node.TEXT_NODE
          ? selection.anchorNode.nodeValue.slice(0, selection.anchorOffset)
          : "";
        if (prefix.endsWith("[")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          document.execCommand("insertText", false, "[]]");
          selection.modify?.("move", "backward", "character");
          selection.modify?.("move", "backward", "character");
          scheduleRefresh();
          return;
        }
      }
    }
    if (!popup.hidden && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      selectedIndex = (selectedIndex + direction + suggestions.length) % suggestions.length;
      renderAutocomplete();
      return;
    }
    if (!popup.hidden && ["Enter", "Tab"].includes(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void chooseSuggestion();
      return;
    }
    if (event.key === "Escape" && !popup.hidden) {
      event.preventDefault();
      hideAutocomplete();
      return;
    }
    if (!interactiveLinks || event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const match = lsJournalWikiMatchFromSelection(proseMirror);
    if (!match?.name) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void lsOpenOrCreateJournalPage(journalSheet, match.name, { currentPage: page, proseMirror });
  }, { capture: true });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(proseMirror, { childList: true, subtree: true, characterData: true });
  const selectionListener = () => {
    if (!host.isConnected) return;
    const selection = document.getSelection();
    if (selection?.anchorNode && proseMirror.contains(selection.anchorNode)) refresh();
    else hideAutocomplete();
  };
  document.addEventListener("selectionchange", selectionListener);
  refresh();
  return {
    disconnect() {
      observer.disconnect();
      document.removeEventListener("selectionchange", selectionListener);
      lsJournalWikiHighlightRanges.delete(host);
      lsRefreshJournalWikiHighlights();
      popup.remove();
    },
  };
}

function lsEnhanceJournalPageEditor(pageSheet, html) {
  const page = pageSheet?.document;
  const root = lsRoot(html);
  if (page?.documentName !== "JournalEntryPage" || page.type !== "text" || !root) return;
  const proseMirror = root.querySelector('prose-mirror[name="text.content"]');
  if (!proseMirror || proseMirror.dataset.loreSmithWikiEditor === "ready") return;
  const journalSheet = page.parent?.sheet;
  if (!journalSheet?.document || journalSheet.document.documentName !== "JournalEntry") return;
  proseMirror.dataset.loreSmithWikiEditor = "ready";
  pageSheet._loreSmithWikiController?.disconnect();
  pageSheet._loreSmithWikiController = lsEnableJournalWikiLinksInEditor(journalSheet, page, proseMirror, root, {
    persistOnChoose: false,
    interactiveLinks: false,
  });
}

globalThis.LoreSmithJournalWikiBridge = {
  enableNativeWikiLinks: lsEnableJournalWikiLinksInEditor,
  ensurePage: lsEnsureJournalPage,
};

function lsEnhanceNativeJournal(app, html) {
  const journal = app.document;
  const root = lsRoot(html);
  if (journal?.documentName !== "JournalEntry" || !root) return;
  const singleMode = app.constructor?.VIEW_MODES?.SINGLE;
  if (app.isMultiple && singleMode && !app._loreSmithForcingSingleMode) {
    app._loreSmithForcingSingleMode = true;
    queueMicrotask(async () => {
      try {
        await app.render({ force: true, mode: singleMode, pageId: app.pageId });
      } finally {
        delete app._loreSmithForcingSingleMode;
      }
    });
    return;
  }
  root.classList.add("ls-always-editable-journal");
  const windowShell = root.closest(".window-app, .application") ?? root.parentElement;
  windowShell?.classList.add("ls-lore-journal-window");
  const sidebar = root.querySelector(".journal-sidebar");
  if (sidebar) {
    let brand = sidebar.querySelector(":scope > .ls-journal-brand");
    if (!brand) {
      brand = document.createElement("div");
      brand.className = "ls-journal-brand";
      const search = sidebar.querySelector(":scope > search, :scope > .directory-header");
      sidebar.insertBefore(brand, search ?? sidebar.firstChild);
    }
    brand.innerHTML = '<i class="fa-solid fa-book-open"></i><span><strong></strong><small></small></span>';
    brand.querySelector("strong").textContent = journal.name;
    brand.querySelector("small").textContent = `${journal.pages.size} ${journal.pages.size === 1 ? "note" : "notes"}`;
  }
  const containers = [
    ...root.querySelectorAll(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content"),
  ];
  for (const container of new Set(containers)) lsActivateJournalWikiLinks(container);
  if (root.dataset.loreSmithWikiLinks === "ready") return;
  root.dataset.loreSmithWikiLinks = "ready";
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        if (added.matches(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content")) {
          lsActivateJournalWikiLinks(added);
        }
        for (const container of added.querySelectorAll?.(".journal-page-content, article.journal-entry-page, .journal-entry-page .editor-content") ?? []) {
          lsActivateJournalWikiLinks(container);
        }
      }
    }
  });
  app._loreSmithJournalObserver?.disconnect();
  app._loreSmithJournalObserver = observer;
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("click", async (event) => {
    const edit = event.target.closest?.('[data-action="editPage"], .editor-edit');
    if (edit) {
      const pageElement = edit.closest?.("[data-page-id]");
      const pageId = pageElement?.dataset.pageId ?? app.pageId;
      const page = journal.pages.get(pageId) ?? (journal.pages.size === 1 ? journal.pages.first() : null);
      if (page?.type === "text" && globalThis.LoreSmithJournalEditor?.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        await globalThis.LoreSmithJournalEditor.open(page, app);
        return;
      }
    }
    const link = event.target.closest?.(".ls-journal-wiki-link");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    await lsOpenOrCreateJournalPage(app, link.dataset.pageName);
  }, { capture: true });
}

function lsAddCombatTrackerButtons(_app, html) {
  if (!game.user.isGM || game.system.id !== "pf2e") return;
  const root = lsRoot(html);
  if (!root || root.querySelector(".lore-smith-combat-controls")) return;
  const controls = document.createElement("div");
  controls.className = "lore-smith-combat-controls";
  controls.innerHTML = `
    <button type="button" data-action="lore-smith-logs" data-tooltip="Run randomized combat iterations and show detailed logs"><i class="fa-solid fa-list-ol"></i> Simulate logs</button>
    <button type="button" data-action="lore-smith-live" data-tooltip="Run one live encounter using the current Scene and Combat Tracker"><i class="fa-solid fa-play"></i> Live combat</button>`;
  controls.querySelector('[data-action="lore-smith-logs"]').addEventListener("click", lsRunIterations);
  controls.querySelector('[data-action="lore-smith-live"]').addEventListener("click", lsRunLiveCombat);
  const anchor = root.querySelector(".combat-tracker-header, .directory-header, header");
  (anchor?.parentElement ?? root).insertBefore(controls, anchor?.nextSibling ?? root.firstChild);
}

function lsAddSheetButton(app, html, { kind, icon, title, onClick }) {
  if (!game.user.isGM) return;
  const root = lsRoot(html);
  if (!root) return;
  const header = root.closest(".app")?.querySelector(".window-header") ?? root.querySelector(".window-header");
  if (!header) return;
  const existing = [...header.querySelectorAll(`[data-lore-smith-builder="${kind}"]`)];
  if (existing.length) {
    for (const duplicate of existing.slice(1)) duplicate.remove();
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon lore-smith-sheet-builder";
  button.dataset.loreSmithBuilder = kind;
  button.dataset.tooltip = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<i class="${icon}"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  const close = header.querySelector('[data-action="close"], .close');
  header.insertBefore(button, close ?? null);
}

Hooks.once("init", () => {
  game.settings.register(LS_MODULE_ID, "combatIterations", {
    name: "Combat log iterations",
    hint: "How many randomized combats the Simulate Logs button runs from the Combat Tracker.",
    scope: "world",
    config: true,
    type: Number,
    default: 100,
    range: { min: 1, max: 1000, step: 1 },
  });
  game.settings.register(LS_MODULE_ID, "liveActionDelay", {
    name: "Live combat action delay",
    hint: "Milliseconds between live actions. This can also be changed while the live combat window is open.",
    scope: "world",
    config: true,
    type: Number,
    default: 1750,
    range: { min: 250, max: 10000, step: 250 },
  });
  game.settings.register(LS_MODULE_ID, "mirrorLiveToChat", {
    name: "Copy live combat to Chat",
    hint: "Disabled by default. Enable this only if you also want Lore Smith actions copied to Foundry Chat.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
});

Hooks.on("renderCombatTracker", lsAddCombatTrackerButtons);
Hooks.on("renderCombatTrackerHTML", lsAddCombatTrackerButtons);

Hooks.on("renderActorSheet", (app, html) => {
  const actor = app.actor ?? app.document;
  if (actor?.type !== "npc") return;
  lsAddSheetButton(app, html, {
    kind: "creature",
    icon: "fa-solid fa-dragon",
    title: "Open Lore Smith Creature Builder",
    onClick: () => new LoreSmithCreatureBuilder(actor).render(true),
  });
});

Hooks.on("renderItemSheet", (app, html) => {
  const item = app.item ?? app.document;
  if (!item || item.documentName !== "Item" || !LS_PHYSICAL_ITEM_TYPES.has(item.type)) return;
  lsAddSheetButton(app, html, {
    kind: "item",
    icon: "fa-solid fa-hammer",
    title: "Open Lore Smith Item Builder",
    onClick: () => new LoreSmithItemBuilder(item).render(true),
  });
});

Hooks.on("createItem", (item) => {
  if (!game.user.isGM || !item.actor || !LS_PHYSICAL_ITEM_TYPES.has(item.type) || !item.getFlag(LS_MODULE_ID, "itemBuilder")) return;
  queueMicrotask(() => lsSyncOwnedItemActivations(item).catch((error) => console.error("Lore Smith | Failed to create linked item activations", error)));
});

Hooks.on("updateItem", (item) => {
  if (!game.user.isGM || !item.actor || !LS_PHYSICAL_ITEM_TYPES.has(item.type) || !item.getFlag(LS_MODULE_ID, "itemBuilder")) return;
  queueMicrotask(() => lsSyncOwnedItemActivations(item).catch((error) => console.error("Lore Smith | Failed to update linked item activations", error)));
});

Hooks.on("deleteItem", (item) => {
  const actor = item.actor;
  if (!game.user.isGM || !actor || !LS_PHYSICAL_ITEM_TYPES.has(item.type)) return;
  const linkedIds = actor.items.filter((candidate) => candidate.type === "action" && candidate.getFlag(LS_MODULE_ID, "itemActivation")?.sourceItemId === item.id).map((candidate) => candidate.id);
  if (linkedIds.length) queueMicrotask(() => actor.deleteEmbeddedDocuments("Item", linkedIds).catch((error) => console.error("Lore Smith | Failed to remove linked item activations", error)));
});

Hooks.on("preUpdateItem", (item, changed, options) => {
  const link = lsCreatureDamageLink(item);
  if (!game.user.isGM || !item.actor || !link?.autoScale || options?.loreSmithAutoScale) return;
  const paths = Object.keys(foundry.utils.flattenObject(changed));
  const changesGeneratedValue = link.kind === "strike"
    ? paths.some((path) => path === "system.bonus.value" || path.startsWith("system.damageRolls."))
    : paths.includes("system.description.value");
  if (!changesGeneratedValue) return;
  foundry.utils.setProperty(changed, `flags.${LS_MODULE_ID}.creatureDamageLink.autoScale`, false);
  queueMicrotask(() => ui.notifications.info(`${item.name} was changed manually, so its level scaling is now Custom. You can relink it from the Creature Builder.`));
});

Hooks.on("updateActor", (actor, changed) => {
  if (!game.user.isGM || actor.type !== "npc") return;
  const flattened = foundry.utils.flattenObject(changed);
  if (!("system.details.level.value" in flattened)) return;
  const level = Math.max(-1, Math.min(24, lsNumber(flattened["system.details.level.value"], lsNumber(actor.system.details?.level, 0))));
  queueMicrotask(() => lsRecalculateLinkedCreatureEntries(actor, level).catch((error) => console.error("Lore Smith | Failed to rescale linked creature entries", error)));
});

Hooks.on("renderJournalSheet", (app, html) => {
  lsEnhanceNativeJournal(app, html);
});
Hooks.on("renderJournalPageSheet", (app, html) => lsEnhanceJournalPageEditor(app, html));
Hooks.on("renderJournalEntryPageSheet", (app, html) => lsEnhanceJournalPageEditor(app, html));
const lsCloseJournalPageEditor = (app) => {
  app._loreSmithWikiController?.disconnect();
  delete app._loreSmithWikiController;
};
Hooks.on("closeJournalPageSheet", lsCloseJournalPageEditor);
Hooks.on("closeJournalEntryPageSheet", lsCloseJournalPageEditor);

Hooks.on("closeJournalSheet", (app) => {
  app._loreSmithJournalObserver?.disconnect();
  delete app._loreSmithJournalObserver;
  lsRefreshJournalWikiHighlights();
});

Hooks.on("renderApplicationV2", (app, html) => {
  const document = app.document ?? app.object ?? app.actor ?? app.item;
  if (document?.documentName === "Actor" && document.type === "npc") {
    lsAddSheetButton(app, html, {
      kind: "creature",
      icon: "fa-solid fa-dragon",
      title: "Open Lore Smith Creature Builder",
      onClick: () => new LoreSmithCreatureBuilder(document).render(true),
    });
  } else if (document?.documentName === "Item" && LS_PHYSICAL_ITEM_TYPES.has(document.type)) {
    lsAddSheetButton(app, html, {
      kind: "item",
      icon: "fa-solid fa-hammer",
      title: "Open Lore Smith Item Builder",
      onClick: () => new LoreSmithItemBuilder(document).render(true),
    });
  } else if (document?.documentName === "JournalEntry") {
    lsEnhanceNativeJournal(app, html);
  } else if (document?.documentName === "JournalEntryPage") {
    lsEnhanceJournalPageEditor(app, html);
  }
  if (/CombatTracker/i.test(app.constructor?.name ?? "")) lsAddCombatTrackerButtons(app, html);
});

Hooks.on("closeApplicationV2", (app) => {
  lsCloseJournalPageEditor(app);
});

Hooks.once("ready", async () => {
  if (game.system.id !== "pf2e") return;
  Object.assign(game.loreSmith ??= {}, {
    openCreatureBuilder: (actor) => new LoreSmithCreatureBuilder(actor).render(true),
    openItemBuilder: (item) => new LoreSmithItemBuilder(item).render(true),
    runCombatLogs: lsRunIterations,
    runLiveCombat: lsRunLiveCombat,
  });
  if (game.user.isGM) {
    const existingBuilderItems = game.actors.contents.flatMap((actor) => actor.items.filter((item) => LS_PHYSICAL_ITEM_TYPES.has(item.type) && item.getFlag(LS_MODULE_ID, "itemBuilder")));
    const results = await Promise.allSettled(existingBuilderItems.map((item) => lsSyncOwnedItemActivations(item)));
    for (const failure of results.filter((result) => result.status === "rejected")) console.error("Lore Smith | Failed to migrate an existing item activation", failure.reason);
  }
});
