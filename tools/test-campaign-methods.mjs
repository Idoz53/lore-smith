import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let serial = 0;
globalThis.foundry = { utils: { randomID: () => `method-${++serial}` } };
const source = await readFile(new URL("../scripts/campaign-workspace-legacy.js", import.meta.url), "utf8");
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const { ensureCampaignWorkspace: ensure, applyCampaignWorkspaceAfterPlay: record, revelationCoverage: coverage, campaignWorkspaceJournalPages: pages } = api;

// Additive, repeatable migration: old acts, drafts, unknown fields and history are retained.
const campaign = {
  name: "The Old Trade Road", premise: "The bridge needs repairs.",
  characters: [{ id: "hero", name: "Alia", desire: "Find her missing teacher", bond: "Owes the cart driver", complication: "Forbidden oath", growth: "Reconcile with the order" }],
  openQuestions: [{ id: "q", text: "Where are the missing tools?" }],
  acts: [{ id: "act", name: "The road", startingSituation: "The bridge closes before the market.", chapters: [{ sessions: [{ id: "old", title: "First journey", prep: { notes: "Keep this" } }] }] }],
  workspace: { version: 1, id: "existing", customExtension: { keep: true }, partyIntent: "Take the northern road", resources: [
    { id: "hero-resource", sourceId: "hero", name: "Alia", kind: "character", notes: "Existing character notes" },
    { id: "old-clue", name: "The note", kind: "clue", notes: "The warehouse bell rang before dawn.", discovered: true },
  ], situations: [], prep: { id: "old-packet", title: "Already prepared", opening: "Keep this opening", detail: { custom: "Old wizard content" } }, history: [{ id: "old-history", summary: "Previous game", custom: "Preserved", prep: { title: "Old game" }, changes: [] }] },
};
const acts = JSON.stringify(campaign.acts), oldHistory = JSON.stringify(campaign.workspace.history);
let w = ensure(campaign);
assert.equal(w.version, 2);
assert.equal(w.id, "existing");
assert.equal(w.resources[0].ambitions, "Find her missing teacher");
assert.equal(w.resources[0].relationships, "Owes the cart driver");
assert.equal(w.resources[1].clueStatus, "delivered");
assert.equal(w.resources[1].notes, "The warehouse bell rang before dawn.");
assert.equal(w.prep.detail.custom, "Old wizard content");
assert.equal(w.questions, "Where are the missing tools?");
assert.equal(JSON.stringify(campaign.acts), acts);
assert.equal(JSON.stringify(w.history), oldHistory);
assert.deepEqual(w.customExtension, { keep: true });
const migrated = JSON.stringify(campaign);
ensure(campaign);
assert.equal(JSON.stringify(campaign), migrated, "Migration is idempotent.");
const firstUse = { characters: campaign.characters, acts: campaign.acts, problem: { involvement: "GM-proposed hook" } };
const fresh = ensure(firstUse);
assert.equal(fresh.resources[0].ambitions, "Find her missing teacher");
assert.equal(fresh.partyIntent, "", "A GM hook must not become a claimed player intention.");
assert.equal(fresh.situations[0].sourceActId, "act");

w.resources.push(
  { ...api.newWorkspaceResource(), id: "witness", name: "The cart driver", kind: "npc", uuid: "Actor.cart-driver", desire: "Save his cart" },
  { ...api.newWorkspaceResource(), id: "witness-alias", name: "The same cart driver", kind: "npc", uuid: "Actor.cart-driver" },
  { ...api.newWorkspaceResource(), id: "warehouse", name: "Northern warehouse", kind: "location", uuid: "Scene.warehouse" },
  ...[1, 2, 3].map((i) => ({ ...api.newWorkspaceResource(), id: `clue-${i}`, name: `Clue ${i}`, kind: "clue", notes: `Distinct evidence ${i}`, sourceId: "witness", method: ["Ask politely", "Bribe", "Threaten"][i - 1], clueStatus: "prepared" })),
);
const revelation = { ...api.newWorkspaceRevelation(), id: "revelation", title: "Find the warehouse", conclusion: "The tools are in storage", destinationId: "warehouse", clueIds: ["clue-1", "clue-2", "clue-3"] };
w.revelations.push(revelation);
ensure(campaign);
assert.equal(coverage(w, revelation).sources, 1, "Three methods on one witness are one source.");
assert.equal(coverage(w, revelation).ready, false);
w.resources.find((r) => r.id === "clue-2").sourceId = "witness-alias";
assert.equal(coverage(w, revelation).sources, 1, "Records linking the same document share a failure point.");
const second = w.resources.find((r) => r.id === "clue-2"), third = w.resources.find((r) => r.id === "clue-3");
second.sourceId = ""; second.source = "Warehouse ledger"; third.sourceId = ""; third.source = "Observatory measurements";
assert.equal(coverage(w, revelation).ready, true);
second.sourceGroup = "Lost archive"; third.sourceGroup = "  lost   archive ";
assert.equal(coverage(w, revelation).sources, 2, "Shared dependencies override separately named sources.");
second.sourceGroup = ""; third.sourceGroup = "";
third.clueStatus = "unavailable";
assert.equal(coverage(w, revelation).clues, 2);
third.clueStatus = "prepared";
third.notes = second.notes;
assert.equal(coverage(w, revelation).clues, 2, "Duplicate evidence is not a third distinct clue.");
third.notes = "Distinct evidence 3";

