import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workspaceSource = await readFile(new URL("../scripts/campaign-workspace.js", import.meta.url), "utf8");
let nextId = 0;
globalThis.foundry = { utils: { randomID: () => `test-${++nextId}`, deepClone: structuredClone } };
const workspace = await import(new URL("../scripts/campaign-workspace.js", import.meta.url));
const { ensureCampaignWorkspace, selectWorkspaceSituation, workspaceSelectedResources, applyCampaignWorkspaceAfterPlay, campaignWorkspaceJournalPages } = workspace;

const campaign = { name: "The Old Trade Road", premise: "A bridge needs urgent repairs.", acts: [] };
let board = ensureCampaignWorkspace(campaign);
const boardId = board.id;
board.situations.push({ id: "rescue", title: "Rescue Bram", status: "active", summary: "Bram is missing.", stakes: "His sister needs him home.", leads: "Search the shore.", nextMove: "The water rises.", resourceIds: ["bram", "shore"] });
board.resources.push(
  { id: "bram", name: "Bram", kind: "npc", state: "Missing", notes: "Saw the bridge collapse.", uuid: "Actor.bram", discovered: false, relatedIds: ["shore"] },
  { id: "shore", name: "Bridge shore", kind: "location", state: "Flooded", notes: "Floating wreckage.", uuid: "Scene.shore", discovered: true, relatedIds: [] },
  { id: "contract", name: "Bram's contract", kind: "clue", state: "In his coat", notes: "Names Orin as the specialist.", uuid: "", discovered: false, relatedIds: ["bram"] },
  { id: "archive", name: "Drowned archive", kind: "location", state: "Unexplored", notes: "A later repair crew.", uuid: "Scene.archive", discovered: false, relatedIds: [] },
);
selectWorkspaceSituation(campaign, "rescue");
assert.equal(ensureCampaignWorkspace(campaign).id, boardId, "Normalization must retain workspace identity.");
assert.ok(workspaceSelectedResources(campaign).some((r) => r.id === "bram"), "Selecting a situation gathers its existing records.");
board = campaign.workspace;
board.resources.find((r) => r.id === "bram").state = "Found on a wreck";
assert.equal(workspaceSelectedResources(campaign).find((r) => r.id === "bram").state, "Found on a wreck", "Preparation uses current records, not copied values.");
board.prep.resourceIds.push("archive");
board.prep.title = "Rescue at the shore";
board.prep.opening = "Lysa points toward the wreck.";
board.prep.notes = "Offer the players several approaches.";
board.partyIntent = "Find Bram";

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
vm.runInContext(`${source}\nglobalThis.testApi = { LoreSmithDashboard, normalizeSessionPrep, normalizeCampaignBuild, newSessionPrep, adventureCampaignJournalPages, clearCampaignPlannerStorage, prepareCampaignPlannerStorage };`, sandbox);
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
assert.equal(app.sessionPrep.goal, "Find Bram");
app.sessionPrep.title = "The wreck rescue";
app.sessionPrep.opening = "A mast cracks above Bram.";
app.sessionPrep.reminders = "Keep the rising water visible.";
await app.saveSessionPrepDraft();
assert.equal(app.adventureCampaign.workspace.prep.title, "The wreck rescue");
assert.equal(app.adventureCampaign.workspace.prep.opening, "A mast cracks above Bram.");
assert.equal(app.adventureCampaign.workspace.prep.notes, "Keep the rising water visible.");
assert.equal(JSON.parse(settings.get("campaignBuilderDraft")).campaign.workspace.prep.detail.title, "The wreck rescue");

