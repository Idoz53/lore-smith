# Lore Smith

Lore Smith is a prototype Game Master workspace for Foundry VTT 13 and the
Pathfinder Second Edition system.

The module provides:

- a progressive, act-based Campaign Builder: prepare Act I, call it ready to
  play, record what actually happened, complete it, and unlock Act II without
  having to write the entire campaign in advance; every Act is divided into
  Chapter I (Introduction), Chapter II (Escalation), and Chapter III
  (Resolution), with its planned sessions distributed across those chapters;
  every individual session links directly to the full Session Prep wizard and
  back to the evolving native campaign Journal; locked future Acts remain
  hidden from that Journal until the preceding Act is completed;
- a separate eight-step Campaign Map Builder: upload a real map, mark points of
  interest, draw the party's starting area, and prepare outward by distance;
  the center receives full playable detail, nearby places receive practical
  visit preparation, distant places receive only a light sketch, and places
  beyond the circle remain deliberately unprepared until the campaign expands;
- a Foundry-style regional map viewport that preserves the source image's
  proportions, supports wheel zoom and right-drag panning, draggable and
  nameable points, cancellable placement tools, and a selected-point starting
  area drawn by dragging its radius;
- world-persistent Campaign Map Builder drafts, with immediate saves for map
  edits and automatic recovery of drafts created by earlier versions;
- an independent World Map Builder for tracing territorial polygons over any
  map, reshaping their corners, nesting provinces or wilderness areas inside
  larger realms, and recording geography, travel, people, power, dangers, and
  hooks without disturbing either Campaign Builder draft;
- automatic point-in-region assignment when the World Map Builder uses the same
  source image as the Campaign Map Builder, plus a generated native Foundry
  World Atlas folder, index, and one safely linked Journal per region;
- double-clicking a completed region opens its own native Journal immediately;
  region identity is stable across renames, user-created pages are preserved,
  and edited generated pages are never overwritten silently;
- three-layer World Map recovery: every edit is snapshotted immediately in the
  browser, then serialized to client and shared world settings for resilience
  against Forge reconnects;
- compact map markers with an on-map right-click editor for point type, live
  naming, movement, and deletion—without a separate point-card list below the map;
- regional connections for roads, waterways, mountain passes, trade, conflict,
  and mysteries, followed by an opening situation that points from the starting
  location toward several plausible player-chosen directions;
- a generated native Foundry campaign Journal containing the annotated regional
  map, detailed starting point, nearby locations, distant gazetteer, travel
  connections, opening problem, and a list of points beyond the current focus;
- a six-step Session Prep dashboard that turns a session goal, two or more
  image-backed locations, sensory descriptions, structured people and factions,
  dropped hazards and encounter actors, scenes, clues, rewards, consequences, and GM
  reminders into one linked, editable Foundry Journal, with an automatically
  saved draft that survives navigation and reopening the dashboard;
- image-backed NPC prep cards with roles, motivations, and secrets, generated as
  linked portrait pages inside the finished session Journal;
- a native NPC voice-reference studio available from every PF2e NPC sheet, with
  microphone selection, record, pause, resume, stop, preview-before-upload,
  multiple named samples, a primary voice, playback, downloads, and notes for
  pitch, accent, rhythm, mannerisms, and catchphrases;
- a dedicated music-and-atmosphere prep step with reusable cues, specific song
  selection inside a Foundry Playlist, direct audio files, mood, timing, and playback notes; audio cues are
  added as native Playlist tracks, with a session Playlist created automatically
  when one is not available; generated Journal controls play only the selected song;
- an explainable Loot & Treasure Generator with required, preferred, and excluded mechanical filters,
  rarity controls, minimum/maximum item levels, family-level duplicate removal, native-data and
  optional description-assisted matching, installed PF2e permanent/consumable item compendia,
  gem and art-object tables, and direct links back to native compendium items;
- standard Foundry Journal sheets and page editors, without replacing or
  intercepting Foundry's native Journal interface;
- compendium-backed guided creature and item builders embedded in native PF2e sheets;
- a seven-step creature builder with editable GM Core attribute, perception,
  defense, save, and skill benchmarks; searchable PF2e trait pickers for
  creatures, attacks, actions/reactions, and passives; road-map attributes
  applied as editable starting defaults; an empty skill list with the complete
  PF2e skill catalog available from Add Skill;
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
- Session Prep creates ordinary Foundry Journal documents whose pages use the
  system's normal permissions, sharing, Show Players, images, tables, document
  links, read view, and editor;
- side-by-side creature and item source previews before copying a compendium entry.

## Prototype warning

Lore Smith is experimental. Builders and preparation workflows can still contain
bugs while the module is under active development.

## Installation

Use the manifest URL:

`https://raw.githubusercontent.com/Idoz53/lore-smith/main/module.json`

Enable Lore Smith in a world using the PF2e system. A new Lore Smith button is
added to the Scene controls for GMs.

The Creature Builder icon appears in the title bar of native PF2e NPC sheets.
The microphone icon beside it opens that NPC's Voice Reference studio. Audio is
saved under `Data/lore-smith/npc-voices/<actor-id>` and the organized sample
library is stored on the Actor, so it remains available between Foundry sessions.
Foundry or the browser asks for microphone permission the first time it records.
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
The Item Builder icon appears in native PF2e Item sheets.

## Content and licensing

Lore Smith reads actors, items, spells, journals, scenes, tokens, walls, and
compendia from the installed PF2e system. It does not bundle paid Paizo content.
See `LICENSE.txt`.
