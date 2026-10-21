// Compatibility for version 1/2 drafts and older linked Session Prep data. No retired planner UI is loaded.
const SCOPE = "lore-smith";
const TYPES = { npc: "NPC", location: "Location", faction: "Faction", clue: "Structural clue", encounter: "Opposition / encounter", reward: "Reward", character: "Character", event: "Event", activity: "Activity", other: "Other" };
const STATUS = { active: "Active", dormant: "Dormant", resolved: "Resolved" };
const CLUE_STATUS = { prepared: "Prepared", delivered: "Delivered", unavailable: "Unavailable" };
const REVELATION_STATUS = { open: "Unresolved", understood: "Understood", retired: "No longer relevant" };
const CURRENT = { location: "Party location", objective: "Current objective", facts: "Established facts", questions: "Open campaign questions", theories: "Player theories · unconfirmed", discoveries: "Unresolved discoveries", priorities: "Preparation priorities" };
const SITUATION_DETAILS = { goals: "Competing goals", resources: "Available resources", trigger: "In-world trigger", warning: "Visible warning signs", consequence: "Consequences if unopposed", response: "How the party changed these intentions" };
const RESOURCE_DETAILS = { character: { ambitions: "Ambitions", relationships: "Fictional relationships", hooks: "Unresolved hooks", payoffs: "Potential payoffs" }, npc: { memorable: "Memorable detail", desire: "Immediate desire", leverage: "Leverage", knowledge: "Knowledge", assets: "Resources" }, faction: { goals: "Goals and rivals", assets: "Available resources", involvement: "Stakes and party involvement", intent: "Intended move without interference", trigger: "In-world trigger", warning: "Visible warning signs", consequence: "Consequences if unopposed", response: "Revised intentions after party action" } };
const PREP_NOTES = { characters: "Character opportunities", locations: "Fantastic location notes", npcs: "NPC notes", opposition: "Opposition and monster notes", rewards: "Reward notes" };
const id = () => globalThis.foundry?.utils.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "");
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === "string" ? value : "";
const array = (value) => Array.isArray(value) ? value : [];
const unique = (value) => [...new Set(array(value).filter((v) => typeof v === "string"))];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (value) => esc(value).replace(/\r?\n/g, "<br>");
const validUuid = (value) => /^[A-Za-z0-9_.-]+$/.test(value);
const documentLink = (r) => r.uuid && validUuid(r.uuid) ? `@UUID[${r.uuid}]{${esc(r.name).replace(/[{}]/g, "")}}` : esc(r.name);
const newPacket = () => ({ id: id(), title: "", opening: "", notes: "", characters: "", locations: "", npcs: "", opposition: "", rewards: "", scenes: [], secrets: [], revelationIds: [], situationIds: [], resourceIds: [], detail: null, detailJournalId: "", journalId: "" });
const newAfter = (nextIntent = "") => ({ summary: "", nextIntent, decisions: "", newFacts: "", worldChanges: "", rewardsGained: "", carryNotes: "", location: "", objective: "", updateLocation: false, updateObjective: false, changes: [], usedResourceIds: [] });
export const newWorkspaceSituation = () => ({ id: id(), title: "", status: "active", summary: "", stakes: "", leads: "", nextMove: "", resourceIds: [] });
export const newWorkspaceResource = () => ({ id: id(), name: "", kind: "npc", state: "", notes: "", uuid: "", discovered: false, relatedIds: [] });
export const newWorkspaceRevelation = () => ({ id: id(), title: "", conclusion: "", destinationId: "", essential: true, status: "open", understanding: "", clueIds: [] });

const strings = (record, keys) => { for (const key of keys) record[key] = text(record[key]); };
const normalized = (value) => text(value).trim().toLocaleLowerCase().replace(/\s+/g, " ");