app.activeTab = "campaign";
app.adventureCampaign.workspace.prep.opening = "Lysa arrives with a cart.";
await LoreSmithDashboard.openCampaignWorkspacePrep.call(app);
assert.equal(app.sessionPrep.opening, "Lysa arrives with a cart.", "Packet edits must appear when detailed preparation reopens.");
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
beforeHistory.after.summary = "The party rescued Bram and warned the town.";
beforeHistory.after.nextIntent = "Find Orin, the bridge engineer.";
beforeHistory.after.usedResourceIds = ["bram", "shore", "contract"];
beforeHistory.after.changes = [
  { id: "c1", targetType: "resource", targetId: "bram", field: "state", value: "Safe with Lysa", reason: "The party rescued him." },
  { id: "c2", targetType: "resource", targetId: "contract", field: "discovered", value: true, reason: "Bram showed them the contract." },
  { id: "c3", targetType: "situation", targetId: "rescue", field: "status", value: "resolved", reason: "Bram returned home." },
];
beforeHistory.after.changes.push({ id: "invalid", targetType: "resource", targetId: "missing", field: "state", value: "Changed" });
assert.throws(() => applyCampaignWorkspaceAfterPlay(app.adventureCampaign), "Every pending change must be valid.");
assert.equal(beforeHistory.resources.find((r) => r.id === "bram").state, "Found on a wreck", "An invalid batch must not partially apply earlier changes.");
assert.equal(beforeHistory.history.length, 0);
beforeHistory.after.changes.pop();
const entry = applyCampaignWorkspaceAfterPlay(app.adventureCampaign);
const updated = app.adventureCampaign.workspace;
assert.equal(updated.resources.find((r) => r.id === "bram").state, "Safe with Lysa");
assert.equal(updated.situations.find((s) => s.id === "rescue").status, "resolved");
assert.equal(updated.partyIntent, "Find Orin, the bridge engineer.");
assert.notEqual(updated.prep.id, oldPacketId, "After Play opens a fresh preparation packet.");
assert.ok(updated.prep.resourceIds.includes("archive"), "Unused preparation must carry forward.");
assert.equal(updated.history.length, 1);
assert.equal(entry.prep.id, oldPacketId, "History retains the previous preparation.");
assert.equal(entry.changes.find((change) => change.targetId === "bram" && change.field === "state").before, "Found on a wreck");
const storedHistory = JSON.stringify(entry);
updated.resources.find((r) => r.id === "bram").state = "Travelling";
assert.equal(JSON.stringify(entry), storedHistory, "Future edits must not rewrite recorded history.");
await app.saveSessionPrepDraft();
assert.equal(updated.prep.detail, null, "An old open Session Prep draft must not overwrite the next packet.");

const exported = campaignWorkspaceJournalPages(app.adventureCampaign);
assert.ok(exported.some((page) => page.content.includes("Actor.bram")), "Journal output must preserve native Foundry links.");
assert.ok(exported.some((page) => page.content.includes("The party rescued Bram")), "Journal output includes actual play history.");
const freshCampaign = normalizeCampaignBuild({ name: "New campaign", premise: "A new problem" });
assert.equal(adventureCampaignJournalPages(freshCampaign).length, 1, "Unfilled optional Acts must not generate placeholder Journal pages.");
freshCampaign.acts[0].startingSituation = "The bridge is burning.";
assert.equal(adventureCampaignJournalPages(freshCampaign).length, 2, "Existing substantive Act content remains exportable.");

// Exercise the actual dashboard close/save path, including a pending workspace operation.
let releaseOperation;
app.campaignWorkspacePending = new Promise((resolve) => { releaseOperation = resolve; });
const intentControl = { dataset: { plCurrent: "partyIntent" }, type: "textarea", value: "Follow the northern road" };
const container = { querySelector: () => null, querySelectorAll: (selector) => selector === "[data-pl-current]" ? [intentControl] : [] };
app.element = { querySelector: (selector) => selector === "[data-campaign-workspace]" ? container : selector === '[name="campaignName"]' ? { value: "Latest campaign name" } : null, querySelectorAll: () => [] };
app.activeTab = "campaign";
sandbox.foundry.applications.api.ApplicationV2.prototype.close = async () => "closed";
const closing = app.close();
await Promise.resolve();
assert.notEqual(app.campaign.name, "Latest campaign name", "Close waits for the current workspace action before syncing its replacement DOM.");
releaseOperation();
assert.equal(await closing, "closed");
const closedDraft = JSON.parse(settings.get("campaignBuilderDraft")).campaign;
assert.equal(closedDraft.name, "Latest campaign name");
assert.equal(closedDraft.workspace.partyIntent, "Follow the northern road");
assert.equal(closedDraft.workspace.history.length, 1);

console.log("Campaign workspace checks passed: shared records, atomic updates, history, unused preparation, detailed prep persistence, optional places, Journal links, and existing Acts.");

// A clean installation has no pre-written premise or saved planner entries.
const blank=normalizeCampaignBuild();
assert.equal(blank.name,'');assert.equal(blank.premise,'');
for(const key of ['situations','sessions','resources','actions','history','factEntries','revelations'])assert.equal(blank.workspace[key].length,0,key);
assert.equal(blank.workspace.location,'');assert.equal(blank.workspace.partyIntent,'');assert.equal(blank.workspace.facts,'');

