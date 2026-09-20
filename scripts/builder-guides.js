/**
 * Short, original GM checklists informed by Pathfinder Remaster guidance.
 * Links were read on Archives of Nethys on 2026-09-20. These are design aids,
 * not a rules certification or a promise of Foundry automation.
 * This module is pure and never fetches content at runtime.
 */
const source = (label, id) => ({ label, url: `https://2e.aonprd.com/Rules.aspx?ID=${id}` });

const SOURCES = {
  items: source("GM Core: Building Items", 2923),
  comparison: source("GM Core: Compare Similar Items", 2926),
  itemLevel: source("GM Core: Item Level", 2925),
  bonuses: source("GM Core: Permanent Item Bonuses", 2932),
  constant: source("GM Core: Designing Constant Abilities", 2929),
  activationActions: source("GM Core: Activation Action Costs", 2930),
  activation: source("GM Core: Activating Items", 3139),
  usage: source("GM Core: Held, Worn, Affixed, or Etched", 3151),
  investment: source("GM Core: Investing Magic Items", 3138),
  runes: source("GM Core: Runes", 3162),
  materials: source("GM Core: Materials and Grades", 3188),
  equipment: source("GM Core: Designing Armor and Weapons", 2936),
  prices: source("GM Core: Permanent Item Price Ranges", 2950),
  consumables: source("GM Core: Consumable Price Ranges", 2951),
  itemDC: source("GM Core: Magic Item DCs", 2949),
  creatures: source("GM Core: Building Creatures", 2874),
  concept: source("GM Core: Develop the Creature Concept", 2875),
  statistics: source("GM Core: Understanding Statistics", 2876),
  traits: source("GM Core: Creature Size and Traits", 2880),
  perception: source("GM Core: Creature Perception", 2882),
  defenses: source("GM Core: Creature Defenses", 2888),
  strikes: source("GM Core: Strike Damage", 2897),
  actionEconomy: source("GM Core: Creature Action Economy", 2905),
  damageAbilities: source("GM Core: Damage-Dealing Abilities", 2910),
  saves: source("Player Core: Basic Saving Throws", 2247),
  spells: source("GM Core: Creature Spellcasting", 2898),
  review: source("GM Core: Review the Whole Creature", 2917),
};

