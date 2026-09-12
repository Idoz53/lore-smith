const SCOPE = "lore-smith";
const TYPES = { npc: "NPC", location: "Location", faction: "Faction", clue: "Clue", encounter: "Encounter", reward: "Reward", character: "Character connection", other: "Other" };
const STATUS = { active: "Active", dormant: "Dormant", resolved: "Resolved" };
const id = () => globalThis.foundry?.utils.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "");
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => typeof value === "string" ? value : "";
const array = (value) => Array.isArray(value) ? value : [];
const unique = (value) => [...new Set(array(value).filter((v) => typeof v === "string"))];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (value) => esc(value).replace(/\r?\n/g, "<br>");
const validUuid = (value) => /^[A-Za-z0-9_.-]+$/.test(value);
const documentLink = (r) => r.uuid && validUuid(r.uuid) ? `@UUID[${r.uuid}]{${esc(r.name).replace(/[{}]/g, "")}}` : esc(r.name);
const newPacket = () => ({ id: id(), title: "", opening: "", notes: "", situationIds: [], resourceIds: [], detail: null, detailJournalId: "", journalId: "" });
const newAfter = (nextIntent = "") => ({ summary: "", nextIntent, changes: [], usedResourceIds: [] });
export const newWorkspaceSituation = () => ({ id: id(), title: "", status: "active", summary: "", stakes: "", leads: "", nextMove: "", resourceIds: [] });
export const newWorkspaceResource = () => ({ id: id(), name: "", kind: "npc", state: "", notes: "", uuid: "", discovered: false, relatedIds: [] });

// Add the workspace to the existing draft without removing Acts or their sessions.
export function ensureCampaignWorkspace(campaign) {
  const migrate = !campaign.workspace;
  campaign.workspace ??= {};
  const w = campaign.workspace;
  w.version = 1; w.id ||= id(); w.partyIntent = text(w.partyIntent);
  w.situations = array(w.situations); w.resources = array(w.resources); w.history = array(w.history);
  for (const s of w.situations) {
    s.id ||= id();
    for (const key of ["title", "summary", "stakes", "leads", "nextMove"]) s[key] = text(s[key]);
    s.status = STATUS[s.status] ? s.status : "active"; s.resourceIds = unique(s.resourceIds);
  }
  for (const r of w.resources) {
    r.id ||= id();
    for (const key of ["name", "state", "notes", "uuid"]) r[key] = text(r[key]);
    r.kind = TYPES[r.kind] ? r.kind : "other"; r.discovered = Boolean(r.discovered); r.relatedIds = unique(r.relatedIds);
  }
  w.prep ??= newPacket(); w.prep.id ||= id();
  for (const key of ["title", "opening", "notes", "detailJournalId", "journalId"]) w.prep[key] = text(w.prep[key]);
  w.prep.situationIds = unique(w.prep.situationIds); w.prep.resourceIds = unique(w.prep.resourceIds);
  w.after ??= newAfter(w.partyIntent);
  w.after.summary = text(w.after.summary); w.after.nextIntent = text(w.after.nextIntent);
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
    w.partyIntent = text(campaign.problem?.involvement); w.after.nextIntent = w.partyIntent;
  }
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
    if (!w.prep.title) w.prep.title = s.title;
  }
  return w.prep;
}

const allowedFields = { situation: ["status", "summary", "stakes", "leads", "nextMove"], resource: ["state", "notes", "discovered"] };
const fieldLabels = { status: "Status", summary: "Current situation", stakes: "Stakes", leads: "Available leads", nextMove: "Next move", state: "Current state / next move", notes: "Notes", discovered: "Clue discovered" };