// Diagnostic only: players can act on one useful clue. Methods on one source are not independent.
export function revelationCoverage(w, revelation) {
  const clues = w.resources.filter((r) => r.kind === "clue" && revelation.clueIds.includes(r.id));
  const usable = clues.filter((r) => r.clueStatus !== "unavailable" && r.notes.trim() && r.method.trim());
  const sources = new Set(), evidence = new Set();
  for (const r of usable) {
    const source = w.resources.find((other) => other.id === r.sourceId);
    const sourceKey = normalized(r.sourceGroup) || (source ? source.uuid || source.id : normalized(r.source));
    if (!sourceKey) continue;
    sources.add(sourceKey); evidence.add(normalized(r.notes));
  }
  return { clues: evidence.size, sources: sources.size, delivered: clues.filter((r) => r.clueStatus === "delivered").length, ready: evidence.size >= 3 && sources.size >= 3 };
}

// Add the workspace to the existing draft without removing Acts or their sessions.
export function ensureCampaignWorkspace(campaign) {
  const migrate = !campaign.workspace;
  campaign.workspace ??= {};
  const w = campaign.workspace;
  const upgrade = (Number(w.version) || 1) < 2;
  w.id ||= id(); w.partyIntent = text(w.partyIntent);
  strings(w, Object.keys(CURRENT));
  if (upgrade && !w.questions) w.questions = array(campaign.openQuestions).map((q) => text(q.text)).filter(Boolean).join("\n");
  w.situations = array(w.situations); w.resources = array(w.resources); w.history = array(w.history);
  for (const s of w.situations) {
    s.id ||= id();
    strings(s, ["title", "summary", "stakes", "leads", "nextMove", ...Object.keys(SITUATION_DETAILS)]);
    s.revelationIds = unique(s.revelationIds);
    s.status = STATUS[s.status] ? s.status : "active"; s.resourceIds = unique(s.resourceIds);
  }
  for (const r of w.resources) {
    r.id ||= id();
    strings(r, ["name", "state", "notes", "uuid", "source", "sourceId", "sourceGroup", "method", ...new Set(Object.values(RESOURCE_DETAILS).flatMap(Object.keys))]);
    // Legacy sourceId identifies an imported campaign record, not a clue's evidence source.
    if (upgrade && r.kind !== "clue" && r.sourceId) {
      const origin = ["people", "factions", "characters", "locations"].flatMap((key) => array(campaign[key])).find((entry) => entry.id === r.sourceId);
      if (origin) {
        for (const [key, old] of Object.entries({ ambitions: "desire", hooks: "complication", payoffs: "growth", memorable: "description", desire: "wants", knowledge: "knows", assets: "resources", goals: "goal", intent: "ignored" })) r[key] ||= text(origin[old]);
        r.relationships ||= [origin.npcConnection, origin.bond].filter(Boolean).join("\n");
      }
    }
    r.kind = TYPES[r.kind] ? r.kind : "other"; r.discovered = Boolean(r.discovered); r.relatedIds = unique(r.relatedIds);
    r.clueStatus = CLUE_STATUS[r.clueStatus] ? r.clueStatus : r.discovered ? "delivered" : "prepared";
  }
  w.prep ??= newPacket(); w.prep.id ||= id();
  strings(w.prep, ["title", "opening", "notes", "detailJournalId", "journalId", ...Object.keys(PREP_NOTES)]);
  w.prep.situationIds = unique(w.prep.situationIds); w.prep.resourceIds = unique(w.prep.resourceIds);
  w.prep.revelationIds = unique(w.prep.revelationIds);
  for (const key of ["scenes", "secrets"]) {
    w.prep[key] = array(w.prep[key]);
    for (const row of w.prep[key]) { row.id ||= id(); row.text = text(row.text); row.used = Boolean(row.used); row.carry = row.carry !== false; }
  }
  w.revelations = array(w.revelations);
  for (const r of w.revelations) {
    r.id ||= id(); strings(r, ["title", "conclusion", "destinationId", "understanding"]);
    r.essential = r.essential !== false; r.status = REVELATION_STATUS[r.status] ? r.status : "open"; r.clueIds = unique(r.clueIds);
  }
  w.connections = array(w.connections);
  for (const c of w.connections) { c.id ||= id(); strings(c, ["fromId", "toId", "description", "clueId"]); c.kind = c.kind === "lead" ? "lead" : "access"; }
  w.after ??= newAfter(w.partyIntent);
  w.after.summary = text(w.after.summary); w.after.nextIntent = text(w.after.nextIntent);
  strings(w.after, ["decisions", "newFacts", "worldChanges", "rewardsGained", "carryNotes", "location", "objective"]);
  w.after.updateLocation = Boolean(w.after.updateLocation); w.after.updateObjective = Boolean(w.after.updateObjective);
  w.after.changes = array(w.after.changes); w.after.usedResourceIds = unique(w.after.usedResourceIds);
  if (migrate) {
    for (const act of array(campaign.acts)) {
      const hasSessions = array(act.chapters).some((chapter) => array(chapter.sessions).some((session) => text(session.title).trim() || text(session.purpose).trim() || session.prep || session.journalId));
      const hasReferences = [act.actorRefs, act.itemRefs, act.journalRefs].some((refs) => array(refs).length);
      if (!hasSessions && !hasReferences && ![act.objective, act.startingSituation, act.gmNotes, act.actualOutcome, act.clues, act.developments].some((v) => text(v).trim())) continue;
      const s = { ...newWorkspaceSituation(), title: act.name || `Act ${act.number}`, summary: act.actualOutcome || act.startingSituation || act.objective || "", stakes: act.objective || "", leads: text(act.clues), nextMove: act.carryForward || text(act.developments), status: act.status === "completed" ? "resolved" : act.status === "locked" ? "dormant" : "active", sourceActId: act.id };
      for (const [key, kind] of [["actorRefs", "npc"], ["itemRefs", "reward"], ["journalRefs", "location"]]) {
        for (const ref of array(act[key])) {
          if (!ref.uuid) continue;
          let r = w.resources.find((entry) => entry.uuid === ref.uuid);
          if (!r) { r = { ...newWorkspaceResource(), name: ref.name || "Linked document", uuid: ref.uuid, kind }; w.resources.push(r); }
          s.resourceIds.push(r.id);
        }
      }
      w.situations.push(s);
    }
    if (!w.situations.length && text(campaign.problem?.wrong).trim()) w.situations.push({ ...newWorkspaceSituation(), title: "Opening situation", summary: campaign.problem.wrong, stakes: campaign.problem.stakes || "", leads: campaign.problem.involvement || "" });
    for (const [key, kind] of [["people", "npc"], ["factions", "faction"], ["locations", "location"], ["characters", "character"]]) {
      for (const entry of array(campaign[key]).filter((r) => text(r.name).trim())) {
        const notes = [entry.description, entry.goal, entry.wants, entry.secret, entry.involvement, entry.currentSituation].filter(Boolean).join("\n\n");
        w.resources.push({ ...newWorkspaceResource(), name: entry.name, kind, notes, state: entry.relationship || "", sourceId: entry.id });
      }
    }
    // Involvement is a GM hook, not necessarily the players' stated intention.
    w.after.nextIntent = w.partyIntent;
    return ensureCampaignWorkspace(campaign);
  }
  w.version = Math.max(2, Number(w.version) || 0);
  return w;
}

