# Lore Smith

Lore Smith is a prototype Game Master workspace for Foundry VTT 13 and the
Pathfinder Second Edition system.

The module provides:

- a Campaign Planner with a living **Campaign Overview** and three entry types:
  **Adventure**, **Session**, and optional **Person or Group**. New buttons create
  editable records immediately; existing entries are reopened and updated;
- shared people, places, clues, intended NPC actions, and Foundry documents.
  An Adventure lasts across Sessions. Sessions select the material they might
  use, without duplicating the Adventure or its NPCs;
- preparation and play notes in each Session, explicit found-clue and player
  understanding updates, current campaign facts, and preserved completed-session
  snapshots. Unused material remains available and previous selections can be
  reused for the next Session;
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
- image-backed NPC prep cards with descriptions, roles, motivations, secrets,
  optional native Actor UUID links, and independently removable portraits;
  portrait size and left, right, above, or below placement are preserved per NPC
  and rendered responsively in the generated Session Journal;
- per-location image size and placement controls using the same responsive
  Session Journal layout, with native Foundry file selection and immediate draft
  saving that preserves the current form position;
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

### Guided item and creature builders (0.39.0)

Open a native PF2e item or NPC sheet and choose its Lore Smith builder button.
Each step has a **Guide** with examples, practical checks, and links to the
relevant Archives of Nethys rules. **Review result** shows the native statistics,
written abilities, and what the GM or player will do at the table.

**Items:** set the base statistics, runes, and precious material, then compare
nearby official items from installed PF2e compendiums. Price ranges and permanent
bonus benchmarks are advice, not a balance certification. A copied item's
native rules remain intact.

In **Activations**, choose the action cost, frequency, recipient, and duration.
In **Effects**, assign each benefit to **Constant while worn / held correctly**
or to a named activation. For example, a once-per-day activation with a one-minute
duration and fire resistance 5 creates an **Apply effect** button. Using it
creates or refreshes a timed native PF2e Effect and spends one activation use.
The resistance is not applied just for holding the item.

Constant rules follow PF2e equipment and investment requirements. Activated
effects can affect the owner or one targeted creature the user can edit; a GM
can apply effects to other targets. Duration follows the world clock and PF2e's
expired-effect settings. Range, action costs, requirements, saving throws,
written conditions, and special ending conditions remain table decisions.
Damage/healing and save links roll; the GM applies their outcomes. Consumable
charges and quantity remain separate native-sheet controls. Review older builds
and finish them once to remove old always-on copies of activation bonuses.

**Creatures:** copying a starting creature now remaps its spellcasting, prepared
spell, grant, and container links to the new embedded items. Saving statistics
preserves damage already taken. A level-change preview lists benchmark changes
before applying them and leaves unmatched custom values alone. Spell ranks,
slots, and written effects still need review after rescaling.

The ability workshop supports a basic save or separately written critical
success, success, failure, and critical failure outcomes. Generated abilities
can be edited in place. The advisory panel checks Strike accuracy and damage,
spellcasting, spell assignment, area damage, frequency, and action combinations.
The final preview includes defenses, movement, Strikes, abilities, spellcasting
entries, slots, and spells, with native-sheet edit controls.

Unfinished fields and up to ten undo operations are saved locally for each
world, user, and document. Leaving a step or closing saves its ordinary fields;
**Finish** applies the final item automation. Undo changes only fields touched
by that operation and stops if those fields were edited elsewhere. An older
draft is offered explicitly if its source sheet has changed. Local drafts do
not transfer to another browser or device.

Validation includes automated item, creature, draft/undo, campaign, and map
regressions, plus all thirteen builder steps rendered in a browser with Foundry
API stubs. A live Foundry/PF2e world was not available for in-world verification.

### Campaign Planner (0.41.0)

The planner follows the Alexandrian's situation preparation, clue design,
preparation load, and campaign status methods. Its forms adapt the supplied
Obsidian Campaign Planner template to editable Foundry records. The former
8-step workflow is retired from this interface. No template duplication,
scheduling, attendance, table agreements, or onboarding forms are required.

1. Update **Campaign Overview** with the premise, where the party is, what they
   intend next, NPC actions with their in-world triggers, and facts to remember.
