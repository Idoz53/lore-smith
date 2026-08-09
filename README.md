# Lore Smith

Lore Smith is a prototype Game Master workspace for Foundry VTT 13 and the
Pathfinder Second Edition system.

The module provides:

- a six-step Session Prep dashboard that turns a session goal, two or more
  image-backed locations, sensory descriptions, structured people and factions,
  dropped hazards and encounter actors, scenes, clues, rewards, consequences, and GM
  reminders into one linked, editable Foundry Journal, with an automatically
  saved draft that survives navigation and reopening the dashboard;
- image-backed NPC prep cards with roles, motivations, and secrets, generated as
  linked portrait pages inside the finished session Journal;
- a dedicated music-and-atmosphere prep step with reusable cues, specific song
  selection inside a Foundry Playlist, direct audio files, mood, timing, and playback notes; audio cues are
  added as native Playlist tracks, with a session Playlist created automatically
  when one is not available; generated Journal controls play only the selected song;
- a role-aware Loot & Treasure Generator for DPS, tank, healer, and battlefield-control
  characters, with minimum/maximum item levels, family-level duplicate removal, strict
  mechanical role matching, installed PF2e permanent/consumable treasure RollTables,
  gem and art-object tables, and direct links back to native compendium items;
- a responsive, wiki-style Journal workspace with a compact native page tree,
  clean rendered notes, and Foundry's visual rich-text editor integrated into
  a focused writing window;
- compendium-backed guided creature and item builders embedded in native PF2e sheets;
- a seven-step creature builder with editable GM Core attribute, perception,
  defense, save, and skill benchmarks; native searchable creature traits;
  land, fly, swim, climb, and burrow Speeds; special senses; separate native
  spellcasting; and scroll position preserved while filtering or editing;
- modular creature entries separated into native PF2e Attacks,
  Actions/Reactions, and Passives, including self, single-target, area, and
  utility targeting modes;
- a six-step, type-aware item workshop for native weapons, armor, shields,
  consumables, ammunition, equipment, and other PF2e item documents;
- any number of named item activations rendered as native PF2e stat blocks with
  exact action glyphs, traits, frequency, trigger, requirements, effect, targeting,
  range, area, duration, inline damage/healing/check controls, and separators;
- owned item activations are synchronized to native PF2e Action documents, so
  they appear in the actor's Actions tab with their action cost and frequency;
- existing compendium automation, runes, subitems, and native rules are preserved
  when an item is copied and customized;
- encounter setup using actors and tokens already in the Foundry world;
- Combat Tracker buttons for randomized iteration logs and live Scene combat;
- spell-, ability-, item-, strike-, save-, condition-, and area-template-aware combat choices;
- detailed iteration logs and a separate isolated live-combat battlefield window;
- pause, resume, stop, adjustable pacing, and a previous/next action timeline
  that reviews logged actions together with their token positions and Hit Points,
  without Chat spam by default;
- Live Combat operates on cloned token positions, HP, conditions, cooldowns,
  item quantities, frequencies, and spell resources. It never moves Scene tokens,
  changes actor HP or conditions, consumes inventory or spell slots, advances the
  Combat Tracker, places real templates, leaves changed targets, or moves the GM camera;
- the isolated popup displays the Scene background, animated combatant copies,
  HP bars, conditions, area templates, action captions, and the complete log;
- the isolated replay opens at the available screen size, preserves the Scene's
  true aspect ratio and pixel coordinates, snaps combatant copies to Foundry's
  grid, supports wheel zoom and drag panning, and displays the real Scene walls;
- replay pathfinding uses Foundry's native wall collision for movement and
  requires an unobstructed sight line before resolving a targeted action;
- the replay window is freely resizable while keeping one uniform map/grid
  scale, and Strides visibly traverse every collision-checked grid square in
  their selected route instead of teleporting to the final destination;
- PF2e damage-card results are captured from the native ChatMessage roll or its
  rendered dice total, so a visible result is applied instead of being falsely
  reported as a missing roll;
- native PF2e spellcasting-entry casts for prepared, flexible, spontaneous,
  innate, focus, at-will, and cantrip spells, using the same slot and use
  validation as the PF2e Cast control;
- native PF2e spell override variants, so variable-action spells use the
  system-defined action cost, target, range, area, and damage or healing data;
- browse-all compendium source libraries with keyword, level, trait, and type filters;
- an optional Bestiary Ability Glossary-only filter for creature abilities;
- creature ability search also indexes actions, reactions, free actions, passive
  abilities, strikes, and spells embedded in every installed PF2e NPC Actor
  compendium. Results show their source creature and exact name matches are
  ranked first;
- selecting a creature ability search result opens a rules preview beside the
  list, including its enriched PF2e description, traits, action cost, source
  pack, and source creature before it is added;
- GM Core level benchmark menus for creature statistics;
- native Foundry Journal documents, page permissions, sharing, Show Players,
  images, tables, document links, and rendered read view; no Obsidian install,
  web service, browser extension, or other application is required;
- the Journal edit button opens a normal visual editor built on Foundry's own
  ProseMirror foundation. Formatting is displayed while writing; users never
  have to edit Markdown or use an IDE-like interface;
- editor wiki links are first-class: typing
  `[[` supplies the closing brackets and opens searchable page autocomplete;
  use the mouse wheel, arrow keys, Enter, or Tab to choose a page. After saving,
  completed links display as clean blue note names and open or create pages in
  the same Journal when clicked;
- side-by-side creature and item source previews before copying a compendium entry.
- PF2e XP difficulty with in-between labels such as Moderate+ and Severe-, shown
  separately from the randomized character victory estimate.
- PF2e-native live targeting and controls for Combat Tracker initiative,
  prepared strikes, spell Cast/Attack/Damage buttons, actor saving throws,
  system skill actions, healing, conditions, shield state, and finite resources;