export function workspaceSelectedResources(campaign) {
  const w = ensureCampaignWorkspace(campaign);
  return w.resources.filter((r) => w.prep.resourceIds.includes(r.id));
}

export function selectWorkspaceSituation(campaign, situationId, selected = true) {
  const w = ensureCampaignWorkspace(campaign), s = w.situations.find((entry) => entry.id === situationId);
  if (!s) return w.prep;
  w.prep.situationIds = w.prep.situationIds.filter((v) => v !== situationId);
  if (selected) {
    w.prep.situationIds.push(situationId); w.prep.resourceIds = unique([...w.prep.resourceIds, ...s.resourceIds]);
    w.prep.revelationIds = unique([...w.prep.revelationIds, ...s.revelationIds]);
    if (!w.prep.title) w.prep.title = s.title;
  }
  return w.prep;
}

const allowedFields = { situation: ["status", "summary", "stakes", "leads", "nextMove", ...Object.keys(SITUATION_DETAILS)], resource: ["state", "notes", "discovered", "clueStatus", ...new Set(Object.values(RESOURCE_DETAILS).flatMap(Object.keys))], revelation: ["status", "understanding"] };
const fieldLabels = { ...SITUATION_DETAILS, ...Object.assign({}, ...Object.values(RESOURCE_DETAILS)), status: "Status", summary: "Current situation", stakes: "Stakes", leads: "Available leads", nextMove: "Next move", state: "Current state / next move", notes: "Notes / evidence", discovered: "Clue discovered", clueStatus: "Clue availability", understanding: "What the players understand" };
const collectionFor = (w, type) => type === "situation" ? w.situations : type === "resource" ? w.resources : type === "revelation" ? w.revelations : [];
const fieldsFor = (type, target) => (allowedFields[type] || []).filter((f) => type !== "resource" || ["state", "notes", ...(target?.kind === "clue" ? ["discovered", "clueStatus"] : []), ...Object.keys(RESOURCE_DETAILS[target?.kind] || {})].includes(f));