2. Choose **New Adventure** for a problem the party can engage with. Record the
   problem and involvement, who wants what and the resources available, intended
   actions, places or contacts, and useful material. Optional details collapse.
   Keep this same Adventure across games; there is no required visiting order.
3. From that Adventure choose **New Session for this Adventure**. The Adventure
   is preselected. Select the people and places the party might reach, NPC plans,
   clues, and material. Directions to another Adventure's locations are offered
   as nearby possibilities too. Add a short readiness checklist and play notes.
4. Fill **After the game** and complete the Session. Select the clues actually
   found and separately choose which understanding notes to update. The optional
   overview update records the party's location, next intention, and new facts.
   Edit changed Adventure circumstances and NPC intentions on their shared records.
5. Use **New Person or Group** only when a recurring NPC or faction needs more
   detail. Link this entry from several Adventures and Sessions. A few inline
   lines in an Adventure are enough for a minor character.

**Clues:** each clue has one maintained resource record. Discoveries and
Sessions reference its ID. A discovery can have several clues, and a clue can
be reused by another discovery. Evidence, source, optional discovery method,
and Not found / Found / Unavailable status are separate from the players'
understanding. A counter helps review three distinct clues and independent
sources; it never blocks play or Session completion. One useful clue is enough.
Several ways of questioning a witness share a source. The optional shared-source
field groups clues that depend on the same witness or archive. Source counting
is an aid; the GM still judges actual independence and whether evidence supports
its conclusion. Ordinary directions do not need an investigation structure.

**Reuse and history:** a new Session stores selections of existing records.
For the same Adventure it carries the previous Session's selected links and
unfinished readiness items; its game notes and recap start empty. Nothing
removes an unvisited place or unfound clue. Completing a Session freezes its
prepared material and recap. Editing a completed Session retains the earlier
completed version, and campaign updates are unchecked to avoid applying facts
again accidentally. NPC plans only advance when the GM edits them.

**Saving and safe migration:** this remains in the existing
`campaignBuilderDraft` client setting. The additive workspace version 3 upgrade
reuses situation/resource IDs: existing situations become Adventures, useful
pending preparation becomes a Session, and existing session history becomes
completed Sessions. Original Acts, history, detailed drafts, unknown extension
fields, and document links remain stored. Retired fields and unfinished older
updates remain available under **Earlier notes (preserved)**; they are not
silently discarded or automatically applied. Old clues keep their evidence and
found status; missing sources are left for the GM to supply. No manual import
is required. Storage remains per client; this does not introduce multi-GM sync.

**Foundry documents:** drop Actors, Scenes, Journals, Items, or Playlists onto
relevant records and open their native sheets. Create/update a native Journal
snapshot for the selected entry or overview. New entry Journals default to GM
only. Existing permissions are retained; Found status never reveals a document
to players. Manually changed generated pages require confirmation before being
replaced, and unrelated pages are preserved. Earlier Session Journals can still
be opened. Native Journal editors and other module builders are unchanged.

The module still supports Foundry VTT 13 and PF2e 7.0.0 or later. The interface
uses the module's existing English labels and parchment controls.

References:
[Don't Prep Plots](https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots),
[Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule),
[Managing Prep Load](https://thealexandrian.net/wordpress/52735/roleplaying-games/random-gm-tip-managing-prep-load),
[Campaign Status Documents](https://thealexandrian.net/wordpress/42961/roleplaying-games/smart-prep-part-4-campaign-status-documents).

Checks: `node tools/validate-module.mjs`, `node tools/test-campaign-entries.mjs`,
`node tools/test-campaign-workspace.mjs`, and the older data compatibility tests
in `node tools/test-campaign-methods.mjs`. The optional browser check
`node tools/test-campaign-ui.cjs` requires Playwright and Microsoft Edge;
`LORE_SMITH_QA_OUTPUT` selects its screenshot directory (default: OS temporary
directory). It exercises creation, editing, linked records, saving/reopening,
Foundry drops, Journal edit protection and permissions, failed-save retry,
completed-session history, reuse, and narrow layouts using temporary sample
campaigns. Foundry APIs are mocked in these checks; live Foundry/PF2e world
verification is still required.

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