// Validate every change first, then apply the set and keep an immutable history snapshot.
export function applyCampaignWorkspaceAfterPlay(campaign) {
  const w = ensureCampaignWorkspace(campaign);
  if (!w.after.summary.trim()) throw new Error("Write a short note about what happened before recording play.");
  const targets = new Set();
  const changes = w.after.changes.map((change) => {
    const collection = change.targetType === "situation" ? w.situations : change.targetType === "resource" ? w.resources : [];
    const target = collection.find((r) => r.id === change.targetId);
    if (!target || !allowedFields[change.targetType]?.includes(change.field)) throw new Error("Choose a record and a field for every change, or remove the unfinished change.");
    if (change.field === "discovered" && target.kind !== "clue") throw new Error("Discovery changes must target a clue.");
    if (change.field === "status" && !STATUS[change.value]) throw new Error("Choose Active, Dormant, or Resolved for the situation status.");
    const key = `${change.targetType}:${change.targetId}:${change.field}`;
    if (targets.has(key)) throw new Error("Keep one final value for each changed field.");
    targets.add(key);
    const value = change.field === "discovered" ? change.value === true || change.value === "true" : text(change.value);
    return { ...copy(change), targetName: target.title || target.name || "Unnamed record", before: target[change.field], value };
  });
  const entry = { id: id(), date: new Date().toISOString(), summary: w.after.summary.trim(), nextIntent: w.after.nextIntent.trim(), changes, prep: copy(w.prep), usedResourceIds: [...w.after.usedResourceIds] };
  for (const change of changes) (change.targetType === "situation" ? w.situations : w.resources).find((r) => r.id === change.targetId)[change.field] = change.value;
  w.history.push(entry); w.partyIntent = entry.nextIntent;
  const unused = w.prep.resourceIds.filter((rid) => !w.after.usedResourceIds.includes(rid));
  const active = w.prep.situationIds.filter((sid) => w.situations.some((s) => s.id === sid && s.status === "active"));
  w.prep = { ...newPacket(), resourceIds: unused, situationIds: active }; w.after = newAfter(w.partyIntent);
  return entry;
}

const button = (action, label, extra = "") => `<button type="button" data-cw-action="${action}" ${extra}>${label}</button>`;
const input = (label, attr, value = "", placeholder = "") => `<label>${label}<input ${attr} value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
const area = (label, attr, value = "", placeholder = "") => `<label>${label}<textarea ${attr} rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
const options = (items, current) => Object.entries(items).map(([value, label]) => `<option value="${esc(value)}" ${String(current) === value ? "selected" : ""}>${esc(label)}</option>`).join("");
const select = (label, attr, items, current) => `<label>${label}<select ${attr}>${options(items, current)}</select></label>`;
const recordButton = (record, type = "resource") => button("inspect", esc(record.title || record.name || "Unnamed record"), `data-type="${type}" data-id="${esc(record.id)}" class="ls-cw-link"`);
const checklist = (items, selected, attr, titleKey = "name") => items.map((r) => `<label class="ls-cw-check"><input type="checkbox" ${attr} value="${esc(r.id)}" ${selected.includes(r.id) ? "checked" : ""}><span>${esc(r[titleKey] || "Unnamed record")}</span></label>`).join("");

function situationEditor(w, s) {
  return `<article data-cw-situation="${esc(s.id)}" class="ls-cw-editor"><div class="ls-cw-row">${input("Situation title", 'data-cw-field="title"', s.title, "What can the party engage with?")}${select("Status", 'data-cw-field="status"', STATUS, s.status)}</div>
    ${area("What is happening?", 'data-cw-field="summary"', s.summary)}${area("Why does it matter to the party?", 'data-cw-field="stakes"', s.stakes)}${area("Leads the players can follow", 'data-cw-field="leads"', s.leads)}${area("What might happen next?", 'data-cw-field="nextMove"', s.nextMove)}
    <details><summary>Link people, places, clues &amp; other material</summary><div class="ls-cw-checklist">${checklist(w.resources, s.resourceIds, "data-cw-situation-resource") || '<p>Add a resource to the campaign, then link it here.</p>'}</div></details>
    <div class="ls-cw-links">${w.resources.filter((r) => s.resourceIds.includes(r.id)).map((r) => recordButton(r)).join("")}</div>${button("prepare", "Prepare this situation →", `data-id="${esc(s.id)}" class="ls-cw-primary"`)}</article>`;
}