// Validate every change first, then apply the set and keep an immutable history snapshot.
export function applyCampaignWorkspaceAfterPlay(campaign) {
  const w = ensureCampaignWorkspace(campaign);
  if (!w.after.summary.trim()) throw new Error("Write a short note about what happened before recording play.");
  const targets = new Set();
  const changes = w.after.changes.map((change) => {
    const collection = collectionFor(w, change.targetType);
    const target = collection.find((r) => r.id === change.targetId);
    if (!target || !fieldsFor(change.targetType, target).includes(change.field)) throw new Error("Choose a record and a field for every change, or remove the unfinished change.");
    if (change.field === "discovered" && target.kind !== "clue") throw new Error("Discovery changes must target a clue.");
    if (change.field === "status" && !(change.targetType === "revelation" ? REVELATION_STATUS : STATUS)[change.value]) throw new Error("Choose a valid status for the record.");
    if (change.field === "clueStatus" && !CLUE_STATUS[change.value]) throw new Error("Choose Prepared, Delivered, or Unavailable for the clue.");
    const key = `${change.targetType}:${change.targetId}:${["discovered", "clueStatus"].includes(change.field) ? "clueStatus" : change.field}`;
    if (targets.has(key)) throw new Error("Keep one final value for each changed field.");
    targets.add(key);
    const value = change.field === "discovered" ? change.value === true || change.value === "true" : text(change.value);
    return { ...copy(change), targetName: target.title || target.name || "Unnamed record", before: target[change.field], value };
  });
  const entry = { ...copy(w.after), id: id(), date: new Date().toISOString(), summary: w.after.summary.trim(), nextIntent: w.after.nextIntent.trim(), changes, prep: copy(w.prep), usedResourceIds: [...w.after.usedResourceIds], currentBefore: Object.fromEntries([...Object.keys(CURRENT), "partyIntent"].map((key) => [key, w[key]])), tableContent: packetContent(campaign) };
  for (const change of changes) {
    const target = collectionFor(w, change.targetType).find((r) => r.id === change.targetId);
    target[change.field] = change.value;
    if (change.field === "discovered") target.clueStatus = change.value ? "delivered" : "prepared";
    if (change.field === "clueStatus") target.discovered = change.value === "delivered";
  }
  if (w.after.newFacts.trim()) w.facts = [w.facts, w.after.newFacts.trim()].filter(Boolean).join("\n");
  if (w.after.updateLocation) w.location = w.after.location.trim();
  if (w.after.updateObjective) w.objective = w.after.objective.trim();
  w.history.push(entry); w.partyIntent = entry.nextIntent;
  const unused = w.prep.resourceIds.filter((rid) => !w.after.usedResourceIds.includes(rid));
  const active = w.prep.situationIds.filter((sid) => w.situations.some((s) => s.id === sid && s.status === "active"));
  w.prep = { ...newPacket(), resourceIds: unused, situationIds: active, notes: w.after.carryNotes, scenes: copy(w.prep.scenes.filter((r) => r.carry && !r.used)), secrets: copy(w.prep.secrets.filter((r) => r.carry && !r.used)), revelationIds: w.prep.revelationIds.filter((rid) => w.revelations.some((r) => r.id === rid && r.status === "open")) }; w.after = newAfter(w.partyIntent);
  return entry;
}


