"""Build a runtime-only Foundry module archive; never collect workspace or world data."""
from pathlib import Path
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = (
    "LICENSE.txt", "module.json", "README.md",
    "scripts/builder-guides.js", "scripts/builder-session.js", "scripts/building-creatures-data.js",
    "scripts/campaign-planner.js", "scripts/campaign-workspace-legacy.js", "scripts/campaign-workspace.js",
    "scripts/creature-builder-support.js", "scripts/item-builder-support.js", "scripts/launcher.js",
    "scripts/main.js", "scripts/native-workflows.js", "scripts/npc-voice-recorder.js",
    "styles/lore-smith.css", "templates/creature-builder.hbs", "templates/dashboard.hbs",
    "templates/item-builder.hbs", "templates/npc-voice-recorder.hbs",
)

def build(destination):
    manifest = json.loads((ROOT / "module.json").read_text(encoding="utf-8"))
    for name in [*manifest["esmodules"], *manifest["styles"]]:
        if name not in RUNTIME:
            raise ValueError("Unreviewed runtime entry: " + name)
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in RUNTIME:
            source = ROOT / name
            if source.is_symlink():
                raise ValueError("Runtime files cannot be symlinks: " + name)
            archive.write(source, name)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(RUNTIME)
        for name in RUNTIME:
            assert archive.read(name) == (ROOT / name).read_bytes()
    print(json.dumps({"version": manifest["version"], "files": len(RUNTIME), "archive": str(destination)}))

if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "lore-smith.zip")