function resourceEditor(w, r) {
  const linked = w.situations.filter((s) => s.resourceIds.includes(r.id));
  return `<article data-cw-resource="${esc(r.id)}" class="ls-cw-editor"><div class="ls-cw-row">${input("Name", 'data-cw-field="name"', r.name)}${select("Kind", 'data-cw-field="kind"', TYPES, r.kind)}</div>
    ${area(r.kind === "faction" ? "Current goal / next move" : "Current state", 'data-cw-field="state"', r.state)}${area("Description, motives, or GM notes", 'data-cw-field="notes"', r.notes)}
    ${r.kind === "clue" ? `<label class="ls-cw-check"><input type="checkbox" data-cw-field="discovered" ${r.discovered ? "checked" : ""}>Discovered by the party</label><small>This records knowledge. Foundry sharing permissions remain under your control.</small>` : ""}
    <div class="ls-cw-drop" data-cw-drop="${esc(r.id)}">${input("Linked Foundry document", 'data-cw-field="uuid"', r.uuid, "Drop an Actor, Scene, Journal, Item, or Playlist here")}${r.uuid ? button("open-document", "Open linked document", `data-id="${esc(r.id)}"`) : ""}</div>
    <details><summary>Related campaign resources</summary><div class="ls-cw-checklist">${checklist(w.resources.filter((other) => other.id !== r.id), r.relatedIds, "data-cw-related-resource") || '<p>No other resources yet.</p>'}</div></details>
    <div class="ls-cw-section"><strong>Connected to</strong><div class="ls-cw-links">${linked.map((s) => recordButton(s, "situation")).join("") || '<span>No situation linked yet.</span>'}</div><small>${w.prep.resourceIds.includes(r.id) ? "Included in next game’s preparation." : "Available for future preparation."}</small></div>${button("remove-resource", "Remove resource", `data-id="${esc(r.id)}" class="ls-cw-secondary"`)}</article>`;
}

function board(campaign, w, state) {
  const s = w.situations.find((entry) => entry.id === state.selectedId), r = w.resources.find((entry) => entry.id === state.selectedId);
  return `<div class="ls-cw-foundation">${input("Campaign name", 'name="campaignName"', campaign.name, "Your campaign’s name")}${area("What do the players want to pursue next?", 'data-cw-workspace="partyIntent"', w.partyIntent)}
    <details><summary>Premise, GM truth &amp; character connections</summary><div class="ls-cw-editor">${area("Premise", 'name="campaignPremise"', campaign.premise)}${area("Current problem", 'name="campaignProblemWrong"', campaign.problem?.wrong)}${area("GM truth and background", 'name="campaignBackground"', campaign.background)}${area("Why the characters care", 'name="campaignCharacterHooks"', campaign.characterHooks)}${input("Tone", 'name="campaignTone"', campaign.tone)}</div></details></div>
    <div class="ls-cw-columns"><div><div class="ls-cw-row"><h2>Campaign situations</h2>${button("add-situation", "+ Situation")}</div><div class="ls-cw-index">${[...w.situations].sort((a, b) => ["active", "dormant", "resolved"].indexOf(a.status) - ["active", "dormant", "resolved"].indexOf(b.status)).map((entry) => `<div class="${state.selectedId === entry.id ? "selected" : ""}">${recordButton(entry, "situation")}<small>${STATUS[entry.status]}</small>${entry.summary ? `<p>${esc(entry.summary.length > 140 ? entry.summary.slice(0, 140) + "…" : entry.summary)}</p>` : ""}</div>`).join("") || '<p class="ls-cw-empty">Start with one situation: what is happening, why it matters, and what the party can do.</p>'}</div>
    <div class="ls-cw-section"><div class="ls-cw-row"><h2>People, places &amp; resources</h2>${button("add-resource", "+ Resource")}</div><div class="ls-cw-index">${w.resources.map((entry) => `<div class="${state.selectedId === entry.id ? "selected" : ""}">${recordButton(entry)}<small>${TYPES[entry.kind]}${entry.kind === "clue" ? entry.discovered ? " · Discovered" : " · GM only" : ""}</small></div>`).join("") || '<p class="ls-cw-empty">Add reusable NPCs, places, factions, clues, encounters, and rewards. Drop existing Foundry documents into a resource.</p>'}</div></div></div>
    <div>${s ? situationEditor(w, s) : r ? resourceEditor(w, r) : '<div class="ls-cw-empty"><h2>Prepare what matters next</h2><p>Select a situation or resource to edit it. The same record stays linked through preparation and after play.</p></div>'}</div></div>`;
}