- live combat never silently substitutes a reconstructed formula when PF2e has
  no executable control: the action is reported as unsupported instead;
- live measured-template hit testing against the grid spaces actually occupied by
  each token, plus GM-private Foundry roll cards for initiative, checks, saves,
  damage, and healing;
- automatic native PF2e roll execution uses the GM-private, skip-dialog behavior,
  so checks, saves, damage, and healing resolve without stopping for modifier dialogs;
- isolated spell resolution now creates the native PF2e Cast chat card without
  consuming the real slot, presses its Attack, Save, and Roll Damage buttons,
  restores the GM's previous targets, and applies the result only to simulated HP;
- melee entries reported by PF2e as zero range use their legal 5-foot grid reach,
  so an actor already in range does not waste actions Striding;
- flanking is recalculated from the centers of two adjacent allies on opposite
  sides of a target; the simulated target becomes off-guard and the log names
  the two flankers and shows the adjusted AC beside its base AC;
- prone actors Stand before moving, restrained or immobilized actors use native
  GM-private Escape checks, fleeing actors move away, and slowed, stunned,
  unconscious, paralyzed, and petrified states constrain their action economy;
- cryptographically seeded tactical tie-breaking and randomized equal-cost path
  choices keep repeated combats and Monte Carlo iterations from replaying one script;
- live grid movement uses occupied-square pathfinding, respects walls and token
  footprints, accepts legal progress when a target is farther than one Stride,
  keeps melee combatants from walking closer when already in reach, and prevents
  two tokens from ending in the same space;
- explicit adapters for attacks, saves, damage, healing, IWR, conditions, area
  templates, spell slots, frequencies, recharge timers, and common skill actions;
- the complete old-app tactical flowchart library: one shared legality,
  rescue, targeting, movement, cover, off-guard, trained-skill, MAP, defense,
  and resolution loop plus data-driven overlays for all 29 PF2e classes;
- class overlays are selected from the actor's actual Class item and score only
  actions, spells, strikes, items, and trained system actions the actor owns;
- unclassed NPCs infer frontline, ranged, or spellcaster positioning from their
  own native entries; class and NPC profiles seek safe range or legal flanks and
  deliberately avoid repeating utility actions instead of dealing damage;
- both Monte Carlo and live combat use the same decision policy. The fast model
  resolves it through explicit adapters, while live combat executes the chosen
  option through native PF2e targets, checks, Cast controls, resources, effects,
  damage, healing, conditions, and measured templates;
- a per-encounter coverage report that identifies native, modeled, partial, and
  unsupported actions for every combatant.
- schema-driven effect ownership and linked condition operations: self effects
  stay on the user, explicit removals remove conditions, and a condition word in
  descriptive, prerequisite, or future-effect text is never applied by itself.

## Prototype warning

Lore Smith is experimental. Encounter estimates and tactical choices can contain
bugs or strange behavior and are not a substitute for a GM's rules judgment.

## Installation

Use the manifest URL:

`https://raw.githubusercontent.com/Idoz53/lore-smith/main/module.json`

Enable Lore Smith in a world using the PF2e system. A new Lore Smith button is
added to the Scene controls for GMs.

The Creature Builder icon appears in the title bar of native PF2e NPC sheets.
Its guided workflow includes the seven GM Core base road maps, a dedicated
concept-and-role step, editable level-scaled suggestions, and a persistent
balance assistant. The assistant checks push-and-pull, extreme-stat density,
size guidance, durability combinations, and displays all eleven Building
Creatures tables for the actor's current level (levels -1 through 24).
Its offense workshop creates native PF2e Strikes and abilities from independent
modules: attack benchmark, primary and secondary damage, range, traits, action
cost, frequency, target or area, save/DC, conditions, requirements, trigger,
duration, and effect text. Benchmark-linked attack bonuses, Strike damage,
area damage, and save DCs recalculate automatically when the NPC's level changes;
custom values remain untouched. Manual edits to generated numbers safely change
that entry to Custom until the GM explicitly relinks it.
The Item Builder icon appears in native PF2e Item sheets. The Combat Tracker
adds **Simulate Logs** and **Live Combat** controls when an encounter is active.
Use the slider in the Live Combat window to change the delay from 0.25 to 10
seconds per action, or pause, resume, and stop the replay. Chat mirroring is
optional in Module Settings and is off by default.

Selecting **Live Combat** opens a separate Lore Smith window immediately. It
shows preparation errors as well as the complete action log, so failed setup is
visible instead of silently stopping.

Both simulation modes include a collapsible **Simulation coverage** report.
Review partial and unsupported entries before treating an encounter estimate as
reliable; the report is deliberately explicit about mechanics that still need a
dedicated adapter. Each actor also reports its assigned class flow, positioning
policy, available class-priority tags, and class priorities for which the actor
does not currently own a matching Foundry action.

The **Live Combat** mode drives the installed PF2e system as a GM would: it sets
the actual Foundry target, invokes native action/statistic/cast controls, consumes
the actor's real resources, and applies the resulting native damage or healing
roll. All native roll cards created by the simulator are private to GMs. The
multi-iteration estimate remains a non-destructive model so it can run many
encounters without consuming or damaging the world actors.

Lore Smith does not maintain exceptions for named actors, NPCs, spells, or
abilities. It reads the mechanics declared by each installed PF2e document. An
entry without a safe structured resolution path is excluded from tactical
selection and identified by the coverage report rather than guessed from prose.

## Content and licensing

Lore Smith reads actors, items, spells, journals, scenes, tokens, walls, and
compendia from the installed PF2e system. It does not bundle paid Paizo content.
See `LICENSE.txt`.
