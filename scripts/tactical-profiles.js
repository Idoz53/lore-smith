const PROFILE_DATA = {
  alchemist: {
    roles: ["support", "controller", "damage"],
    prefer: ["bomb", "elixir", "mutagen", "quick alchemy", "alchemical"],
    conserve: 1.15,
  },
  animist: {
    roles: ["caster", "support", "controller"],
    prefer: ["apparition", "vessel", "focus", "sustain", "spell"],
    conserve: 1.1,
  },
  barbarian: {
    roles: ["damage", "frontline"],
    prefer: ["rage", "strike", "athletics", "trip", "grapple"],
    avoid: ["concentrate"],
  },
  bard: {
    roles: ["support", "controller", "caster"],
    prefer: ["composition", "courage", "dirge", "lingering", "spell"],
    sustain: true,
  },
  champion: {
    roles: ["defender", "support", "frontline"],
    prefer: ["champion's reaction", "lay on hands", "shield", "aura", "strike"],
    protectAllies: true,
  },
  cleric: {
    roles: ["healer", "support", "caster"],
    prefer: ["heal", "font", "divine", "spell"],
    healingThreshold: 0.78,
  },
  commander: {
    roles: ["support", "controller", "frontline"],
    prefer: ["tactic", "command", "banner", "drill", "strike"],
  },
  druid: {
    roles: ["caster", "controller", "support"],
    prefer: ["order", "wildshape", "animal", "primal", "spell"],
    conserve: 1.08,
  },
  exemplar: {
    roles: ["damage", "frontline", "support"],
    prefer: ["ikon", "immanence", "transcendence", "strike"],
  },
  fighter: {
    roles: ["damage", "frontline", "controller"],
    prefer: ["strike", "press", "flourish", "reactive strike", "athletics"],
  },
  guardian: {
    roles: ["defender", "frontline", "controller"],
    prefer: ["taunt", "intercept", "shield", "hampering", "strike"],
    protectAllies: true,
  },
  gunslinger: {
    roles: ["damage", "ranged"],
    prefer: ["reload", "shot", "pistol", "rifle", "strike"],
  },
  inventor: {
    roles: ["damage", "controller", "support"],
    prefer: ["overdrive", "unstable", "innovation", "explode", "strike"],
  },
  investigator: {
    roles: ["damage", "support", "controller"],
    prefer: ["devise a stratagem", "pursue a lead", "strategic strike", "recall knowledge"],
  },
  kineticist: {
    roles: ["controller", "damage", "support"],
    prefer: ["impulse", "channel elements", "overflow", "stance"],
    conserve: 0.7,
  },
  magus: {
    roles: ["damage", "caster", "frontline"],
    prefer: ["spellstrike", "recharge spellstrike", "arcane cascade", "strike"],
    conserve: 1.05,
  },
  monk: {
    roles: ["frontline", "controller", "damage"],
    prefer: ["flurry of blows", "stance", "ki", "trip", "grapple", "strike"],
  },
  necromancer: {
    roles: ["caster", "controller", "support"],
    prefer: ["thrall", "grave", "necromancy", "spell"],
    conserve: 1.08,
  },
  oracle: {
    roles: ["caster", "support", "controller"],
    prefer: ["cursebound", "revelation", "mystery", "spell", "heal"],
    conserve: 1.08,
  },
  psychic: {
    roles: ["caster", "damage", "controller"],
    prefer: ["unleash psyche", "amped", "psi", "cantrip", "spell"],
    conserve: 1.02,
  },
  ranger: {
    roles: ["damage", "ranged", "controller"],
    prefer: ["hunt prey", "hunter's edge", "twin takedown", "hunted shot", "strike"],
  },
  rogue: {
    roles: ["damage", "controller", "skill"],
    prefer: ["sneak attack", "off-guard", "feint", "tumble", "strike"],
    seeksOffGuard: true,
  },
  runesmith: {
    roles: ["controller", "support", "damage"],
    prefer: ["trace rune", "invoke rune", "rune", "strike"],
  },
  sorcerer: {
    roles: ["caster", "damage", "support"],
    prefer: ["blood magic", "bloodline", "focus", "spell"],
    conserve: 1.08,
  },
  summoner: {
    roles: ["frontline", "caster", "support"],
    prefer: ["act together", "tandem", "eidolon", "boost eidolon", "spell"],
    sharedActions: true,
  },
  swashbuckler: {
    roles: ["damage", "skill", "frontline"],
    prefer: ["panache", "finisher", "tumble through", "confident finisher", "strike"],
    seeksPanache: true,
  },
  thaumaturge: {
    roles: ["damage", "support", "controller"],
    prefer: ["exploit vulnerability", "implement", "intensify", "strike"],
  },
  witch: {
    roles: ["caster", "controller", "support"],
    prefer: ["hex", "familiar", "sustain", "spell"],
    conserve: 1.08,
  },
  wizard: {
    roles: ["caster", "controller", "damage"],
    prefer: ["curriculum", "drain bonded item", "spellshape", "spell"],
    conserve: 1.12,
  },
};