function prep(campaign, w) {
  return `<div class="ls-cw-columns"><div class="ls-cw-editor">${input("Preparation title", 'data-cw-prep="title"', w.prep.title, "Next game")}${area("Players’ next intention", 'data-cw-workspace="partyIntent"', w.partyIntent)}${area("Opening situation", 'data-cw-prep="opening"', w.prep.opening)}${area("GM reminders", 'data-cw-prep="notes"', w.prep.notes)}
    <div class="ls-cw-section"><h2>Situations in focus</h2><div class="ls-cw-checklist">${checklist(w.situations.filter((s) => s.status !== "resolved" || w.prep.situationIds.includes(s.id)), w.prep.situationIds, "data-cw-prep-situation", "title") || '<p>Add a situation on the Campaign Board first.</p>'}</div></div>
    <div class="ls-cw-section"><h2>Choose material for this game</h2><small>Choosing a situation includes its linked resources. Adjust the selection as needed.</small><div class="ls-cw-checklist">${checklist(w.resources, w.prep.resourceIds, "data-cw-prep-resource") || '<p>Resources linked on the board appear here.</p>'}</div></div></div>
    <div class="ls-cw-editor"><h2>At the table</h2>${w.prep.opening ? `<p>${lines(w.prep.opening)}</p>` : '<p>Add an opening, then keep useful material close at hand.</p>'}
    ${workspaceSelectedResources(campaign).map((r) => `<section class="ls-cw-table-record"><div class="ls-cw-row">${recordButton(r)}<small>${TYPES[r.kind]}</small>${r.uuid ? button("open-document", "Open", `data-id="${esc(r.id)}"`) : ""}</div>${r.state ? `<p>${lines(r.state)}</p>` : ""}${r.notes ? `<details><summary>GM notes${r.kind === "clue" ? r.discovered ? " · discovered clue" : " · undiscovered clue" : ""}</summary><p>${lines(r.notes)}</p></details>` : ""}</section>`).join("")}
    <div class="ls-cw-section">${button("table-journal", w.prep.journalId ? "Update table notes Journal" : "Create table notes Journal", 'class="ls-cw-primary"')}${w.prep.journalId ? button("open-table-journal", "Open table notes") : ""}<button type="button" data-action="openCampaignWorkspacePrep">More detailed Session Prep →</button>${w.prep.detailJournalId ? button("open-detail-journal", "Open detailed Session Journal") : ""}${button("tab", "After play →", 'data-tab="after"')}</div></div></div>`;
}

