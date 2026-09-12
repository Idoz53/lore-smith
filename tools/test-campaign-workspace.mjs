import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workspaceSource = await readFile(new URL("../scripts/campaign-workspace.js", import.meta.url), "utf8");
let nextId = 0;
globalThis.foundry = { utils: { randomID: () => `test-${++nextId}`, deepClone: structuredClone } };
const workspace = await import(`data:text/javascript;base64,${Buffer.from(workspaceSource).toString("base64")}`);
const { ensureCampaignWorkspace, selectWorkspaceSituation, workspaceSelectedResources, applyCampaignWorkspaceAfterPlay, campaignWorkspaceJournalPages } = workspace;

const campaign = { name: "The Star of Tevrar", premise: "A star falls into the lake.", acts: [] };
let board = ensureCampaignWorkspace(campaign);
const boardId = board.id;
board.situations.push({ id: "rescue", title: "Rescue Tomas", status: "active", summary: "Tomas is missing.", stakes: "His sister needs him home.", leads: "Search the shore.", nextMove: "The water rises.", resourceIds: ["tomas", "shore"] });
board.resources.push(
  { id: "tomas", name: "Tomas", kind: "npc", state: "Missing", notes: "Saw the star fall.", uuid: "Actor.tomas", discovered: false, relatedIds: ["shore"] },
  { id: "shore", name: "Lake shore", kind: "location", state: "Flooded", notes: "Floating wreckage.", uuid: "Scene.shore", discovered: true, relatedIds: [] },
  { id: "contract", name: "Tomas's contract", kind: "clue", state: "In his coat", notes: "Names Vessa as the specialist.", uuid: "", discovered: false, relatedIds: ["tomas"] },
  { id: "archive", name: "Drowned archive", kind: "location", state: "Unexplored", notes: "A later expedition.", uuid: "Scene.archive", discovered: false, relatedIds: [] },
);
selectWorkspaceSituation(campaign, "rescue");
assert.equal(ensureCampaignWorkspace(campaign).id, boardId, "Normalization must retain workspace identity.");
assert.ok(workspaceSelectedResources(campaign).some((r) => r.id === "tomas"), "Selecting a situation gathers its existing records.");
board = campaign.workspace;
board.resources.find((r) => r.id === "tomas").state = "Found on a wreck";
assert.equal(workspaceSelectedResources(campaign).find((r) => r.id === "tomas").state, "Found on a wreck", "Preparation uses current records, not copied values.");
board.prep.resourceIds.push("archive");
board.prep.title = "Rescue at the shore";
board.prep.opening = "Mira points toward the wreck.";
board.prep.notes = "Offer the players several approaches.";
board.partyIntent = "Find Tomas";

const campaignBeforeInvalidApply = JSON.stringify(campaign);
assert.throws(() => applyCampaignWorkspaceAfterPlay(campaign), "An empty After Play entry must not rotate preparation.");
assert.equal(JSON.stringify(campaign), campaignBeforeInvalidApply, "Invalid updates must not alter the board.");

const settings = new Map();
const journals = new Map();
journals.find = (predicate) => [...journals.values()].find(predicate);
const htmlEscape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const sandbox = {
  ...workspace, console, setTimeout, clearTimeout, structuredClone,
  foundry: { utils: globalThis.foundry.utils, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => Base } } },
  game: { settings: { set: async (_scope, key, value) => { settings.set(key, value); }, get: (_scope, key) => settings.get(key) ?? "" }, journal: journals, playlists: new Map([["existing", {}]]) },
  Hooks: { once() {}, on() {} },
  document: { createElement: () => ({ textContent: "", get innerHTML() { return htmlEscape(this.textContent); } }) },
  ui: { notifications: { warn(message) { throw new Error(message); }, error(message) { throw new Error(message); }, info() {} } },
};
const source = (await readFile(new URL("../scripts/main.js", import.meta.url), "utf8")).replace(/^import .*?;\s*/m, "");
vm.createContext(sandbox);
vm.runInContext(`${source}\nglobalThis.testApi = { LoreSmithDashboard, normalizeSessionPrep, normalizeCampaignBuild, newSessionPrep, adventureCampaignJournalPages };`, sandbox);
const { LoreSmithDashboard, normalizeSessionPrep, normalizeCampaignBuild, newSessionPrep, adventureCampaignJournalPages } = sandbox.testApi;
assert.equal(newSessionPrep().locations.length, 2, "Standalone Session Prep retains its existing two-place defaults.");
const standalone = normalizeSessionPrep({ locations: [] });
assert.equal(standalone.locations.length, 2);
assert.equal(normalizeSessionPrep({ campaignLink: { workspaceId: boardId, packetId: board.prep.id }, locations: [] }).locations.length, 0, "Workspace preparation can reopen with no extra location cards.");