// Exercise real dashboard/storage reset and version handling. Other builders and journals are untouched.
sandbox.game.modules=new Map([['lore-smith',{version:'1.0.0'}]]);
settings.set('campaignPlannerVersion','1.0.0');
settings.set('campaignPlannerResetOnUpdate',false);
settings.set('campaignBuilderDraft',JSON.stringify({campaign:{name:'Disposable planner',premise:'Disposable notes'}}));
settings.set('sessionPrepDraft',JSON.stringify({prep:{campaignLink:{workspaceId:'old'},notes:'Linked notes'}}));
settings.set('campaignMapBuilderDraft','separate map');settings.set('worldMapBuilderDraft','separate atlas');
const journalIds=[...journals.keys()];
app.sessionPrep.campaignLink={workspaceId:'old'};
await app.clearCampaignPlanner();
assert.equal(settings.get('campaignBuilderDraft'),'');assert.equal(settings.get('sessionPrepDraft'),'');
assert.equal(app.campaign.premise,'');assert.equal(app.campaign.name,'');assert.equal(app.campaign.workspace.sessions.length,0);
assert.equal(app.sessionPrep.campaignLink,null);assert.equal(settings.get('campaignMapBuilderDraft'),'separate map');assert.equal(settings.get('worldMapBuilderDraft'),'separate atlas');assert.deepEqual([...journals.keys()],journalIds);
settings.set('campaignBuilderDraft','work written after reset');
settings.set('sessionPrepDraft',JSON.stringify({prep:{notes:'Standalone prep',campaignLink:null}}));
const prepare=sandbox.testApi.prepareCampaignPlannerStorage;
sandbox.game.modules.get('lore-smith').version='1.0.1';await prepare();
assert.equal(settings.get('campaignBuilderDraft'),'work written after reset','Users who do not opt in retain their work.');
await app.setPlannerResetOnUpdate(true);await prepare();assert.equal(settings.get('campaignBuilderDraft'),'work written after reset','Enabling the option does not erase the current draft.');
sandbox.game.modules.get('lore-smith').version='1.0.2';await prepare();assert.equal(settings.get('campaignBuilderDraft'),'');
assert.equal(JSON.parse(settings.get('sessionPrepDraft')).prep.notes,'Standalone prep');
settings.set('campaignBuilderDraft','new work');await prepare();assert.equal(settings.get('campaignBuilderDraft'),'new work','Reopening on the same version retains newly written work.');
// A failed multi-setting clear restores previous values, then can be retried.
settings.set('sessionPrepDraft',JSON.stringify({prep:{campaignLink:{workspaceId:'old'},notes:'Linked retry'}}));
const savedSet=sandbox.game.settings.set;
sandbox.game.settings.set=async(scope,key,value)=>{if(key==='sessionPrepDraft'&&value==='')throw Error('Simulated reset failure');return savedSet(scope,key,value);};
sandbox.game.modules.get('lore-smith').version='1.0.3';
await assert.rejects(()=>prepare(),/Simulated reset failure/);
assert.equal(settings.get('campaignBuilderDraft'),'new work');assert.equal(settings.get('campaignPlannerVersion'),'1.0.2');
sandbox.game.settings.set=savedSet;await prepare();assert.equal(settings.get('campaignBuilderDraft'),'');assert.equal(settings.get('sessionPrepDraft'),'');
console.log('Blank planner and reset passed: empty defaults, actual storage clearing, linked draft cleanup, opt-in updates, repeat opening, failed-save rollback, and separate builders/documents.');

// An already-running linked save must finish before the clear, never after it.
app.sessionPrep.campaignLink={workspaceId:app.campaign.workspace.id,packetId:app.campaign.workspace.prep.id};
let releaseLinkedSave;const saveGate=new Promise(resolve=>{releaseLinkedSave=resolve;});
sandbox.game.settings.set=async(scope,key,value)=>{if(key==='sessionPrepDraft'&&value!=='')await saveGate;return savedSet(scope,key,value);};
const pendingLinkedSave=app.saveSessionPrepDraft();const clearing=app.clearCampaignPlanner();
await Promise.resolve();releaseLinkedSave();await pendingLinkedSave;await clearing;
assert.equal(settings.get('campaignBuilderDraft'),'');assert.equal(settings.get('sessionPrepDraft'),'');
sandbox.game.settings.set=savedSet;
console.log('In-flight linked saves finish before the clear and cannot restore deleted notes.');