function after(w) {
  const targets = Object.fromEntries([["", "Choose a record"], ...w.situations.map((s) => [`situation:${s.id}`, `Situation · ${s.title || "Untitled"}`]), ...w.resources.map((r) => [`resource:${r.id}`, `${TYPES[r.kind]} · ${r.name || "Unnamed"}`])]);
  return `<div class="ls-cw-editor">${area("What actually happened?", 'data-cw-after="summary"', w.after.summary, "Decisions, discoveries, relationships, and consequences.")}${area("What do the players want to pursue next?", 'data-cw-after="nextIntent"', w.after.nextIntent)}
    <div class="ls-cw-row"><h2>Changes to the campaign</h2>${button("add-change", "+ Change")}</div><p>Choose the changes supported by play. Faction moves advance only when you record them.</p>
    ${w.after.changes.map((c) => {
      const target = (c.targetType === "situation" ? w.situations : w.resources).find((r) => r.id === c.targetId);
      const fields = Object.fromEntries((allowedFields[c.targetType] || []).filter((f) => f !== "discovered" || target?.kind === "clue").map((f) => [f, fieldLabels[f]]));
      return `<div class="ls-cw-change" data-cw-change="${esc(c.id)}"><div class="ls-cw-row">${select("Affected record", 'data-cw-change-field="target"', targets, c.targetId ? `${c.targetType}:${c.targetId}` : "")}${select("What changes?", 'data-cw-change-field="field"', fields, c.field)}</div><small>Before: ${esc(target?.[c.field] ?? "—")}</small>${c.field === "status" ? select("After", 'data-cw-change-field="value"', STATUS, c.value) : c.field === "discovered" ? select("After", 'data-cw-change-field="value"', { true: "Discovered", false: "Not discovered" }, c.value) : area("After", 'data-cw-change-field="value"', c.value)}${input("Why did this change?", 'data-cw-change-field="reason"', c.reason, "Observed event or a consequence you decided")}${button("remove-change", "Remove change", `data-id="${esc(c.id)}"`)}</div>`;
    }).join("")}
    <details><summary>Which prepared resources were used?</summary><p>Unused selections carry into the next preparation. All resources remain on the board.</p><div class="ls-cw-checklist">${checklist(w.resources.filter((r) => w.prep.resourceIds.includes(r.id)), w.after.usedResourceIds, "data-cw-used-resource") || '<p>No material selected for this game.</p>'}</div></details>
    ${button("record-play", "Record play and update the board →", 'class="ls-cw-primary"')}</div>
    <details class="ls-cw-section"><summary>Campaign history · ${w.history.length} entries</summary>${[...w.history].reverse().map((h) => `<article class="ls-cw-history"><h3>${esc(h.prep.title || "Game notes")} · ${esc(new Date(h.date).toLocaleDateString())}</h3><p>${lines(h.summary)}</p><p><strong>Next intention:</strong> ${lines(h.nextIntent)}</p><ul>${h.changes.map((c) => `<li>${esc(c.targetName)} · ${esc(fieldLabels[c.field] || c.field)}: ${esc(c.before)} → ${esc(c.value)}${c.reason ? ` (${esc(c.reason)})` : ""}</li>`).join("")}</ul>${h.prep.journalId ? button("history-journal", "Open this game’s table notes", `data-id="${esc(h.prep.journalId)}"`) : ""}${h.prep.detailJournalId ? button("history-journal", "Open detailed Session Journal", `data-id="${esc(h.prep.detailJournalId)}"`) : ""}</article>`).join("") || '<p>Recorded play and confirmed changes will appear here.</p>'}</details>`;
}

export function renderCampaignWorkspace(campaign, state = {}) {
  const w = ensureCampaignWorkspace(campaign), tab = ["board", "prep", "after"].includes(state.tab) ? state.tab : "board";
  return `<section class="ls-panel ls-cw" data-campaign-workspace><header><div><span>Living campaign workspace</span><h1>Campaign Builder</h1></div><div class="ls-header-actions"><button type="button" data-action="createCampaignJournal">Create / update campaign Journal</button></div></header>
    <nav class="ls-cw-tabs" aria-label="Campaign workflow">${Object.entries({ board: "Campaign Board", prep: "Prepare next game", after: "After play" }).map(([key, label]) => button("tab", label, `data-tab="${key}" aria-pressed="${tab === key}"`)).join("")}</nav>
    ${tab === "board" ? board(campaign, w, state) : tab === "prep" ? prep(campaign, w) : after(w)}
    <footer class="ls-cw-footer">${button("planner", "Session x Session", `aria-expanded="${Boolean(state.planner)}"`)}<small>Optional Acts, chapters, and session planning. Existing plans remain available.</small><span data-cw-save aria-live="polite"></span></footer></section>`;
}

