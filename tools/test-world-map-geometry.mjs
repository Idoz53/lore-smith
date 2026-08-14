import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

const names = [
  "worldPolygonSignedArea", "worldPolygonArea", "worldPolygonCentroid", "worldPolygonLabelPoint",
  "worldPointOnSegment", "worldPointInPolygon", "worldSegmentOrientation", "worldSegmentsIntersect",
  "worldSegmentsProperlyIntersect", "worldPolygonSelfIntersects", "worldRegionDepth", "worldRegionAtPoint",
  "worldRegionContainsRegion",
];
const geometry = Function(`${names.map(extractFunction).join("\n")}\nreturn {${names.join(",")}};`)();

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
assert.equal(geometry.worldPointInPolygon({ x: 0.5, y: 0.5 }, square), true);
assert.equal(geometry.worldPointInPolygon({ x: 1.1, y: 0.5 }, square), false);
assert.equal(geometry.worldPointInPolygon({ x: 1, y: 0.5 }, square), true);
assert.equal(geometry.worldSegmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }, { x: 1.5, y: 0 }), true);

const bowtie = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
assert.equal(geometry.worldPolygonSelfIntersects(bowtie), true);

const concave = {
  id: "parent", parentId: "",
  vertices: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }],
};
const crossingChild = { id: "cross", parentId: "parent", vertices: [{ x: 0.5, y: 2.5 }, { x: 2.5, y: 2.5 }, { x: 1.5, y: 0.5 }] };
const containedChild = { id: "child", parentId: "parent", vertices: [{ x: 0.5, y: 0.2 }, { x: 2.5, y: 0.2 }, { x: 1.5, y: 0.8 }] };
assert.equal(geometry.worldRegionContainsRegion(concave, crossingChild), false);
assert.equal(geometry.worldRegionContainsRegion(concave, containedChild), true);
assert.equal(geometry.worldRegionContainsRegion(concave, { ...concave, id: "duplicate" }), false);
assert.equal(geometry.worldPointInPolygon(geometry.worldPolygonLabelPoint(concave.vertices), concave.vertices), true);
assert.equal(geometry.worldRegionAtPoint({ x: 1.5, y: 0.5 }, [concave, containedChild])?.id, "child");

const saveStart = source.indexOf("async saveWorldMapDraft()");
const saveEnd = source.indexOf("async renderWorldMapPreservingScroll()", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
assert.doesNotMatch(source.slice(saveStart, saveEnd), /this\.worldMap\s*=\s*normalizeWorldMapBuild/);

console.log("World Map Builder geometry and state regression checks passed.");
