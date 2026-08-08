# Lore Smith

Lore Smith is a prototype Game Master workspace for Foundry VTT 13 and the
Pathfinder Second Edition system.

The module provides:

- a responsive leather-and-parchment Journal notebook that retains Foundry's
  native page sidebar, permissions, formatting toolbar, headings, lists, tables,
  images, and document links;
- compendium-backed guided creature and item builders embedded in native PF2e sheets;
- encounter setup using actors and tokens already in the Foundry world;
- Combat Tracker buttons for randomized iteration logs and live Scene combat;
- spell-, ability-, item-, strike-, save-, condition-, and area-template-aware combat choices;
- detailed iteration logs and a separate live-combat log window;
- pause, resume, stop, and adjustable pacing controls for live combat without
  Chat spam by default;
- native PF2e spellcasting-entry casts for prepared, flexible, spontaneous,
  innate, focus, at-will, and cantrip spells, using the same slot and use
  validation as the PF2e Cast control;
- native PF2e spell override variants, so variable-action spells use the
  system-defined action cost, target, range, area, and damage or healing data;
- browse-all compendium source libraries with keyword, level, trait, and type filters;
- an optional Bestiary Ability Glossary-only filter for creature abilities;
- GM Core level benchmark menus for creature statistics;
- native Foundry Journal sheets with their standard formatting, images, and page
  sidebar; owned text pages open directly in an always-editable native editor
  inside the parent Journal, while `[[wiki links]]` open or create pages in that
  same Journal;
- persistent inline Journal editing after autosaves and document re-renders,
  without reopening Foundry's separate page-editor window;
- edit-mode wiki links are highlighted in blue and remain functional: typing
  `[[` supplies the closing brackets and opens searchable page autocomplete;
  use the mouse wheel, arrow keys, Enter, or Tab to choose a page, click a
  completed link to open it, or Ctrl/Cmd-click to edit its name. Missing pages
  are created inside the same Journal;
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
- explicit adapters for attacks, saves, damage, healing, IWR, conditions, area
  templates, spell slots, frequencies, recharge timers, and common skill actions;
- data-driven tactical profiles for all 29 PF2e classes, selected from the
  actor's Class item rather than a character's name;
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
dedicated adapter.

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