const sourceName = (w, r) => w.resources.find((n) => n.id === r.sourceId)?.name || r.source || "Source not set";
const AFTER_NOTES = { decisions: "Consequential decisions", newFacts: "New confirmed facts", worldChanges: "World changes", rewardsGained: "Rewards actually gained", carryNotes: "Notes worth carrying forward" };
function historyContent(h) {
  return `<h3>${esc(h.prep?.title || "Game notes")} · ${esc(h.date)}</h3>${block("What happened", h.summary)}${Object.entries(AFTER_NOTES).map(([key, label]) => block(label, h[key])).join("")}${block("Next intention", h.nextIntent)}${h.updateLocation ? block("Party location after play", h.location) : ""}${h.updateObjective ? block("Objective after play", h.objective) : ""}<ul>${array(h.changes).map((c) => `<li>${esc(c.targetName)} · ${esc(fieldLabels[c.field] || c.field)}: ${esc(c.before)} → ${esc(c.value)}${c.reason ? ` (${esc(c.reason)})` : ""}</li>`).join("")}</ul>${h.tableContent ? `<details><summary>Preparation as it stood before recording</summary>${h.tableContent}</details>` : `<details><summary>Saved preparation</summary>${block("Opening", h.prep?.opening)}${block("GM reminders", h.prep?.notes)}</details>`}`;
}