const GUIDES = {
  item: {
    source: {
      title: "Start with a useful comparison",
      summary: "Decide what this reward lets a character do, then find a published item with a similar purpose and level.",
      checkpoints: [
        "Compare how often the benefit works, how many actions it needs, and who can use it. Similar names or themes do not guarantee similar power.",
        "A consumable buys one moment of usefulness. A permanent item can affect many adventures; compare it with other permanent items.",
        "Keep an existing item's restrictions unless you deliberately account for the extra power from removing them.",
      ],
      example: "For boots that help cross a chasm, compare existing movement items before deciding whether they grant a brief leap, flight, or a constant benefit.",
      sources: [SOURCES.comparison, SOURCES.itemLevel, SOURCES.items],
    },
    basics: {
      title: "Explain who can use it",
      summary: "Name the item and set its level, traits, usage, Bulk, and price so a player can tell how it fits their character.",
      checkpoints: [
        "Usage says how the item must be carried or worn: held in one or two hands, worn, affixed, or etched. A named worn slot, such as cloak, limits overlapping items of that type.",
        "The invested trait requires investment before magical benefits or activations work. Most magical worn items use it; ordinary gear does not. PCs normally have a daily limit of 10 invested items.",
        "Item level describes appropriate power, not a minimum level to use the item. Consider the party's level and other rewards when choosing it.",
        "Make the description identify the constant benefit separately from anything that requires activation.",
      ],
      example: "A magical cloak can be worn and invested, yet its temporary protection may still require an activation.",
      sources: [SOURCES.usage, SOURCES.investment, SOURCES.itemLevel],
    },
    mechanics: {
      title: "Build the physical item first",
      summary: "Set the base weapon, armor, shield, or consumable statistics before adding its special ability.",
      checkpoints: [
        "Use native rune choices for rune benefits. Adding the same bonus again as a custom effect can double-count it or create confusing stacking.",
        "Potency normally limits the number of property runes on a weapon or armor. Striking and resilient are fundamental runes and do not use those slots. Shields use reinforcing runes.",
        "A rune-built item's level follows its highest-level component. Compare specific magic equipment separately: unique abilities change its value and property-rune options.",
        "Precious materials also need a grade. Low-grade materials support magic up to level 8, standard-grade up to 15, and high-grade any level; check the selected material's entry for available grades and cost.",
        "A permanent bonus must fit its statistic and item level. More frequent or longer temporary bonuses may function like permanent ones in practice.",
      ],
      example: "A silver sword's material, a striking rune's weapon dice, and an activated ward are three different parts of the finished item.",
      sources: [SOURCES.runes, SOURCES.materials, SOURCES.equipment, SOURCES.bonuses],
    },
    activation: {
      title: "Describe one complete use",
      summary: "The player should know when they can activate this ability, what it costs, who it affects, and when it ends.",
      checkpoints: [
        "Choose the action cost and activation traits. Manipulate requires wielding a held item or touching another item with a free hand; invested items must be invested by the user.",
        "A reaction needs a clear trigger. Requirements describe conditions that must already be true; they are different from what the ability does.",
        "Frequency is how often an activation is available. Duration is how long its result lasts. Record targets, range, and any extra cost separately.",
        "When copying a spell's effect, its normal action cost is the safest starting point. Reducing that cost can make the item substantially stronger.",
        "Write down Sustain, Dismiss, or special ending conditions when relevant. A duration alone cannot explain every ongoing effect.",
      ],
      example: "Once per day, spend two actions to protect yourself for one minute. Daily availability and the one-minute effect are separate limits.",
      sources: [SOURCES.activation, SOURCES.activationActions, SOURCES.constant],
    },
    automation: {
      title: "Match the mechanics to the promise",
      summary: "Use the result preview to distinguish a sheet bonus, a temporary effect, a clickable roll, and instructions the GM must resolve.",
      checkpoints: [
        "Constant benefits belong to the equipped or invested item. A temporary bonus or resistance belongs to its activation and needs a recipient and an end time.",
        "Damage, healing, saving throws, and areas can be presented as roll or template controls. A roll button does not mean every consequence is applied to targets.",
        "For conditional, sustained, or narrative effects, state what the GM must track. Check the preview's automation notes before assuming a field creates a timer or enforces a limit.",
        "Check the final bonus type and affected statistic against other equipment. Review permanent-bonus level guidance even when an ability is labelled temporary.",
      ],
      example: "A cloak that grants fire resistance for one minute should show an activated effect. Its wearer should not receive that resistance merely by carrying the cloak.",
      sources: [SOURCES.activation, SOURCES.bonuses, SOURCES.constant],
    },
    review: {
      title: "Read it as the receiving player",
      summary: "Check the finished stat block and the automation notes together. Price ranges support your judgment; they cannot certify a new ability's balance.",
      checkpoints: [
        "For a permanent item, use the upper part of its level's range for a major combat benefit, the middle for substantial support, and the lower part for a narrow use. Compare actual published items too.",
        "Use consumable price guidance for a one-use item. Do not price unlimited healing, flight, or other recurring benefits like a single-use reward.",
        "For a save DC, compare the magic-item DC guidance at this level and the closest published effect. A narrow ability and an automatic aura can require different treatment.",
        "Walk through receiving, equipping, activating, resolving, and ending the effect. If any step is unclear, clarify its text or settings before handing it out.",
        "Try the item on a test character: confirm bonuses appear only when intended, activations show the right rolls, and temporary effects can end correctly.",
      ],
      example: "Ask: If this item appeared as treasure tonight, could its player use it without asking what any field means?",
      sources: [SOURCES.prices, SOURCES.consumables, SOURCES.itemDC, SOURCES.comparison],
    },
  },
  creature: {
    source: {
      title: "Choose a starting creature",
      summary: "A published creature with the right role can provide a useful starting point. Creature statistics are chosen as final level-based values, rather than assembled like a player character.",
      checkpoints: [
        "Compare creatures near your intended level and with a similar combat style. A new appearance often needs fewer mechanical changes than a new role.",
        "When adapting a creature, check its abilities, senses, damage types, and traits together so its new description matches its mechanics.",
        "Level measures combat threat. An expert artisan or negotiator can have exceptional professional skills without becoming an equally powerful combatant.",
      ],
      example: "A cold-themed guardian may reuse a suitable guardian's structure, while replacing its fire abilities and resistances consistently.",
      sources: [SOURCES.creatures, SOURCES.concept],
    },
    concept: {
      title: "Give it a role and a weakness",
      summary: "Choose what players should notice in the encounter, then use a role preset as a starting point for its strengths and weaknesses.",
      checkpoints: [
        "Pick one memorable behavior: hold a doorway, chase isolated targets, protect allies, or cast disruptive spells. Let its abilities support that behavior.",
        "Moderate values cover ordinary capabilities. High values show strengths; low values give players ways to respond. Reserve extreme values for defining specialties.",
        "Consider whether it fights alone or in a group. Several identical creatures should have turns you can run quickly.",
        "Avoid combining extreme accuracy and extreme damage without a serious tradeoff: both advantages improve the same attack.",
      ],
      example: "A slow guardian can be difficult to injure but vulnerable to Will saves; a mobile hunter can be dangerous without also being exceptionally durable.",
      sources: [SOURCES.concept, SOURCES.statistics],
    },
    identity: {
      title: "Make the details support the concept",
      summary: "Size, traits, senses, languages, and skills explain how the creature interacts with the world as well as with the party.",
      checkpoints: [
        "Choose creature-type and relevant rules traits. A trait such as aquatic, mindless, or incorporeal can imply abilities or restrictions; check comparable creatures.",
        "Size does not automatically raise every statistic. Check its actual movement, space, reach, and abilities rather than relying on the label.",
        "Choose senses that fit the fiction. Strong Perception should reflect alertness or a specialty, not just a desire to win initiative.",
        "Give it the languages and skills needed for its role. A creature that ambushes may roll Stealth for initiative when the situation supports it.",
      ],
      example: "An underground scout might need darkvision, climbing, and Stealth; adding those makes its intended behavior clearer than raising every attribute.",
      sources: [SOURCES.traits, SOURCES.perception, SOURCES.creatures],
    },
    defenses: {
      title: "Balance the whole defense",
      summary: "AC, HP, saves, and damage protection work together. A creature should offer the party a useful weakness to discover.",
      checkpoints: [
        "If AC is unusually strong, consider lower HP or a weaker save. High HP can instead support a brute that is easy to hit.",
        "Look at Fortitude, Reflex, and Will as a set. An obvious strong save and weaker save make different player tactics matter.",
        "Include resistance, immunity, regeneration, and defensive reactions when judging durability. Their effect depends on what this party can actually do.",
        "Check a wound separately from maximum HP. Editing a creature's design should not be mistaken for healing it during play.",
      ],
      example: "A guardian with high AC, high HP, strong saves, and broad resistance can take too long to defeat even if every individual number looks plausible.",
      sources: [SOURCES.defenses, SOURCES.statistics],
    },
    content: {
      title: "Build a turn you can actually run",
      summary: "Combine Strikes and a small set of distinctive abilities into a clear plan for the creature's actions.",
      checkpoints: [
        "Judge accuracy and total Strike damage together. Count every damage component; damage from an extra energy die is part of the same Strike's total.",
        "Agile and ranged attacks often need less damage than a main melee attack. A flexible spellcasting creature also spends some of its power outside Strikes.",
        "Area abilities use their own damage guidance, usually assuming two actions. Reduce damage for an easier action cost or a significant additional condition.",
        "A basic save means damage multipliers of 0, one-half, 1, and 2 across the four outcomes. Use explicit outcome text when the ability has its own result structure.",
        "Count movement, setup, and reactions in the plan. Remove abilities that never get used because another option is always better.",
      ],
      example: "Write a sample turn: move into position, then use a two-action cone. Check what the creature does next round if that cone cannot be reused.",
      sources: [SOURCES.strikes, SOURCES.damageAbilities, SOURCES.saves, SOURCES.actionEconomy],
    },
    spells: {
      title: "Give every spell a job",
      summary: "Use spellcasting for abilities that are best expressed as spells. A short thematic selection is easier to run than a long list of competing options.",
      checkpoints: [
        "Choose prepared or spontaneous casting for a dedicated caster; innate spells often suit a creature with a few natural magical abilities.",
        "Use the creature's level and caster role when selecting spell DC and attack benchmarks. Primary casters are stronger at magic than creatures that mainly use Strikes.",
        "Check spell rank, slot or use count, tradition, and casting entry. Cantrips, innate uses, prepared slots, and Focus Points are different resources.",
        "Choose spells it has time to cast. Keep important damaging spells relevant to its level and check incapacitation when judging higher-level targets.",
        "Open the finished sheet and confirm each spell appears under its intended casting entry, especially after copying another spellcaster.",
      ],
      example: "A marsh witch might have a signature control spell, a movement option, and a fallback attack. Each should support a different situation.",
      sources: [SOURCES.spells, SOURCES.actionEconomy],
    },
    review: {
      title: "Check the encounter, not just the numbers",
      summary: "Read the entire stat block, then imagine several turns against your party. Benchmark warnings identify places to inspect; they do not prove an encounter is balanced.",
      checkpoints: [
        "Check whether its strongest abilities reinforce its concept, and whether the party has practical ways to respond.",
        "Try an opening turn, a later turn, and a turn after being slowed. Check movement, action costs, reaction triggers, and limited-use abilities.",
        "Review combinations: strong accuracy plus damage, defensive layers, area damage plus conditions, and spells that combine with allies.",
        "Confirm every save outcome, duration, and exception is readable. Check which consequences need the GM to resolve them.",
        "Try a short test encounter. Adjust after seeing it in play, and consider the rest of the encounter when evaluating difficulty.",
      ],
      example: "A dangerous solo creature can still feel poor in play if it cannot reach the party or if its signature activity consumes every turn without choices.",
      sources: [SOURCES.review, SOURCES.statistics, SOURCES.actionEconomy],
    },
  },
};

