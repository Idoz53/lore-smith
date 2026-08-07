# Lore Smith

Lore Smith is a prototype Game Master workspace for Foundry VTT 13 and the
Pathfinder Second Edition system.

The module provides:

- an inline Journal-backed campaign notebook with `[[wiki links]]`;
- compendium-backed guided creature and item builders embedded in native PF2e sheets;
- encounter setup using actors and tokens already in the Foundry world;
- Combat Tracker buttons for randomized iteration logs and live Scene combat;
- detailed combat logs;
- a live scene replay that moves tokens and posts actions to Foundry chat.

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

## Content and licensing

Lore Smith reads actors, items, spells, journals, scenes, tokens, walls, and
compendia from the installed PF2e system. It does not bundle paid Paizo content.
See `LICENSE.txt`.