const block = (title, value) => value ? `<h3>${esc(title)}</h3><p>${lines(value)}</p>` : "";
function resourceContent(w, r) {
  return block("Current state", r.state) + block(r.kind === "clue" ? "Evidence (fixed)" : "GM notes", r.notes)
    + Object.entries(RESOURCE_DETAILS[r.kind] || {}).map(([key, title]) => block(title, r[key])).join("")
    + (r.kind === "clue" ? block("Source", sourceName(w, r)) + block("Shared source / failure group", r.sourceGroup) + block("Discovery method", r.method) + block("Availability", CLUE_STATUS[r.clueStatus]) : "");
}
function revelationContent(w, r) {
  const destination = w.resources.find((n) => n.id === r.destinationId);
  return `<section><h2>${esc(r.title || "Untitled revelation")}</h2><p>${r.essential ? "Essential" : "Optional"} · ${REVELATION_STATUS[r.status]}</p>${block("Conclusion or destination", r.conclusion)}${destination ? `<p>Destination: ${documentLink(destination)}</p>` : ""}${block("What the players understand", r.understanding)}<p>Supporting evidence: ${w.resources.filter((c) => c.kind === "clue" && r.clueIds.includes(c.id)).map((c) => `${esc(c.name || "Unnamed clue")} (${CLUE_STATUS[c.clueStatus]})`).join("; ") || "None linked"}. See the maintained clue records below.</p><p>${revelationCoverage(w, r).clues} distinct usable clues / ${revelationCoverage(w, r).sources} source groups. One useful clue is enough to act.</p></section>`;
}
function situationContent(w, s) {
  return `<section><h2>${esc(s.title || "Untitled situation")}</h2><p>${STATUS[s.status]}</p>${block("Current situation", s.summary)}${block("Stakes and party involvement", s.stakes)}${block("Available leads", s.leads)}${block("Intended next move", s.nextMove)}${Object.entries(SITUATION_DETAILS).map(([key, title]) => block(title, s[key])).join("")}<p>${w.resources.filter((r) => s.resourceIds.includes(r.id)).map(documentLink).join(" · ")}</p><p>${w.revelations.filter((r) => s.revelationIds.includes(r.id)).map((r) => esc(r.title)).join(" · ")}</p></section>`;
}
function connectionContent(w, ids = null) {
  return w.connections.filter((c) => !ids || ids.includes(c.fromId) || ids.includes(c.toId)).map((c) => {
    const from = w.resources.find((r) => r.id === c.fromId), to = w.resources.find((r) => r.id === c.toId), clue = w.resources.find((r) => r.id === c.clueId && r.kind === "clue");
    return `<p>${esc(from?.name || "Source not set")} → ${esc(to?.name || "Destination not set")} · ${c.kind === "access" ? "Ordinary access" : "Lead"}: ${c.kind === "lead" && clue ? `see structural clue ${esc(clue.name)} (${CLUE_STATUS[clue.clueStatus]})` : lines(c.description)}</p>`;
  }).join("");
}
function packetContent(campaign) {
  const w = ensureCampaignWorkspace(campaign), p = w.prep;
  const revelations = w.revelations.filter((r) => p.revelationIds.includes(r.id));
  const resourceIds = unique([...p.resourceIds, ...revelations.flatMap((r) => r.clueIds)]);
  // Include canonical evidence referenced by routes touching prepared nodes as well.
  for (const c of w.connections) if (c.kind === "lead" && (resourceIds.includes(c.fromId) || resourceIds.includes(c.toId)) && c.clueId && !resourceIds.includes(c.clueId)) resourceIds.push(c.clueId);
  const resources = w.resources.filter((r) => resourceIds.includes(r.id));
  const records = (kinds) => resources.filter((r) => kinds.includes(r.kind)).map((r) => `<section><h3>${documentLink(r)}</h3>${resourceContent(w, r)}</section>`).join("");
  const prepList = (key) => p[key].filter((r) => r.text.trim()).map((r) => `<li>${lines(r.text)}${r.used ? " · Used" : ""}${r.carry && !r.used ? " · Carry if unused" : ""}</li>`).join("");
  return block("Party location", w.location) + block("Current objective", w.objective) + block("Players’ intention", w.partyIntent)
    + `<h2>1 · Review the characters</h2>${block("Character opportunities", p.characters)}${records(["character"])}<h2>2 · Prepare a strong start</h2>${block("Opening", p.opening)}<h2>3 · Possible scenes (optional)</h2><ul>${prepList("scenes")}</ul><h2>4 · Secrets and clues</h2><h3>Flexible secrets</h3><ul>${prepList("secrets")}</ul>${revelations.map((r) => revelationContent(w, r)).join("")}<h3>Structural clue records</h3>${records(["clue"])}<h2>5 · Fantastic locations</h2>${block("Location notes", p.locations)}${records(["location", "event", "activity", "other"])}<h2>6 · Important NPCs</h2>${block("NPC notes", p.npcs)}${records(["npc", "faction"])}<h2>7 · Opposition and monsters</h2>${block("Opposition notes", p.opposition)}${records(["encounter"])}<h2>8 · Rewards</h2>${block("Reward notes", p.rewards)}${records(["reward"])}${block("GM reminders", p.notes)}<h2>Situations in focus</h2>${w.situations.filter((s) => p.situationIds.includes(s.id)).map((s) => situationContent(w, s)).join("")}<h2>Routes and leads</h2>${connectionContent(w, resourceIds)}`;
}
export function campaignWorkspaceJournalPages(campaign) {
  const w = ensureCampaignWorkspace(campaign);
  return [
    { key: "workspace-board", name: "Campaign Board", content: `<h1>${esc(campaign.name || "Campaign")}</h1>${block("Premise", campaign.premise)}${block("GM background", campaign.background)}${block("Character involvement", campaign.characterHooks)}${Object.entries(CURRENT).map(([key, title]) => block(title, w[key])).join("")}${block("Players’ next intention", w.partyIntent)}${w.situations.map((s) => situationContent(w, s)).join("")}<h2>Revelations</h2>${w.revelations.map((r) => revelationContent(w, r)).join("")}<h2>Resources and maintained evidence</h2>${w.resources.map((r) => `<section><h2>${documentLink(r)}</h2><p>${TYPES[r.kind]}</p>${resourceContent(w, r)}</section>`).join("")}<h2>Routes and leads</h2>${connectionContent(w)}` },
    { key: "workspace-prep", name: "Prepare next game", content: packetContent(campaign) },
    { key: "workspace-history", name: "After play · Campaign history", content: w.history.map((h) => `<section>${historyContent(h)}</section>`).join("") || "<p>No play recorded yet.</p>" },
  ];
}