const app = new LoreSmithDashboard();
app.campaign = app.adventureCampaign = normalizeCampaignBuild(campaign);
app.render = async () => {};
app.activeTab = "campaign";
await LoreSmithDashboard.openCampaignWorkspacePrep.call(app);
assert.equal(app.activeTab, "session");
assert.equal(app.sessionPrep.locations.length, 0);
assert.equal(app.sessionPrep.title, "Rescue at the shore");
assert.equal(app.sessionPrep.goal, "Find Tomas");
app.sessionPrep.title = "The wreck rescue";
app.sessionPrep.opening = "A mast cracks above Tomas.";
app.sessionPrep.reminders = "Keep the rising water visible.";
await app.saveSessionPrepDraft();
assert.equal(app.adventureCampaign.workspace.prep.title, "The wreck rescue");
assert.equal(app.adventureCampaign.workspace.prep.opening, "A mast cracks above Tomas.");
assert.equal(app.adventureCampaign.workspace.prep.notes, "Keep the rising water visible.");
assert.equal(JSON.parse(settings.get("campaignBuilderDraft")).campaign.workspace.prep.detail.title, "The wreck rescue");

app.activeTab = "campaign";
app.adventureCampaign.workspace.prep.opening = "Mira arrives with a boat.";
await LoreSmithDashboard.openCampaignWorkspacePrep.call(app);
assert.equal(app.sessionPrep.opening, "Mira arrives with a boat.", "Packet edits must appear when detailed preparation reopens.");
app.sessionPrep.locations.push({ id: "extra", name: "Pier", image: "" });
await LoreSmithDashboard.removeLocation.call(app, null, { dataset: { id: "extra" } });
assert.equal(app.sessionPrep.locations.length, 0, "Workspace location cards are optional and removable.");
const packet = app.adventureCampaign.workspace.prep;
packet.detailJournalId = "journal-prep";
journals.set("journal-prep", { id: "journal-prep", getFlag: (_scope, flag) => flag === "sessionPrep" });
app.sessionPrep.journalId = "";
assert.equal(app.resolveSessionJournal()?.id, "journal-prep", "Reopening a packet must find its existing generated Journal.");

const beforeHistory = app.adventureCampaign.workspace;
const oldPacketId = beforeHistory.prep.id;
beforeHistory.after.summary = "The party rescued Tomas and warned the town.";
beforeHistory.after.nextIntent = "Find Vessa, the Sphere specialist.";
beforeHistory.after.usedResourceIds = ["tomas", "shore", "contract"];
beforeHistory.after.changes = [
  { id: "c1", targetType: "resource", targetId: "tomas", field: "state", value: "Safe with Mira", reason: "The party rescued him." },
  { id: "c2", targetType: "resource", targetId: "contract", field: "discovered", value: true, reason: "Tomas showed them the contract." },
  { id: "c3", targetType: "situation", targetId: "rescue", field: "status", value: "resolved", reason: "Tomas returned home." },
];
beforeHistory.after.changes.push({ id: "invalid", targetType: "resource", targetId: "missing", field: "state", value: "Changed" });
assert.throws(() => applyCampaignWorkspaceAfterPlay(app.adventureCampaign), "Every pending change must be valid.");
assert.equal(beforeHistory.resources.find((r) => r.id === "tomas").state, "Found on a wreck", "An invalid batch must not partially apply earlier changes.");
assert.equal(beforeHistory.history.length, 0);
beforeHistory.after.changes.pop();
const entry = applyCampaignWorkspaceAfterPlay(app.adventureCampaign);
const updated = app.adventureCampaign.workspace;
assert.equal(updated.resources.find((r) => r.id === "tomas").state, "Safe with Mira");
assert.equal(updated.situations.find((s) => s.id === "rescue").status, "resolved");
assert.equal(updated.partyIntent, "Find Vessa, the Sphere specialist.");
assert.notEqual(updated.prep.id, oldPacketId, "After Play opens a fresh preparation packet.");
assert.ok(updated.prep.resourceIds.includes("archive"), "Unused preparation must carry forward.");
assert.equal(updated.history.length, 1);
assert.equal(entry.prep.id, oldPacketId, "History retains the previous preparation.");
assert.equal(entry.changes.find((change) => change.targetId === "tomas" && change.field === "state").before, "Found on a wreck");
const storedHistory = JSON.stringify(entry);
updated.resources.find((r) => r.id === "tomas").state = "Travelling";
assert.equal(JSON.stringify(entry), storedHistory, "Future edits must not rewrite recorded history.");
await app.saveSessionPrepDraft();
assert.equal(updated.prep.detail, null, "An old open Session Prep draft must not overwrite the next packet.");

const exported = campaignWorkspaceJournalPages(app.adventureCampaign);
assert.ok(exported.some((page) => page.content.includes("Actor.tomas")), "Journal output must preserve native Foundry links.");
assert.ok(exported.some((page) => page.content.includes("The party rescued Tomas")), "Journal output includes actual play history.");
const freshCampaign = normalizeCampaignBuild({ name: "New campaign", premise: "A new problem" });
assert.equal(adventureCampaignJournalPages(freshCampaign).length, 1, "Unfilled optional Acts must not generate placeholder Journal pages.");
freshCampaign.acts[0].startingSituation = "The bridge is burning.";
assert.equal(adventureCampaignJournalPages(freshCampaign).length, 2, "Existing substantive Act content remains exportable.");

console.log("Campaign workspace checks passed: shared records, atomic updates, history, unused preparation, detailed prep persistence, optional places, Journal links, and existing Acts.");
