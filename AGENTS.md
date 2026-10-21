# Module release requirements

- Never copy a user's campaign names, notes, plot, characters, screenshots, or other private material into public source, examples, tests, commits, or packages. Use unrelated generic examples only.
- A fresh Campaign Planner must have an empty name and premise and no saved Adventures, Sessions, People or Groups, facts, consequences, or history. Examples are placeholders, never saved values.
- Build installation ZIPs with `python tools/package-module.py`. This runtime allowlist excludes tests, fixtures, screenshots, notes, worlds, settings, recovery data, and development outputs.
- Saved Foundry work is separate from module files. Clear only the intended user's planner through the reset control. Automatic clearing after updates is an explicit client preference; never force a global wipe for other users.
- Check empty startup, clearing, saving/reopening, and any changed persistence behavior before publishing. Update the public manifest and matching ZIP together, and verify the actual download.