const DEFAULT_PROFILE = {
  slug: "independent",
  label: "Independent combatant",
  roles: ["damage", "survival"],
  prefer: ["strike", "spell", "ability"],
  avoid: [],
  conserve: 1,
  healingThreshold: 0.6,
};

function slugify(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function classItem(actor) {
  return actor?.items?.find?.((item) => item.type === "class") ?? null;
}

export function getTacticalProfile(actor) {
  const item = classItem(actor);
  const classSlug = slugify(item?.slug ?? item?.system?.slug ?? item?.name ?? "");
  const source = PROFILE_DATA[classSlug];
  if (!source) return { ...DEFAULT_PROFILE, classItem: item, classSlug: classSlug || null };
  return {
    ...DEFAULT_PROFILE,
    ...source,
    slug: classSlug,
    label: item?.name ?? classSlug,
    classItem: item,
    classSlug,
  };
}

function optionText(option) {
  return [
    option.name,
    option.kind,
    ...(option.traits ?? []),
    option.description,
  ].join(" ").toLowerCase();
}

export function tacticalOptionScore(profile, option, context = {}) {
  const text = optionText(option);
  let score = 0;
  for (const keyword of profile.prefer ?? []) {
    if (text.includes(keyword)) score += 2.75;
  }
  for (const keyword of profile.avoid ?? []) {
    if (text.includes(keyword)) score -= 4;
  }

  if (profile.roles.includes("healer") && option.healing) score += 8;
  if (profile.roles.includes("support") && (option.defensive || option.utility)) score += 3;
  if (profile.roles.includes("controller") && option.conditions?.length) score += 4;
  if (profile.roles.includes("damage") && option.damage) score += 2;
  if (profile.roles.includes("ranged") && option.range > 5) score += 2;
  if (profile.roles.includes("frontline") && option.kind === "strike" && option.range <= 10) score += 1.5;

  const remainingRatio = context.remainingUses === null || context.remainingUses === undefined
    ? null
    : context.remainingUses / Math.max(1, option.limitedUses ?? context.remainingUses);
  if (remainingRatio !== null && context.round <= 2 && remainingRatio <= 0.5) {
    score -= 3 * (profile.conserve ?? 1);
  }

  if (profile.seeksOffGuard && context.target?.conditions?.has?.("off-guard")) score += option.damage ? 5 : 0;
  if (profile.seeksPanache) {
    const hasPanache = context.actor?.conditions?.has?.("panache");
    if (!hasPanache && /tumble|bon mot|feint|demoralize/.test(text)) score += 9;
    if (hasPanache && /finisher/.test(text)) score += 11;
    if (hasPanache && /tumble through/.test(text)) score -= 8;
  }
  return score;
}

export function tacticalProfilesSummary() {
  return Object.entries(PROFILE_DATA).map(([slug, profile]) => ({
    slug,
    label: slug.replace(/(^|-)(\w)/g, (_match, _dash, letter) => ` ${letter.toUpperCase()}`).trim(),
    roles: profile.roles,
  }));
}