const STEPS = {
  item: ["source", "basics", "mechanics", "activation", "automation", "review"],
  creature: ["source", "concept", "identity", "defenses", "content", "spells", "review"],
};

/** Return fresh plain data for Handlebars without requiring Foundry globals. */
export function lsBuilderGuide(kind, step = 0, level = 1) {
  const type = kind === "creature" ? "creature" : "item";
  const aliases = type === "item" ? { identity: "basics", effects: "automation" } : { offense: "content", abilities: "content" };
  const requested = typeof step === "number" ? STEPS[type][step] : aliases[step] ?? step;
  const key = Object.hasOwn(GUIDES[type], requested) ? requested : "source";
  const guide = GUIDES[type][key];
  const numericLevel = Number(level);
  const result = {
    kind: type,
    step: key,
    title: guide.title,
    summary: guide.summary,
    checkpoints: [...guide.checkpoints],
    example: guide.example,
    sources: guide.sources.map((entry) => ({ ...entry })),
    sourceLabel: "Design guidance from Archives of Nethys, plus Lore Smith workflow tips",
    checkedOn: "2026-09-20",
  };
  if (type === "item" && key === "review" && Number.isFinite(numericLevel) && (numericLevel < 1 || numericLevel > 20)) {
    result.checkpoints.unshift("The usual item-price tables cover levels 1–20. For level 0, compare mundane gear; for exceptional high-level rewards, choose values deliberately with the campaign in mind.");
  }
  if (type === "creature" && key === "concept" && Number.isFinite(numericLevel) && numericLevel >= 11) {
    result.checkpoints.push(numericLevel >= 20
      ? "At level 20 and above, several extreme statistics can be appropriate. Their interaction and the creature's weaknesses still matter."
      : numericLevel >= 15
        ? "From roughly level 15, two extreme specialties are common. Review closely linked strengths together."
        : "Around level 11, one extreme specialty becomes typical. Make it serve the creature's role.");
  }
  return result;
}