export function syncCampaignWorkspace(campaign, root) {
  const w = ensureCampaignWorkspace(campaign), container = root?.querySelector("[data-campaign-workspace]");
  if (!container) return w;
  for (const [selector, target, name] of [["[data-cw-workspace]", w, "cwWorkspace"], ["[data-cw-prep]", w.prep, "cwPrep"], ["[data-cw-after]", w.after, "cwAfter"]]) container.querySelectorAll(selector).forEach((el) => { const key = el.dataset[name]; if (Object.hasOwn(target, key)) target[key] = el.value; });
  for (const [selector, collection, dataKey] of [["[data-cw-situation]", w.situations, "cwSituation"], ["[data-cw-resource]", w.resources, "cwResource"]]) {
    container.querySelectorAll(selector).forEach((card) => {
      const record = collection.find((r) => r.id === card.dataset[dataKey]); if (!record) return;
      card.querySelectorAll("[data-cw-field]").forEach((el) => { const key = el.dataset.cwField; if (Object.hasOwn(record, key)) record[key] = el.type === "checkbox" ? el.checked : el.value; });
      if (dataKey === "cwSituation") record.resourceIds = [...card.querySelectorAll("[data-cw-situation-resource]:checked")].map((el) => el.value);
      else record.relatedIds = [...card.querySelectorAll("[data-cw-related-resource]:checked")].map((el) => el.value);
    });
  }
  container.querySelectorAll("[data-cw-change]").forEach((card) => {
    const c = w.after.changes.find((entry) => entry.id === card.dataset.cwChange); if (!c) return;
    const get = (key) => card.querySelector(`[data-cw-change-field="${key}"]`)?.value;
    const [type, target] = (get("target") || "").split(":");
    if (type !== c.targetType || (target || "") !== c.targetId) { c.targetType = type || ""; c.targetId = target || ""; c.field = type === "situation" ? "status" : "state"; c.value = type === "situation" ? "active" : ""; }
    else if (get("field") && get("field") !== c.field) { c.field = get("field"); c.value = c.field === "status" ? "active" : c.field === "discovered" ? "true" : ""; }
    else if (get("value") !== undefined) c.value = get("value");
    c.reason = get("reason") ?? c.reason;
  });
  if (container.querySelector("[data-cw-used-resource]")) w.after.usedResourceIds = [...container.querySelectorAll("[data-cw-used-resource]:checked")].map((el) => el.value);
  return w;
}

function packetContent(campaign) {
  const w = ensureCampaignWorkspace(campaign), block = (title, value) => value ? `<h2>${esc(title)}</h2><p>${lines(value)}</p>` : "";
  return block("Players’ intention", w.partyIntent) + block("Opening", w.prep.opening) + block("GM reminders", w.prep.notes)
    + w.situations.filter((s) => w.prep.situationIds.includes(s.id)).map((s) => `<section><h2>${esc(s.title)}</h2><p>${lines(s.summary)}</p>${block("Stakes", s.stakes)}${block("Available leads", s.leads)}${block("Possible next move", s.nextMove)}</section>`).join("")
    + workspaceSelectedResources(campaign).map((r) => `<section><h2>${documentLink(r)}</h2><p>${TYPES[r.kind]}${r.kind === "clue" ? r.discovered ? " · Discovered" : " · GM only" : ""}</p>${block("Current state", r.state)}${block("GM notes", r.notes)}</section>`).join("");
}

export function campaignWorkspaceJournalPages(campaign) {
  const w = ensureCampaignWorkspace(campaign);
  return [
    { key: "workspace-board", name: "Campaign Board", content: `<h1>${esc(campaign.name || "Campaign")}</h1><h2>Players’ next intention</h2><p>${lines(w.partyIntent)}</p>${w.situations.map((s) => `<section><h2>${esc(s.title || "Untitled situation")}</h2><p>${STATUS[s.status]}</p><p>${lines(s.summary)}</p><h3>Stakes</h3><p>${lines(s.stakes)}</p><h3>Leads</h3><p>${lines(s.leads)}</p><h3>Possible next move</h3><p>${lines(s.nextMove)}</p><p>${w.resources.filter((r) => s.resourceIds.includes(r.id)).map(documentLink).join(" · ")}</p></section>`).join("")}${w.resources.map((r) => `<section><h2>${documentLink(r)}</h2><p>${TYPES[r.kind]} · ${lines(r.state)}</p><p>${lines(r.notes)}</p></section>`).join("")}` },
    { key: "workspace-prep", name: "Prepare next game", content: packetContent(campaign) || "<p>No preparation selected yet.</p>" },
    { key: "workspace-history", name: "After play · Campaign history", content: w.history.map((h) => `<section><h2>${esc(h.prep.title || "Game notes")} · ${esc(h.date)}</h2><p>${lines(h.summary)}</p><p><strong>Next intention:</strong> ${lines(h.nextIntent)}</p><ul>${h.changes.map((c) => `<li>${esc(c.targetName)} · ${esc(fieldLabels[c.field])}: ${esc(c.before)} → ${esc(c.value)}${c.reason ? ` — ${esc(c.reason)}` : ""}</li>`).join("")}</ul></section>`).join("") || "<p>No play recorded yet.</p>" },
  ];
}