w.connections.push({ id: "road", fromId: "witness", toId: "warehouse", kind: "access", description: "The north road; no check required" });
w.connections.push({ id: "lead", fromId: "witness", toId: "warehouse", kind: "lead", clueId: "clue-1", description: "" });
w.prep.resourceIds = ["witness", "warehouse"]; w.prep.revelationIds = [revelation.id];
w.prep.scenes = [{ id: "scene", text: "A ferry crossing, if they take the river", used: false, carry: true }, { id: "retire", text: "A stale possibility", used: false, carry: false }];
w.prep.secrets = [{ id: "secret", text: "The bell was recast last winter", used: false, carry: true }, { id: "used", text: "A revealed fact", used: true, carry: true }];
w.prep.characters = "Bring Alia's oath into play if relevant.";
w.prep.opening = "The warehouse closes for the day.";
w.facts = "Tools are missing."; w.theories = "The cart driver borrowed the tools.";
let exported = pages(campaign);
const table = exported.find((p) => p.key === "workspace-prep").content;
assert.match(table, /Actor.cart-driver/);
assert.match(table, /The north road; no check required/);
assert.match(table, /Bring Alia/);
assert.match(table, /The bell was recast/);
assert.equal((table.match(/Distinct evidence 1/g) || []).length, 1, "Structural evidence is exported once, even with multiple references.");
w.resources.find((r) => r.id === "clue-1").notes = "Revised fixed evidence";
assert.match(pages(campaign)[1].content, /Revised fixed evidence/);

w.after.summary = "The party followed the first clue to the warehouse.";
w.after.nextIntent = "Question the bell keeper.";
w.after.newFacts = "The tools are in storage.";
w.after.decisions = "They spared the cart driver.";
w.after.worldChanges = "The cart driver can now warn the warehouse.";
w.after.rewardsGained = "A passage token.";
w.after.carryNotes = "The river route is still useful.";
w.after.location = "Northern warehouse"; w.after.updateLocation = true;
w.after.objective = "Silence the bell"; w.after.updateObjective = true;
w.after.usedResourceIds = ["witness"];
w.after.changes = [{ id: "d", targetType: "resource", targetId: "clue-1", field: "clueStatus", value: "delivered" }, { id: "u", targetType: "revelation", targetId: "revelation", field: "understanding", value: "They know where to go, but not why the bell matters." }];
const before = JSON.stringify(campaign);
w.after.changes.push({ id: "bad", targetType: "resource", targetId: "clue-2", field: "clueStatus", value: "bad status" });
const invalid = JSON.stringify(campaign);
assert.throws(() => record(campaign), /Prepared/);
assert.equal(JSON.stringify(campaign), invalid, "A failed batch cannot partially apply or rotate prep.");
w.after.changes.pop(); assert.equal(JSON.stringify(campaign), before);
const entry = record(campaign);
assert.equal(w.resources.find((r) => r.id === "clue-1").discovered, true);
assert.equal(revelation.status, "open", "Delivery does not automatically imply understanding.");
assert.equal(revelation.understanding, "They know where to go, but not why the bell matters.");
assert.equal(w.location, "Northern warehouse"); assert.equal(w.objective, "Silence the bell");
assert.equal(w.facts, "Tools are missing.\nThe tools are in storage.");
assert.equal(w.theories, "The cart driver borrowed the tools.", "Theories never become confirmed facts automatically.");
assert.deepEqual(w.prep.scenes.map((r) => r.id), ["scene"]);
assert.deepEqual(w.prep.secrets.map((r) => r.id), ["secret"]);
assert.deepEqual(w.prep.resourceIds, ["warehouse"]);
assert.equal(w.prep.notes, "The river route is still useful.");
assert.deepEqual(w.prep.revelationIds, ["revelation"]);
assert.match(entry.tableContent, /Revised fixed evidence/);
assert.equal(entry.currentBefore.location, "");
assert.equal(entry.rewardsGained, "A passage token.");
const frozen = JSON.stringify(entry);
second.notes = "Later evidence"; w.prep.scenes[0].text = "Different scene"; w.facts = "Later facts";
assert.equal(JSON.stringify(entry), frozen, "Later record edits cannot rewrite the session snapshot.");
assert.match(pages(campaign)[2].content, /Revised fixed evidence/);
assert.equal(JSON.stringify(w.history[0]), JSON.stringify(JSON.parse(oldHistory)[0]));

w.resources.push({ ...api.newWorkspaceResource(), name: '<img src=x onerror="bad()">', kind: "npc", notes: "<script>bad()</script>" });
assert.ok(!pages(campaign)[0].content.includes('<img src=x'));
console.log("Legacy campaign compatibility passed: additive migration, clue/source diagnostics, shared evidence, older preparation, optional scenes, explicit consequences, carry-forward, immutable history, escaped exports.");