export function bindCampaignWorkspace(app) {
  const root = app.element?.querySelector("[data-campaign-workspace]");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "true";
  const save = async () => { await app.syncCampaignForm(); const status = root.querySelector("[data-cw-save]"); if (status) status.textContent = "Saved"; };
  const render = () => app.renderCampaignPreservingScroll();
  const fail = (error) => { console.error("Lore Smith | Campaign workspace", error); globalThis.ui?.notifications.error(error.message || "The campaign could not be saved. Your edits remain open."); };
  let busy = false;
  root.addEventListener("input", () => { clearTimeout(app.campaignSaveTimer); app.campaignSaveTimer = setTimeout(() => save().catch(fail), 350); });
  root.addEventListener("change", async (event) => {
    try {
      clearTimeout(app.campaignSaveTimer); await save();
      const el = event.target, w = ensureCampaignWorkspace(app.campaign);
      if (el.matches("[data-cw-prep-situation]")) { selectWorkspaceSituation(app.campaign, el.value, el.checked); await app.saveCampaignDraft(); await render(); }
      else if (el.matches("[data-cw-prep-resource]")) { w.prep.resourceIds = w.prep.resourceIds.filter((v) => v !== el.value); if (el.checked) w.prep.resourceIds.push(el.value); await app.saveCampaignDraft(); await render(); }
      else if (el.matches('[data-cw-field="kind"], [data-cw-change-field="target"], [data-cw-change-field="field"]')) await render();
    } catch (error) { fail(error); }
  });
  const openJournal = async (journalId) => {
    const journal = game.journal.get(journalId); if (!journal) throw new Error("This Journal is no longer available.");
    journal.sheet.render(true);
  };
  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-cw-action]"); if (!target || busy) return;
    event.preventDefault(); busy = true;
    try {
      clearTimeout(app.campaignSaveTimer); await save();
      const w = ensureCampaignWorkspace(app.campaign), state = app.campaignWorkspaceState, action = target.dataset.cwAction;
      if (action === "tab") state.tab = target.dataset.tab;
      if (action === "planner") state.planner = !state.planner;
      if (action === "inspect") { state.tab = "board"; state.selectedId = target.dataset.id; }
      if (action === "add-situation") { const s = newWorkspaceSituation(); w.situations.push(s); state.selectedId = s.id; }
      if (action === "add-resource") { const r = newWorkspaceResource(); w.resources.push(r); state.selectedId = r.id; }
      if (action === "prepare") { selectWorkspaceSituation(app.campaign, target.dataset.id); state.tab = "prep"; }
      if (action === "add-change") w.after.changes.push({ id: id(), targetType: "", targetId: "", field: "", value: "", reason: "" });
      if (action === "remove-change") w.after.changes = w.after.changes.filter((c) => c.id !== target.dataset.id);
      if (action === "record-play") {
        const original = copy(w); applyCampaignWorkspaceAfterPlay(app.campaign);
        try { await app.saveCampaignDraft(); } catch (error) { app.campaign.workspace = original; throw error; }
        state.tab = "board"; state.selectedId = w.situations.find((s) => s.status === "active")?.id || "";
        ui.notifications.info("Play recorded. The campaign board and next preparation are updated.");
      }
      if (action === "remove-resource") {
        const r = w.resources.find((entry) => entry.id === target.dataset.id); if (!r) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({ window: { title: "Remove campaign resource" }, content: `<p>Remove ${esc(r.name || "this resource")} from the campaign and current preparation? Its Foundry document and recorded history remain available.</p>` });
        if (!confirmed) return;
        w.resources = w.resources.filter((entry) => entry.id !== r.id);
        for (const s of w.situations) s.resourceIds = s.resourceIds.filter((rid) => rid !== r.id);
        for (const other of w.resources) other.relatedIds = other.relatedIds.filter((rid) => rid !== r.id);
        w.prep.resourceIds = w.prep.resourceIds.filter((rid) => rid !== r.id); w.after.usedResourceIds = w.after.usedResourceIds.filter((rid) => rid !== r.id);
        w.after.changes = w.after.changes.filter((c) => !(c.targetType === "resource" && c.targetId === r.id)); state.selectedId = "";
      }
      if (action === "open-document") {
        const resource = w.resources.find((r) => r.id === target.dataset.id), doc = resource?.uuid && validUuid(resource.uuid) ? await fromUuid(resource.uuid) : null;
        if (!doc?.sheet) throw new Error("The linked document could not be opened. Check its link or drop it again.");
        doc.sheet.render(true); return;
      }
      if (action === "open-table-journal") { await openJournal(w.prep.journalId); return; }
      if (action === "open-detail-journal") { await openJournal(w.prep.detailJournalId); return; }
      if (action === "history-journal") { await openJournal(target.dataset.id); return; }
      if (action === "table-journal") {
        const content = packetContent(app.campaign) || "<p>No material selected yet.</p>";
        let journal = game.journal.get(w.prep.journalId);
        if (journal && (journal.getFlag(SCOPE, "workspaceId") !== w.id || journal.getFlag(SCOPE, "packetId") !== w.prep.id)) journal = null;
        const page = { name: "Table notes", type: "text", text: { content, format: 1 }, flags: { [SCOPE]: { workspaceTableNotes: true } } };
        if (!journal) {
          journal = await JournalEntry.create({ name: w.prep.title || `${app.campaign.name || "Campaign"} — Next game`, ownership: { default: 0 }, flags: { [SCOPE]: { workspaceId: w.id, packetId: w.prep.id } }, pages: [page] }); w.prep.journalId = journal.id;
        } else {
          const existing = journal.pages.find((p) => p.getFlag(SCOPE, "workspaceTableNotes"));
          if (existing) await journal.updateEmbeddedDocuments("JournalEntryPage", [{ _id: existing.id, "text.content": content }]);
          else await journal.createEmbeddedDocuments("JournalEntryPage", [page]);
        }
        await app.saveCampaignDraft(); journal.sheet.render(true);
      }
      await app.saveCampaignDraft(); await render();
    } catch (error) { fail(error); } finally { busy = false; }
  });
  root.addEventListener("dragover", (event) => { if (event.target.closest("[data-cw-drop]")) { event.preventDefault(); event.stopPropagation(); } });
  root.addEventListener("drop", async (event) => {
    const zone = event.target.closest("[data-cw-drop]"); if (!zone) return;
    event.preventDefault(); event.stopPropagation();
    try {
      await save();
      const data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"), uuid = data.uuid || "";
      const doc = validUuid(uuid) ? await fromUuid(uuid) : null;
      if (!doc || !["Actor", "Scene", "JournalEntry", "JournalEntryPage", "Item", "Playlist"].includes(doc.documentName)) throw new Error("Drop an Actor, Scene, Journal, Item, or Playlist.");
      const resource = ensureCampaignWorkspace(app.campaign).resources.find((r) => r.id === zone.dataset.cwDrop); if (!resource) return;
      resource.uuid = doc.uuid; if (!resource.name.trim()) resource.name = doc.name;
      await app.saveCampaignDraft(); await render();
    } catch (error) { fail(error); }
  });
}
