// Alexandrian campaign entries. Existing situation/resource IDs remain the maintained records.
const SCOPE = "lore-smith";
const id = () => globalThis.foundry?.utils.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "");
const clone = (value) => JSON.parse(JSON.stringify(value));
const arr = (value) => Array.isArray(value) ? value : [];
const str = (value) => typeof value === "string" ? value : "";
const ids = (value) => [...new Set(arr(value).filter((v) => typeof v === "string"))];
const fields = (record, keys) => { for (const key of keys) record[key] = str(record[key]); };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (value) => esc(value).replace(/\r?\n/g, "<br>");
const uuidOK = (value) => typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value);
const personKinds = ["npc", "faction", "character"];
const visitKinds = [...personKinds, "location", "event", "activity"];
const adventureStatus = { active: "Ongoing", dormant: "Set aside", resolved: "Finished" };
const actionStatus = { planned: "Intended", happened: "Happened", cancelled: "No longer intended" };
const clueStatus = { prepared: "Not found", delivered: "Found", unavailable: "Unavailable" };
const find = (w, type, key) => (type === "adventure" ? w.situations : type === "session" ? w.sessions : type === "action" ? w.actions : type === "discovery" ? w.revelations : w.resources).find((r) => r.id === key);
const name = (record) => record?.kind === "clue" && /^Clue \d+$/.test(record.name) && str(record.notes).trim() ? record.notes.trim().slice(0, 70) : record?.title || record?.name || "Untitled";
const nativeLink = (r) => uuidOK(r.uuid) ? `@UUID[${r.uuid}]{${esc(name(r)).replace(/[{}]/g, "")}}` : esc(name(r));
const hasText = (value) => str(value).trim().length > 0;
const active = (records) => records.filter(r => !r.deletedAt);
// Keep existing links selected, even when their target is in Deleted entries.
const availableWithCurrent = (records, selected = []) => records.filter(r => !r.deletedAt || selected.includes(r.id));
const entryLabel = (r) => `${name(r)}${r.deletedAt ? ' (deleted)' : ''}`;
const entryTypes = { adventure: 'Adventure', session: 'Session', person: 'Person or Group' };

export function setPlannerEntryDeleted(campaign, type, key, deleted = true) {
  if (!Object.hasOwn(entryTypes, type)) throw new Error('Choose an Adventure, Session, or Person or Group.');
  const record = find(campaign.workspace, type, key);
  if (!record || (type === 'person' && !personKinds.includes(record.kind))) throw new Error('This entry is no longer available.');
  // Retain the record and its IDs: imports cannot recreate it, and links/history remain intact.
  if (deleted) record.deletedAt ||= new Date().toISOString();
  else delete record.deletedAt;
  return record;
}

export function newPlannerAdventure() {
  return { id: id(), title: "New Adventure", status: "active", summary: "", stakes: "", resourceIds: [], visitIds: [], materialIds: [], revelationIds: [], participants: [], actionIds: [], journalId: "" };
}
export function newPlannerPerson() {
  return { id: id(), name: "New Person or Group", kind: "npc", notes: "", whereabouts: "", memorable: "", desire: "", assets: "", knowledge: "", attitude: "", state: "", uuid: "", actionIds: [], relatedIds: [] };
}
export function newPlannerSession(w, adventureId = "") {
  return { id: id(), title: `Session ${w.sessions.length + 1}`, status: "planned", adventureId, location: w.location || "", intention: w.partyIntent || "", visitIds: [], personIds: [], actionIds: [], clueIds: [], materialIds: [], checklist: [], notes: "", after: { summary: "", discoveries: "", nextIntent: "", location: "", facts: "", updateOverview: true, foundClueIds: [], understanding: [] }, versions: [], journalId: "" };
}
export function newPlannerAction(adventureId = "", actorId = "") {
  return { id: id(), adventureId, actorId, who: "", action: "", when: "", reason: "", status: "planned" };
}

// Additive migration: old fields, Acts, history, and document IDs are never removed.
export function ensureEntryPlanner(campaign, w = campaign.workspace) {
  const migrate = !w.entryPlannerVersion;
  if (migrate) w.entryLegacyResourceIds = w.resources.map(r => r.id);
  w.sessions = arr(w.sessions); w.actions = arr(w.actions);
  for (const a of w.situations) {
    a.participants = arr(a.participants); a.actionIds = ids(a.actionIds);
    if (!Array.isArray(a.visitIds)) a.visitIds = a.resourceIds.filter((rid) => w.resources.some((r) => r.id === rid && visitKinds.includes(r.kind)));
    if (!Array.isArray(a.materialIds)) a.materialIds = a.resourceIds.filter((rid) => w.resources.some((r) => r.id === rid && !visitKinds.includes(r.kind) && r.kind !== "clue"));
    a.visitIds = ids(a.visitIds); a.materialIds = ids(a.materialIds); a.journalId = str(a.journalId);
    if (migrate) {
      for (const rid of a.resourceIds) if (w.resources.some((r) => r.id === rid && personKinds.includes(r.kind))) a.participants.push({ id: id(), personId: rid, name: "", wants: "", resources: "" });
      if (hasText(a.nextMove)) { const action = { ...newPlannerAction(a.id), action: a.nextMove, when: str(a.trigger), reason: str(a.response) }; w.actions.push(action); a.actionIds.push(action.id); }
    }
    for (const p of a.participants) { p.id ||= id(); fields(p, ["personId", "name", "wants", "resources"]); }
  }
  for (const r of w.resources) {
    fields(r, ["whereabouts", "attitude", "obstacle", "opportunity", "directions", "source", "method", "sourceGroup", "sourceId"]);
    if (migrate && r.kind === "faction") r.desire ||= str(r.goals);
    r.actionIds = ids(r.actionIds);
    if (migrate && personKinds.includes(r.kind) && hasText(r.intent)) { const action = { ...newPlannerAction("", r.id), action: r.intent, when: str(r.trigger), reason: str(r.response) }; w.actions.push(action); r.actionIds.push(action.id); }
  }
  for (const action of w.actions) { action.id ||= id(); fields(action, ["adventureId", "actorId", "who", "action", "when", "reason"]); action.status = actionStatus[action.status] ? action.status : "planned"; }
  {
    for (const h of w.history) {
      if (w.sessions.some(s => s.sourceHistoryId === h.id || s.id === h.id)) continue;
      const session = newPlannerSession(w, arr(h.prep?.situationIds)[0] || "");
      const historyContent = str(h.tableContent) + savedNotes({ summary: h.summary, nextIntent: h.nextIntent, decisions: h.decisions, newFacts: h.newFacts, worldChanges: h.worldChanges, rewardsGained: h.rewardsGained, changes: h.changes });
      Object.assign(session, { id: h.id || session.id, sourceHistoryId: h.id, title: h.prep?.title || "Earlier session", status: "complete", completedAt: h.date || "", notes: str(h.prep?.notes), journalId: h.prep?.journalId || h.prep?.detailJournalId || "", legacy: clone(h), snapshot: { content: historyContent, legacy: clone(h) } });
      Object.assign(session.after, { summary: str(h.summary), nextIntent: str(h.nextIntent), discoveries: str(h.newFacts), updateOverview: false });
      w.sessions.push(session);
    }
    const p = w.prep, pending = w.after;
    const usefulPrep = [p.title, p.opening, p.notes, p.characters, p.locations, p.npcs, p.opposition, p.rewards, pending.summary].some(hasText) || p.resourceIds.length || p.situationIds.length || p.revelationIds.length || p.scenes.length || p.secrets.length || p.detail;
    if (usefulPrep && !w.sessions.some(s => s.sourcePacketId === p.id)) {
      const session = newPlannerSession(w, p.situationIds[0] || "");
      Object.assign(session, { id: p.id, sourcePacketId: p.id, title: p.title || "Earlier preparation", notes: p.notes, journalId: p.journalId, legacy: { prep: clone(p), after: clone(pending) } });
      session.visitIds = p.resourceIds.filter((rid) => w.resources.some((r) => r.id === rid && visitKinds.includes(r.kind)));
      session.materialIds = p.resourceIds.filter((rid) => !session.visitIds.includes(rid) && w.resources.some((r) => r.id === rid && r.kind !== "clue"));
      session.clueIds = ids([...p.resourceIds.filter((rid) => w.resources.some((r) => r.id === rid && r.kind === "clue")), ...w.revelations.filter((r) => p.revelationIds.includes(r.id)).flatMap((r) => r.clueIds)]);
      Object.assign(session.after, { summary: pending.summary, discoveries: pending.newFacts, nextIntent: pending.nextIntent, location: pending.location, updateOverview: false });
      w.sessions.push(session);
    }
  }
  for (const s of w.sessions) {
    s.id ||= id(); fields(s, ["title", "adventureId", "location", "intention", "notes", "journalId"]);
    s.status = s.status === "complete" ? "complete" : "planned";
    for (const key of ["visitIds", "personIds", "actionIds", "clueIds", "materialIds"]) s[key] = ids(s[key]);
    s.checklist = arr(s.checklist); s.versions = arr(s.versions); s.after ??= {};
    fields(s.after, ["summary", "discoveries", "nextIntent", "location", "facts"]);
    s.after.updateOverview = s.after.updateOverview !== false; s.after.foundClueIds = ids(s.after.foundClueIds); s.after.understanding = arr(s.after.understanding);
    for (const row of s.checklist) { row.id ||= id(); row.text = str(row.text); row.done = Boolean(row.done); }
    for (const row of s.after.understanding) { fields(row, ["discoveryId", "value"]); row.apply = Boolean(row.apply); }
  }
  w.entryPlannerVersion = 1; w.version = Math.max(3, Number(w.version) || 0);
  return w;
}

export function plannerClueCoverage(w, discovery) {
  const clues = w.resources.filter((r) => r.kind === "clue" && discovery.clueIds.includes(r.id));
  const normalize = (v) => str(v).trim().toLowerCase().replace(/\s+/g, " ");
  const evidence = new Set(), sources = new Set();
  for (const c of clues.filter((r) => r.clueStatus !== "unavailable" && hasText(r.notes))) {
    const source = w.resources.find((r) => r.id === c.sourceId);
    const key = normalize(c.sourceGroup) || (source ? source.uuid || source.id : normalize(c.source));
    if (key) { evidence.add(normalize(c.notes)); sources.add(key); }
  }
  return { clues: evidence.size, sources: sources.size, found: clues.filter((r) => r.clueStatus === "delivered").length };
}
export function plannerSessionOptions(w, session) {
  const adventure = find(w, "adventure", session.adventureId);
  const primary = ids([...(adventure?.visitIds || []), ...arr(adventure?.participants).map(p => p.personId).filter(Boolean), ...session.visitIds]);
  const reachable = w.connections.filter((c) => primary.includes(c.fromId)).map((c) => c.toId);
  return availableWithCurrent(w.resources, session.visitIds).filter((r) => visitKinds.includes(r.kind) && [...primary, ...reachable].includes(r.id));
}
const sessionDiscoveries = (w, s) => {
  const a = find(w, "adventure", s.adventureId);
  return w.revelations.filter((r) => a?.revelationIds.includes(r.id) || r.clueIds.some((rid) => s.clueIds.includes(rid)));
};
const sessionClues = (w, s) => ids([...s.clueIds, ...sessionDiscoveries(w, s).flatMap((r) => r.clueIds)]);
const adventureActions = (w, a) => ids([...a.actionIds, ...w.actions.filter(action => action.adventureId === a.id || (!action.adventureId && a.participants.some(p => p.personId && p.personId === action.actorId))).map(action => action.id)]);

export function completePlannerSession(campaign, sessionId) {
  const w = campaign.workspace, s = find(w, "session", sessionId);
  if (!s || s.status === "complete") throw new Error("This session has already been completed, or is unavailable.");
  if (!hasText(s.after.summary)) throw new Error("Write a short note about what happened before completing this session.");
  const allowed = sessionClues(w, s);
  if (s.after.foundClueIds.some((rid) => !allowed.includes(rid) || find(w, "resource", rid)?.kind !== "clue")) throw new Error("A selected clue is no longer available. Review this session's clue list.");
  const discoveryIds = sessionDiscoveries(w, s).map((r) => r.id);
  if (s.after.understanding.some((r) => r.apply && !discoveryIds.includes(r.discoveryId))) throw new Error("A discovery has changed. Review the understanding notes before completing this session.");
  const before = { location: w.location, partyIntent: w.partyIntent, facts: w.facts };
  const changes = [];
  for (const rid of s.after.foundClueIds) { const clue = find(w, "resource", rid); changes.push({ type: "clue", id: rid, before: clue.clueStatus, after: "delivered" }); }
  for (const row of s.after.understanding.filter((r) => r.apply)) { const d = find(w, "discovery", row.discoveryId); changes.push({ type: "understanding", id: d.id, before: d.understanding, after: row.value }); }
  // Freeze the material actually selected, not an editable duplicate of the adventure.
  const snapshot = { content: sessionContent(w, s), visits: clone(w.resources.filter((r) => s.visitIds.includes(r.id))), people: clone(w.resources.filter((r) => s.personIds.includes(r.id))), clues: clone(w.resources.filter((r) => allowed.includes(r.id))), actions: clone(w.actions.filter((a) => s.actionIds.includes(a.id))), before, changes };
  for (const change of changes) {
    const target = find(w, change.type === "clue" ? "resource" : "discovery", change.id);
    if (change.type === "clue") { target.clueStatus = "delivered"; target.discovered = true; } else target.understanding = change.after;
  }
  if (s.after.updateOverview) {
    w.location = s.after.location.trim() || s.location.trim();
    w.partyIntent = s.after.nextIntent.trim();
    if (hasText(s.after.facts)) w.facts = [w.facts, s.after.facts.trim()].filter(Boolean).join("\n");
  }
  s.snapshot = snapshot; s.status = "complete"; s.completedAt = new Date().toISOString();
  return s;
}
export function reopenPlannerSession(w, sessionId) {
  const s = find(w, "session", sessionId); if (!s || s.status !== "complete") return;
  const { versions, ...record } = s;
  versions.push(clone(record)); s.status = "planned"; s.after.updateOverview = false;
  s.after.foundClueIds = []; for (const row of s.after.understanding) row.apply = false;
}

const button = (action, label, attrs = '') => `<button type="button" data-pl-action="${action}" ${attrs}>${label}</button>`;
const input = (label, attr, value = '', placeholder = '') => `<label>${label}<input aria-label="${esc(label)}" ${attr} value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
const area = (label, attr, value = '', placeholder = '') => `<label>${label}<textarea aria-label="${esc(label)}" ${attr} rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
const select = (label, attr, options, current) => `<label>${label}<select aria-label="${esc(label)}" ${attr}>${Object.entries(options).map(([key, title]) => `<option value="${esc(key)}" ${key === String(current) ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
const check = (label, attr, value) => `<label class="ls-cw-check"><input type="checkbox" ${attr} ${value ? 'checked' : ''}>${esc(label)}</label>`;
const fold = (key, label, content, open = false) => `<details data-pl-fold="${esc(key)}" ${open ? 'open' : ''}><summary>${label}</summary><div class="ls-cw-stack">${content}</div></details>`;
const field = (label, key, r, placeholder = '', short = false) => (short ? input : area)(label, `data-pl-field="${key}"`, r[key], placeholder);
const link = (type, r) => r.deletedAt ? `<span>${esc(entryLabel(r))}</span>` : button('open', esc(name(r)), `data-type="${type}" data-id="${esc(r.id)}" class="ls-cw-link"`);
const choices = (records, blank = 'Choose an existing record') => Object.fromEntries([['', blank], ...records.map((r) => [r.id, entryLabel(r)])]);
const checks = (records, selected, key) => records.map((r) => check(entryLabel(r), `data-pl-select="${key}" value="${esc(r.id)}"`, selected.includes(r.id))).join('');
const block = (title, value) => value ? `<h3>${esc(title)}</h3><p>${lines(value)}</p>` : '';
const reference = (r) => `<div class="ls-cw-drop" data-pl-drop="${esc(r.id)}">${field('Foundry document (optional)', 'uuid', r, 'Drop an Actor, Scene, Journal, Item, or Playlist here', true)}${r.uuid ? button('document', 'Open Foundry document', `data-id="${esc(r.id)}"`) : ''}</div>`;
const sourceName = (w, c) => w.resources.find((r) => r.id === c.sourceId)?.name || c.source || '';
const people = (w, selected = []) => availableWithCurrent(w.resources, selected).filter((r) => personKinds.includes(r.kind));
const visits = (w, selected = []) => availableWithCurrent(w.resources, selected).filter((r) => visitKinds.includes(r.kind));
const materials = (w, selected = []) => availableWithCurrent(w.resources, selected).filter((r) => r.kind !== 'clue');
const meaningful = (value) => typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) ? value.some(meaningful) : value && typeof value === 'object' ? Object.entries(value).some(([k,v]) => !['id','version','journalId','sourceId','status','number','estimatedSessions','sessionCount'].includes(k) && meaningful(v)) : false;
const labelKey = (key) => ({ revelationIds: 'Linked discoveries', revelations: 'Discoveries', nextMove: 'Intended next action', actualOutcome: 'What happened', characterHooks: 'Character involvement', questions: 'Earlier question notes', theories: 'Earlier player theories', prep: 'Earlier preparation', after: 'Earlier after-game notes' }[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()));
function savedNotes(value) {
  if (typeof value === 'string') return `<p>${lines(value)}</p>`;
  if (Array.isArray(value)) return value.filter(meaningful).map((v) => `<div class="ls-cw-history">${savedNotes(v)}</div>`).join('');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key, v]) => !['id','sourceId','workspaceId','packetId','generatedTableContent','tableContent','snapshot','versions'].includes(key) && meaningful(v)).map(([key, v]) => `<section><strong>${esc(labelKey(key))}</strong>${savedNotes(v)}</section>`).join('');
}
const earlier = (key, value) => meaningful(value) ? fold(`earlier-${key}`, 'Earlier notes (preserved)', savedNotes(value)) : '';
function earlierCampaign(c, w) {
  const acts = arr(c.acts).filter(a => [a.objective,a.startingSituation,a.actualOutcome,a.gmNotes].some(hasText) || arr(a.chapters).some(ch => arr(ch.sessions).some(s => hasText(s.title)||hasText(s.purpose)||s.prep||s.journalId)));
  return { background: c.background, characterHooks: c.characterHooks, tone:c.tone, problem:c.problem, questions: w.questions, theories: w.theories, discoveries: w.discoveries, priorities: w.priorities, objective: w.objective, acts, earlierSessionHistory: w.history, earlierPreparation: w.prep, unfinishedAfterGameNotes: w.after, savedMaterial:w.resources.filter(r=>arr(w.entryLegacyResourceIds).includes(r.id)) };
}
function personContent(w, r) {
  return block('Who they are and where to find them', [r.notes,r.whereabouts].filter(Boolean).join('\n')) + block('Portrayal detail', r.memorable) + block('What they want', r.desire || r.goals) + block('Resources they can use', r.assets) + block('What they know', r.knowledge) + block('How they feel about the party, and why', r.attitude);
}
function actionContent(w, a) {
  const actor = find(w, 'person', a.actorId);
  return `<p><strong>${esc(actor ? name(actor) : a.who || 'NPC action')}:</strong> ${lines(a.action)}<br><strong>When:</strong> ${lines(a.when || 'Time or trigger not set')} · ${actionStatus[a.status]}${a.reason ? `<br>${lines(a.reason)}` : ''}</p>`;
}
function actionEditor(w, a) {
  return `<article class="ls-cw-change" data-pl-record="action" data-id="${esc(a.id)}"><div class="ls-cw-row">${select('Person or Group (optional)', 'data-pl-field="actorId"', choices(people(w, [a.actorId]), 'Use a name below'), a.actorId)}${field('Name, if no shared entry', 'who', a, 'The smuggler’s partner', true)}</div>${field('Intended action', 'action', a, 'Send the party a threatening letter')}${field('Time or condition', 'when', a, 'Tomorrow morning, if the smuggler remains in custody', true)}${select('Action status', 'data-pl-field="status"', actionStatus, a.status)}${field('Why this plan changed (optional)', 'reason', a, 'The party exposed the smuggler.')}</article>`;
}
function actionSection(w, selected, ownerType, ownerId) {
  return `${selected.map(key => find(w, 'action', key)).filter(Boolean).map(a => actionEditor(w,a)).join('')}${button('add-action','+ NPC action',`data-owner="${ownerType}" data-id="${esc(ownerId)}"`)}<small>Use an in-world time or condition. Revise the action when the party changes the circumstances; it does not happen automatically.</small>`;
}
function routeEditor(w, r) {
  return `${field('Directions, clues, or relationships', 'directions', r, 'The ferryman can introduce them to the keeper. The western road reaches the abbey.')}${w.connections.filter(c => c.fromId === r.id).map(c => `<div class="ls-cw-change" data-pl-record="connection" data-id="${esc(c.id)}">${select('Leads to', 'data-pl-field="toId"', choices(visits(w, [c.toId]).filter(n => n.id !== r.id)), c.toId)}${field('How they can get there or learn about it', 'description', c, 'A road, an introduction, a relationship, or a concrete clue.')}${select('Use an existing clue (optional)', 'data-pl-field="clueId"', choices(w.resources.filter(n => n.kind === 'clue'), 'No clue needed'), c.clueId)}${c.clueId ? `<p><strong>Linked clue:</strong> ${lines(find(w,'resource',c.clueId)?.notes || 'Clue unavailable')}</p>` : ''}${button('remove-route','Remove this direction',`data-id="${esc(c.id)}"`)}</div>`).join('')}${button('add-route','+ Link another person or place',`data-id="${esc(r.id)}"`)}`;
}
function routeContent(w, r) {
  return block('Leads to further people or places', r.directions) + w.connections.filter(c => c.fromId === r.id).map(c => `<p><strong>${esc(name(find(w,'resource',c.toId)))}:</strong> ${lines(c.description)}${c.clueId ? ` · See clue: ${esc(name(find(w,'resource',c.clueId)))} (${clueStatus[find(w,'resource',c.clueId)?.clueStatus] || 'Unavailable'})` : ''}</p>`).join('');
}
function visitContent(w, r) {
  return (personKinds.includes(r.kind) ? personContent(w,r) : block('Location notes',r.notes)) + block('What is happening there now', r.state) + block('NPC intentions or obstacle', r.obstacle) + block('What the party can investigate, learn, or attempt', r.opportunity) + routeContent(w,r);
}
function visitEditor(w, r) {
  return `<article class="ls-cw-change" data-pl-record="resource" data-id="${esc(r.id)}">${field('Name of place or contact', 'name', r, 'Tavern of the Old Aboleth', true)}${field('What is happening there now', 'state', r, 'Severin is recruiting a salvage crew.')}${personKinds.includes(r.kind) ? `<p>Shared person: ${link('person',r)} · Wants: ${esc(r.desire || r.goals || 'Not yet noted')}</p>` : ''}${field('What the NPCs want or what obstacle is present', 'obstacle', r, 'The captain needs reliable divers; guards are watching the boats.')}${field('What the party can investigate, learn, or attempt', 'opportunity', r, 'Ask about the expedition, negotiate payment, inspect the equipment.')}${!personKinds.includes(r.kind) && r.notes ? earlier(`visit-${r.id}`, { notes:r.notes }) : ''}${fold(`routes-${r.id}`,'Directions and links (optional)',routeEditor(w,r))}${reference(r)}</article>`;
}
function materialEditor(r) {
  return `<article class="ls-cw-change" data-pl-record="resource" data-id="${esc(r.id)}">${field('Material name', 'name', r, 'Lake map or diving rules', true)}${field('Notes or rules reference', 'notes', r, 'What you need at the table; page numbers or a short reminder.')}${reference(r)}</article>`;
}
function clueEditor(w, c) {
  return `<article class="ls-cw-change" data-pl-record="resource" data-id="${esc(c.id)}">${field('Clue', 'notes', c, 'The shipping ledger names the old mill as the delivery point.')}${field('Where the characters can find it', 'source', c, 'The shipping ledger in the harbormaster’s office', true)}${select('Found?', 'data-pl-field="clueStatus"', clueStatus, c.clueStatus)}${fold(`clue-detail-${c.id}`,'Source details and document (optional)',`${field('Short name', 'name', c, 'Shipping ledger', true)}${select('Source already in the adventure', 'data-pl-field="sourceId"', choices(visits(w, [c.sourceId]), 'Use the source written above'), c.sourceId)}${field('How it can be found', 'method', c, 'Read the ledger or ask to inspect a delivery record.')}${field('Shared source or obstacle', 'sourceGroup', c, 'Use the same name for clues that all depend on one witness or archive.', true)}${reference(c)}`)}</article>`;
}
function discoveryEditor(w, d) {
  const count = plannerClueCoverage(w,d);
  return `<article class="ls-cw-change" data-pl-record="discovery" data-id="${esc(d.id)}">${field('What do the characters need to learn?', 'title', d, 'The missing villagers are held at the old mill.')}${d.conclusion ? earlier(`discovery-${d.id}`,{ detail:d.conclusion }) : ''}<p class="ls-cw-guidance"><span data-pl-coverage="${esc(d.id)}">${count.clues} distinct clues with a source · ${count.sources} sources · ${count.found} found.</span><br>Prepare at least three distinct clues for an important discovery, preferably from independent sources. One useful clue is enough to act. Three ways of questioning one witness still share a source.</p>${d.clueIds.map(key=>find(w,'resource',key)).filter(c=>c?.kind==='clue').map(c=>clueEditor(w,c)).join('')}<div class="ls-cw-row">${button('add-clue','+ Clue',`data-id="${esc(d.id)}"`)}${select('Reuse a clue',`data-pl-link="discovery-clue" data-id="${esc(d.id)}"`,choices(w.resources.filter(c=>c.kind==='clue'&&!d.clueIds.includes(c.id))), '')}</div>${field('What have the players worked out so far?', 'understanding', d, 'They suspect the mill, but think the miller acted alone.')}<small>Finding evidence and understanding it are separate. Record the players’ actual conclusion here.</small></article>`;
}
function adventureEditor(w,a) {
  const sessions=active(w.sessions).filter(s=>s.adventureId===a.id);
  return `<article class="ls-cw-editor" data-pl-record="adventure" data-id="${esc(a.id)}"><div class="ls-cw-row">${field('Adventure name','title',a,'The Missing Villagers',true)}${select('Adventure status','data-pl-field="status"',adventureStatus,a.status)}</div><p>Keep this Adventure throughout the situation. Update the same people, places, and evidence as play changes them.</p><h2>What is happening</h2>${field('The current problem','summary',a,'Villagers are disappearing along the river.')}${field('Why the party might become involved','stakes',a,'One missing villager is a character’s old friend.')}
    ${fold(`who-${a.id}`,'Who is involved',`${a.participants.map(p=>`<div class="ls-cw-change" data-pl-record="participant" data-id="${esc(p.id)}" data-owner="${esc(a.id)}">${select('Link a Person or Group (optional)','data-pl-field="personId"',choices(people(w, [p.personId]),'Use a few lines below'),p.personId)}${p.personId && find(w,'person',p.personId) ? `<div>${link('person',find(w,'person',p.personId))}${personContent(w,find(w,'person',p.personId))}</div>` : `${field('Person or group','name',p,'Severin Vhal',true)}${field('What they want','wants',p,'Recover the fallen star')}${field('Resources they can use','resources',p,'Divers, boats, a patron’s money, and records of the lake.')}`}${button('remove-participant','Remove from Adventure',`data-owner="${esc(a.id)}" data-id="${esc(p.id)}"`)}</div>`).join('')}${button('add-participant','+ Person or group involved',`data-id="${esc(a.id)}"`)}<small>A few lines are enough. Create a shared Person or Group entry only when you need more detail or reuse it.</small>`)}
    ${fold(`actions-${a.id}`,'What they will do if nobody stops them',actionSection(w,adventureActions(w,a),'adventure',a.id))}
    ${fold(`visits-${a.id}`,'Places and people the party can visit',`<p>Prepare what the party can find or do and the directions they might follow. There is no required visiting order.</p>${a.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`${visitEditor(w,r)}${button('unlink-visit','Remove from this Adventure',`data-owner="${esc(a.id)}" data-id="${esc(r.id)}"`)}`).join('')}<div class="ls-cw-row">${button('add-visit','+ Place or contact',`data-id="${esc(a.id)}"`)}${select('Link an existing place or person',`data-pl-link="adventure-visit" data-id="${esc(a.id)}"`,choices(visits(w).filter(r=>!a.visitIds.includes(r.id))), '')}</div>`,true)}
    ${fold(`discoveries-${a.id}`,'Clues to an important discovery (optional)',`<p>Use this only when the characters need to learn a fact or find a destination. Add another discovery if needed.</p>${a.revelationIds.map(key=>find(w,'discovery',key)).filter(Boolean).map(d=>discoveryEditor(w,d)).join('')}${button('add-discovery','+ Important discovery',`data-id="${esc(a.id)}"`)}${select('Link an existing discovery',`data-pl-link="adventure-discovery" data-id="${esc(a.id)}"`,choices(w.revelations.filter(d=>!a.revelationIds.includes(d.id))), '')}`)}
    ${fold(`material-${a.id}`,'Material to keep handy (optional)',`<p>Maps, statistics, defenses, handouts, and rules references.</p>${a.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(materialEditor).join('')}<div class="ls-cw-row">${button('add-material','+ Material',`data-id="${esc(a.id)}"`)}${select('Link existing material',`data-pl-link="adventure-material" data-id="${esc(a.id)}"`,choices(materials(w).filter(r=>!a.materialIds.includes(r.id))), '')}</div>`)}
    <section class="ls-cw-section"><div class="ls-cw-row"><h2>Sessions in this Adventure</h2>${button('new-session','New Session for this Adventure',`data-adventure="${esc(a.id)}" class="ls-cw-primary"`)}</div>${sessions.map(s=>`<div class="ls-cw-row">${link('session',s)}<small>${s.status==='complete'?'Completed':'Preparing / playing'}</small></div>`).join('')||'<p>Create a Session when you are ready to prepare an individual game.</p>'}</section>${earlier(`adventure-${a.id}`,Object.fromEntries(['goals','resources','leads','nextMove','trigger','warning','consequence','response'].map(k=>[k,a[k]])))}</article>`;
}
function personEditor(w,r) {
  const adventures=active(w.situations).filter(a=>a.participants.some(p=>p.personId===r.id)||a.visitIds.includes(r.id));
  return `<article class="ls-cw-editor" data-pl-record="resource" data-id="${esc(r.id)}">${field('Person or Group name','name',r,'Quina or the Secta',true)}<p>Optional shared notes for a recurring person or group. Changes here appear wherever this entry is linked.</p>${field('Who they are','notes',r,'A local guide who distrusts the expedition.')}${field('Where to find them','whereabouts',r,'The tavern in Cassardis',true)}${field('One detail that helps portray them','memorable',r,'Always folds a scrap of sailcloth while speaking.')}${field('What they want','desire',r,'Find out who paid for the expedition.')}${field('Resources they can use','assets',r,'Fishing contacts, a small boat, and local goodwill.')}${field('What they know','knowledge',r)}${field('How they feel about the party, and why','attitude',r)}${fold(`person-actions-${r.id}`,'What they intend to do next, and when',actionSection(w,r.actionIds,'person',r.id))}${reference(r)}<div class="ls-cw-links">${adventures.map(a=>link('adventure',a)).join('')}</div>${earlier(`person-${r.id}`,Object.fromEntries(['state','goals','intent','trigger','leverage','ambitions','relationships','hooks','payoffs','response','warning','consequence'].map(k=>[k,r[k]])))}</article>`;
}
const previousJournals = (s) => ids([s.journalId, s.legacy?.prep?.detailJournalId, s.legacy?.prep?.journalId]).map(key=>button('existing-journal','Open earlier Session Journal',`data-id="${esc(key)}"`)).join('');
function sessionEditor(w,s) {
  if(s.status==='complete') return `<article class="ls-cw-editor"><h2>${esc(s.title)}</h2>${previousJournals(s)}<p>Completed session. These notes and the material used at the time stay in history.</p>${s.adventureId&&find(w,'adventure',s.adventureId)?link('adventure',find(w,'adventure',s.adventureId)):''}${s.snapshot?.content||savedNotes(s.legacy||s)}${button('reopen-session','Edit this completed Session',`data-id="${esc(s.id)}"`)}<small>Editing preserves the completed version. Campaign updates are unchecked when you reopen it.</small>${s.versions.length?fold(`versions-${s.id}`,`Earlier completed versions · ${s.versions.length}`,s.versions.map(v=>`<article class="ls-cw-history">${v.snapshot?.content||savedNotes(v)}</article>`).join('')):''}</article>`;
  const a=find(w,'adventure',s.adventureId), available=plannerSessionOptions(w,s), clues=sessionClues(w,s), discoveries=sessionDiscoveries(w,s);
  const actions=w.actions.filter(a=>a.status==='planned'||s.actionIds.includes(a.id));
  return `<article class="ls-cw-editor" data-pl-record="session" data-id="${esc(s.id)}">${field('Session name','title',s,'Session 1',true)}${previousJournals(s)}<h2>Where we start</h2>${select('Linked Adventure','data-pl-field="adventureId"',choices(availableWithCurrent(w.situations, [s.adventureId]),'Choose an Adventure when ready'),s.adventureId)}${a?link('adventure',a):'<small>You can write now and link an Adventure later.</small>'}${field('Where are the characters now?','location',s)}${field('What did they decide to do next?','intention',s)}
    ${fold(`session-visits-${s.id}`,'People and places they could reach this session',`<p>Select existing Adventure details. Also consider destinations their leads could reach. These are available situations, not a sequence.</p><div class="ls-cw-checklist">${checks(available,s.visitIds,'visitIds')||'<p>Add a place or contact to the linked Adventure first.</p>'}</div>${s.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<section class="ls-cw-table-record"><h3>${esc(name(r))}</h3>${visitContent(w,r)}${r.uuid?button('document','Open Foundry document',`data-id="${esc(r.id)}"`):''}${fold(`edit-visit-${s.id}-${r.id}`,'Edit shared Adventure details',`<small>These changes apply everywhere this place or contact is linked.</small>${visitEditor(w,r)}`)}</section>`).join('')}${fold(`session-people-${s.id}`,'Other shared People or Groups (optional)',`<div class="ls-cw-checklist">${checks(people(w, s.personIds),s.personIds,'personIds')}</div>${s.personIds.map(key=>find(w,'person',key)).filter(Boolean).map(r=>`<section>${link('person',r)}${personContent(w,r)}</section>`).join('')}`)}`,true)}
    ${fold(`session-actions-${s.id}`,'What NPCs plan to do during this time',`<div class="ls-cw-checklist">${actions.map(a=>check(`${find(w,'person',a.actorId)?.name||a.who||'NPC'}: ${a.action||'New action'} — ${a.when||'Time not set'}`,`data-pl-select="actionIds" value="${esc(a.id)}"`,s.actionIds.includes(a.id))).join('')}</div>${s.actionIds.map(key=>find(w,'action',key)).filter(Boolean).map(a=>`${actionContent(w,a)}${fold(`edit-action-${s.id}-${a.id}`,'Revise this shared intention',actionEditor(w,a))}`).join('')}${button('add-action','+ NPC action',`data-owner="session" data-id="${esc(s.id)}"`)}<small>Actions have an in-world trigger. Revise them if the circumstances change.</small>`)}
    ${fold(`session-ready-${s.id}`,'What I need ready',`<p>A short list for maps, statistics, rules, clues, or handouts. Unfinished items can carry into the next Session.</p>${s.checklist.map(row=>`<div class="ls-cw-change" data-pl-record="checklist" data-owner="${esc(s.id)}" data-id="${esc(row.id)}">${field('Preparation item','text',row,'Check the rules for diving',true)}${check('Ready','data-pl-field="done"',row.done)}${button('remove-check','Remove preparation item',`data-owner="${esc(s.id)}" data-id="${esc(row.id)}"`)}</div>`).join('')}${button('add-check','+ Preparation item',`data-id="${esc(s.id)}"`)}<h3>Existing material</h3><div class="ls-cw-checklist">${checks(materials(w, s.materialIds).filter(r=>(a?.materialIds||[]).includes(r.id)||s.materialIds.includes(r.id)),s.materialIds,'materialIds')}</div>${s.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<section><strong>${esc(name(r))}</strong><p>${lines(r.notes)}</p>${r.uuid?button('document','Open Foundry document',`data-id="${esc(r.id)}"`):''}</section>`).join('')}<h3>Important clues</h3><div class="ls-cw-checklist">${checks(w.resources.filter(c=>c.kind==='clue'&&clues.includes(c.id)),s.clueIds,'clueIds')}</div>${s.clueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>`<p><strong>${esc(name(c))}:</strong> ${lines(c.notes)}<br>Source: ${esc(sourceName(w,c))} · ${clueStatus[c.clueStatus]}</p>`).join('')}`)}
    ${field('Notes during the game','notes',s)}
    ${fold(`session-after-${s.id}`,'After the game',`<div data-pl-after="${esc(s.id)}">${area('What happened and what changed?','data-pl-after-field="summary"',s.after.summary)}${area('Which clues did they find, and what did they work out?','data-pl-after-field="discoveries"',s.after.discoveries)}<small>Use the checkboxes below to update maintained evidence. This narrative note remains in this Session.</small><div class="ls-cw-checklist">${w.resources.filter(c=>c.kind==='clue'&&clues.includes(c.id)).map(c=>check(`${name(c)} · ${clueStatus[c.clueStatus]}`,`data-pl-found value="${esc(c.id)}" ${c.clueStatus==='delivered'?'disabled':''}`,c.clueStatus==='delivered'||s.after.foundClueIds.includes(c.id))).join('')}</div>${discoveries.map(d=>{const update=s.after.understanding.find(r=>r.discoveryId===d.id);return `<div class="ls-cw-change" data-pl-understanding="${esc(d.id)}"><strong>${esc(d.title)}</strong><small>Previously understood: ${esc(d.understanding||'Not recorded')}</small>${area('What have the players worked out so far?','data-pl-understanding-value',update?.value??d.understanding)}${check('Update this discovery when completing the Session','data-pl-understanding-apply',update?.apply)}</div>`;}).join('')}${area('What does the party intend to do next?','data-pl-after-field="nextIntent"',s.after.nextIntent)}${input('Party location after the game','data-pl-after-field="location"',s.after.location,s.location)}${area('New facts to remember (optional)','data-pl-after-field="facts"',s.after.facts)}${check('Update Campaign Overview with this location, next intention, and new facts','data-pl-after-field="updateOverview"',s.after.updateOverview)}</div>${button('complete-session','Complete Session and keep its history',`data-id="${esc(s.id)}" class="ls-cw-primary"`)}<small>Unused Adventure details remain available. Only the clue and understanding updates you selected are applied.</small>`)}${earlier(`session-${s.id}`,s.legacy)}</article>`;
}
function overview(c,w) {
  return `<div class="ls-cw-editor">${input('Campaign name','name="campaignName"',c.name)}${area('Campaign premise','name="campaignPremise"',c.premise,'A short description of the setting and central problem.')}<h2>Where we left off</h2>${input('The party is at','data-pl-current="location"',w.location)}${area('They plan to','data-pl-current="partyIntent"',w.partyIntent)}<h2>Active adventures</h2><div class="ls-cw-links">${active(w.situations).filter(a=>a.status==='active').map(a=>link('adventure',a)).join('')||'<p>Create an Adventure for a problem the party can get involved in.</p>'}</div>${fold('overview-actions','What will NPCs do because of the party’s actions?',`${w.actions.filter(a=>a.status==='planned').map(a=>actionEditor(w,a)).join('')}${button('add-action','+ NPC action','data-owner="overview"')}<small>Record who intends to act and the in-world time or trigger. Example: after the party exposes a smuggler, his partner plans to send a letter tomorrow.</small>`)}${area('Facts to remember','data-pl-current="facts"',w.facts,'Established names, promises, relationships, and changes to the world.')}</div>`;
}
function help() {
  return fold('help','When to create each entry · brief help',`<p><strong>Adventure:</strong> create one for a situation the party can engage with. Keep updating it across games.</p><p><strong>Session:</strong> create one for an individual game. Select the people, places, and material you might need; the linked Adventure stays the maintained record.</p><p><strong>Person or Group:</strong> optional notes for a recurring NPC or faction. A few lines inside an Adventure are often enough.</p><p>Start with what is happening, who wants what, and what they can use. Prepare nearby possibilities and destinations the party’s leads might reach. Add details only when useful.</p><p>Methods: <a href="https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots" target="_blank" rel="noopener noreferrer">Don’t Prep Plots</a> · <a href="https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule" target="_blank" rel="noopener noreferrer">Three Clue Rule</a> · <a href="https://thealexandrian.net/wordpress/52735/roleplaying-games/random-gm-tip-managing-prep-load" target="_blank" rel="noopener noreferrer">Managing Prep Load</a> · <a href="https://thealexandrian.net/wordpress/42961/roleplaying-games/smart-prep-part-4-campaign-status-documents" target="_blank" rel="noopener noreferrer">Campaign Status Documents</a>.</p>`);
}
function entryControls(type, record) {
  return `<div class="ls-planner-entry-actions">${button('delete-entry', `<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete ${entryTypes[type]}`, `data-type="${type}" data-id="${esc(record.id)}"`)}</div>`;
}
function deletedEntries(w) {
  const records = [['adventure', w.situations], ['session', w.sessions], ['person', w.resources.filter(r => personKinds.includes(r.kind))]]
    .flatMap(([type, entries]) => entries.filter(r => r.deletedAt).map(record => ({type, record})));
  if (!records.length) return '';
  return fold('deleted-entries', `Deleted entries · ${records.length}`, `<p>Restore an entry to put it back in the planner. Existing links, completed notes, and Foundry documents are kept.</p>${records.map(({type, record}) => `<div class="ls-cw-row"><span><strong>${esc(name(record))}</strong> · ${entryTypes[type]}</span>${button('restore-entry', `Restore ${entryTypes[type]}`, `data-type="${type}" data-id="${esc(record.id)}"`)}</div>`).join('')}`);
}
export function renderEntryPlanner(campaign,state={}) {
  const w=campaign.workspace, view=['overview','adventures','sessions','people'].includes(state.view)?state.view:'overview';
  const type={adventures:'adventure',sessions:'session',people:'person'}[view], records=type==='adventure'?active(w.situations):type==='session'?active(w.sessions):type==='person'?people(w):[];
  const selected=records.find(r=>r.id===state.selectedId);
  let body=view==='overview'?overview(campaign,w):`<div class="ls-planner-columns"><aside class="ls-cw-index" aria-label="${esc(view)}">${records.map(r=>`<div class="${r.id===state.selectedId?'selected':''}">${link(type,r)}${type==='session'?`<small>${r.status==='complete'?'Completed':'Preparing / playing'}</small>`:type==='adventure'?`<small>${adventureStatus[r.status]}</small>`:''}</div>`).join('')||'<p class="ls-cw-empty">Use a New button above to create an editable entry.</p>'}</aside><div>${selected?entryControls(type,selected)+(type==='adventure'?adventureEditor(w,selected):type==='session'?sessionEditor(w,selected):personEditor(w,selected)):'<p class="ls-cw-empty">Open an entry to keep working on it, or create a new one.</p>'}</div></div>`;
  const html=`<section class="ls-panel ls-cw ls-planner" data-campaign-workspace><header><div><span>Prepare situations. Follow what changes.</span><h1>Campaign Planner</h1></div></header><div class="ls-cw-row ls-planner-create">${button('new-adventure','New Adventure','class="ls-cw-primary"')}${button('new-session','New Session')}${button('new-person','New Person or Group')}</div><nav class="ls-cw-tabs" aria-label="Campaign planner">${Object.entries({overview:'Campaign Overview',adventures:'Adventures',sessions:'Sessions',people:'People or Groups'}).map(([key,label])=>button('view',label,`data-view="${key}" aria-pressed="${key===view}"`)).join('')}</nav>${body}${deletedEntries(w)}${help()}${view==='overview'?earlier('campaign',earlierCampaign(campaign,w)):''}<footer class="ls-cw-footer">${button('journal',selected?'Create / update this entry’s Journal':'Create / update Overview Journal',selected?`data-type="${type}" data-id="${esc(selected.id)}"`:'data-type="overview"')}<small>Drafts save automatically. Journals are snapshots you can open in Foundry.</small><span data-cw-save aria-live="polite"></span></footer></section>`;
  return html.replace(/<details data-pl-fold="([^"]+)"\s*(open)?/g,(_,key,open)=>`<details data-pl-fold="${key}"${(state.openDetails?.[key]??Boolean(open))?' open':''}`);
}

function recordForCard(w, card) {
  const type=card.dataset.plRecord,key=card.dataset.id;
  if(type==='participant') return find(w,'adventure',card.dataset.owner)?.participants.find(r=>r.id===key);
  if(type==='checklist') return find(w,'session',card.dataset.owner)?.checklist.find(r=>r.id===key);
  if(type==='connection') return w.connections.find(r=>r.id===key);
  return find(w,type,key);
}
export function syncEntryPlanner(campaign, root) {
  const w=campaign.workspace, container=root?.querySelector('[data-campaign-workspace]');
  if(!container) return w;
  for(const [selector,key] of [['[name="campaignName"]','name'],['[name="campaignPremise"]','premise']]) {const control=container.querySelector(selector);if(control)campaign[key]=control.value;}
  container.querySelectorAll('[data-pl-current]').forEach(el=>{if(['location','partyIntent','facts'].includes(el.dataset.plCurrent))w[el.dataset.plCurrent]=el.value;});
  container.querySelectorAll('[data-pl-record]').forEach(card=>{
    const record=recordForCard(w,card); if(!record || card.dataset.plRecord==='session'&&record.status==='complete') return;
    card.querySelectorAll('[data-pl-field]').forEach(el=>{
      if(el.closest('[data-pl-record]')!==card)return;
      const key=el.dataset.plField;
      if(Object.hasOwn(record,key))record[key]=el.type==='checkbox'?el.checked:el.value;
    });
    if(card.dataset.plRecord==='resource'&&record.kind==='clue')record.discovered=record.clueStatus==='delivered';
    if(card.dataset.plRecord==='session') {
      for(const key of ['visitIds','personIds','actionIds','clueIds','materialIds']) {
        const controls=[...card.querySelectorAll(`[data-pl-select="${key}"]`)];
        const visible=new Set(controls.map(el=>el.value));
        record[key]=ids([...record[key].filter(rid=>!visible.has(rid)),...controls.filter(el=>el.checked).map(el=>el.value)]);
      }
    }
  });
  container.querySelectorAll('[data-pl-after]').forEach(card=>{
    const session=find(w,'session',card.dataset.plAfter);if(!session||session.status==='complete')return;
    card.querySelectorAll('[data-pl-after-field]').forEach(el=>{const key=el.dataset.plAfterField;if(Object.hasOwn(session.after,key))session.after[key]=el.type==='checkbox'?el.checked:el.value;});
    session.after.foundClueIds=[...card.querySelectorAll('[data-pl-found]:checked:not(:disabled)')].map(el=>el.value);
    card.querySelectorAll('[data-pl-understanding]').forEach(node=>{
      let row=session.after.understanding.find(r=>r.discoveryId===node.dataset.plUnderstanding);
      if(!row){row={discoveryId:node.dataset.plUnderstanding,value:'',apply:false};session.after.understanding.push(row);}
      row.value=node.querySelector('[data-pl-understanding-value]').value;row.apply=node.querySelector('[data-pl-understanding-apply]').checked;
    });
  });
  return w;
}
function clueContent(w,c) {return `<section><h3>${nativeLink(c)}</h3>${block('Clue',c.notes)}${block('Source',sourceName(w,c))}${block('How it can be found',c.method)}${block('Found?',clueStatus[c.clueStatus])}</section>`;}
function adventureContent(w,a) {
  const clueIds=ids(a.revelationIds.map(key=>find(w,'discovery',key)).filter(Boolean).flatMap(d=>d.clueIds));
  return `<h1>${esc(a.title)}</h1><p>${adventureStatus[a.status]}</p>${block('The current problem',a.summary)}${block('Why the party might become involved',a.stakes)}<h2>Who is involved</h2>${a.participants.map(p=>{const r=find(w,'person',p.personId);return r?`<h3>${nativeLink(r)}</h3>${personContent(w,r)}`:`${block('Person or group',p.name)}${block('What they want',p.wants)}${block('Resources they can use',p.resources)}`;}).join('')}<h2>What they will do if nobody stops them</h2>${adventureActions(w,a).map(key=>find(w,'action',key)).filter(Boolean).map(a=>actionContent(w,a)).join('')}<h2>Places and people the party can visit</h2>${a.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<h3>${nativeLink(r)}</h3>${visitContent(w,r)}`).join('')}<h2>Important discoveries</h2>${a.revelationIds.map(key=>find(w,'discovery',key)).filter(Boolean).map(d=>`${block('What do the characters need to learn?',d.title)}${block('What the players worked out',d.understanding)}<p>Clues: ${d.clueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>esc(name(c))).join(' · ')}</p>`).join('')}${clueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>clueContent(w,c)).join('')}<h2>Material to keep handy</h2>${a.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<h3>${nativeLink(r)}</h3><p>${lines(r.notes)}</p>`).join('')}`;
}
function sessionContent(w,s) {
  const adventure=find(w,'adventure',s.adventureId);
  const discoveries=sessionDiscoveries(w,s);
  return `<h1>${esc(s.title)}</h1>${block('Adventure',adventure?.title)}${block('Where the characters are',s.location)}${block('What they decided to do next',s.intention)}<h2>People and places they could reach</h2>${s.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<section><h3>${nativeLink(r)}</h3>${visitContent(w,r)}</section>`).join('')}${s.personIds.map(key=>find(w,'person',key)).filter(Boolean).map(r=>`<h3>${nativeLink(r)}</h3>${personContent(w,r)}`).join('')}<h2>What NPCs plan to do during this time</h2>${s.actionIds.map(key=>find(w,'action',key)).filter(Boolean).map(a=>actionContent(w,a)).join('')}<h2>What I need ready</h2><ul>${s.checklist.map(r=>`<li>${r.done?'Ready':'To prepare'}: ${esc(r.text)}</li>`).join('')}</ul>${s.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<h3>${nativeLink(r)}</h3><p>${lines(r.notes)}</p>`).join('')}<h2>Important clues</h2>${s.clueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>clueContent(w,c)).join('')}${block('Notes during the game',s.notes)}<h2>After the game</h2>${block('What happened and what changed',s.after.summary)}${block('Which clues they found and what they worked out',s.after.discoveries)}<ul>${s.after.foundClueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>`<li>Found: ${esc(name(c))} — ${lines(c.notes)} (${esc(sourceName(w,c))})</li>`).join('')}</ul>${s.after.understanding.filter(r=>r.apply).map(r=>block(`Players' understanding: ${discoveries.find(d=>d.id===r.discoveryId)?.title||'Discovery'}`,r.value)).join('')}${block('Party location after the game',s.after.location)}${block('What the party intends next',s.after.nextIntent)}${block('New facts to remember',s.after.facts)}${s.legacy?`<h2>Earlier saved notes</h2>${savedNotes(s.legacy)}`:''}`;
}
function overviewContent(c,w) {
  return `<h1>${esc(c.name||'Campaign')}</h1>${block('Campaign premise',c.premise)}${block('The party is at',w.location)}${block('They plan to',w.partyIntent)}<h2>Active adventures</h2><ul>${active(w.situations).filter(a=>a.status==='active').map(a=>`<li>${esc(a.title)}</li>`).join('')}</ul><h2>What NPCs intend to do</h2>${w.actions.filter(a=>a.status==='planned').map(a=>actionContent(w,a)).join('')}${block('Facts to remember',w.facts)}`;
}
export function entryPlannerPages(campaign) {
  const w=campaign.workspace;
  return [{key:'entry-overview',name:'Campaign Overview',content:overviewContent(campaign,w)},...active(w.situations).map(a=>({key:`entry-adventure-${a.id}`,name:`Adventure · ${a.title}`,content:adventureContent(w,a)})),...people(w).map(r=>({key:`entry-person-${r.id}`,name:`Person or Group · ${name(r)}`,content:`<h1>${nativeLink(r)}</h1>${personContent(w,r)}${r.actionIds.map(key=>find(w,'action',key)).filter(Boolean).map(a=>actionContent(w,a)).join('')}`})),...active(w.sessions).map(s=>({key:`entry-session-${s.id}`,name:`Session · ${s.title}`,content:s.status==='complete'?(s.snapshot?.content||savedNotes(s.legacy||s)):sessionContent(w,s)}))];
}
export function createPlannerEntry(campaign,type,adventureId='') {
  const w=campaign.workspace;
  if(type==='adventure'){const a=newPlannerAdventure();w.situations.push(a);return a;}
  if(type==='person'){const p=newPlannerPerson();w.resources.push(p);return p;}
  const session=newPlannerSession(w,adventureId);
  const previous=[...active(w.sessions)].reverse().find(s=>s.adventureId===adventureId && adventureId);
  if(previous){for(const key of ['visitIds','personIds','actionIds','clueIds','materialIds'])session[key]=[...previous[key]];session.checklist=previous.checklist.filter(r=>!r.done).map(r=>({...r,id:id()}));session.carriedFromId=previous.id;}
  w.sessions.push(session);return session;
}
export function bindEntryPlanner(app) {
  const root=app.element?.querySelector('[data-campaign-workspace]');if(!root||root.dataset.bound)return;
  root.dataset.bound='true';let busy=false,release;
  const status=(message)=>{const el=app.element?.querySelector('[data-cw-save]');if(el)el.textContent=message;};
  const save=async()=>{await app.syncCampaignForm();const w=app.campaign.workspace;root.querySelectorAll('[data-pl-coverage]').forEach(el=>{const d=find(w,'discovery',el.dataset.plCoverage);if(d){const c=plannerClueCoverage(w,d);el.textContent=`${c.clues} distinct clues with a source · ${c.sources} sources · ${c.found} found.`;}});status('Saved');};
  const render=()=>app.renderCampaignPreservingScroll();
  const fail=(error)=>{console.error('Lore Smith | Campaign planner',error);status('Not saved — keep this window open and retry');globalThis.ui?.notifications.error(error.message||'The campaign could not be saved.');};
  const lock=()=>{busy=true;root.inert=true;app.campaignWorkspacePending=new Promise(resolve=>{release=resolve;});};
  const unlock=()=>{busy=false;root.inert=false;release?.();};
  const state=()=>app.campaignWorkspaceState;
  const open=(type,key)=>{state().view={adventure:'adventures',session:'sessions',person:'people'}[type]||'overview';state().selectedId=key||'';state().planner=false;};
  root.addEventListener('toggle',event=>{const key=event.target.dataset.plFold;if(key){state().openDetails??={};state().openDetails[key]=event.target.open;}},true);
  root.addEventListener('input',()=>{status('Saving…');clearTimeout(app.campaignSaveTimer);app.campaignSaveTimer=setTimeout(()=>{if(!busy&&root.isConnected)void save().catch(fail);},350);});
  root.addEventListener('change',async event=>{
    if(busy)return;const el=event.target;
    const refresh=el.matches('[data-pl-link], [data-pl-select], [data-pl-field="personId"], [data-pl-field="adventureId"], [data-pl-field="actorId"], [data-pl-field="clueId"]');
    clearTimeout(app.campaignSaveTimer);
    if(!refresh){void save().catch(fail);return;}
    lock();let original;
    try {
      await save();const w=app.campaign.workspace;original=clone(w);
      if(el.matches('[data-pl-link]')&&el.value) {
        const record=find(w,el.dataset.plLink==='discovery-clue'?'discovery':'adventure',el.dataset.id);
        const field={'discovery-clue':'clueIds','adventure-visit':'visitIds','adventure-material':'materialIds','adventure-discovery':'revelationIds'}[el.dataset.plLink];
        if(record&&field)record[field]=ids([...record[field],el.value]);
      }
      await app.saveCampaignDraft();original=null;await render();
    }catch(error){if(original)app.campaign.workspace=original;fail(error);}finally{unlock();}
  });
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-pl-action]');if(!target||busy)return;
    event.preventDefault();clearTimeout(app.campaignSaveTimer);lock();
    let original,oldState,committed=false,external=false;
    try {
      await save();const w=app.campaign.workspace,action=target.dataset.plAction,key=target.dataset.id;
      original=clone(w);oldState=clone(state());
      if(action==='view'){state().view=target.dataset.view;state().selectedId='';}
      if(action==='open')open(target.dataset.type,key);
      if(action==='delete-entry') {
        const type=target.dataset.type,record=find(w,type,key);
        if(!Object.hasOwn(entryTypes,type)||!record)throw new Error('This entry is no longer available.');
        const details=type==='adventure' ? 'Its Sessions, shared people, places, clues, and Foundry documents will be kept.' : type==='session' ? 'The Adventure, shared material, Foundry Journals, and campaign updates already recorded will be kept.' : 'Existing links will keep these notes. This entry will no longer be offered for new links. Foundry documents will be kept.';
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:`Delete ${entryTypes[type]}`},content:`<p>Move <strong>${esc(name(record))}</strong> to Deleted entries?</p><p>${details}</p><p>You can restore it from <strong>Deleted entries</strong> below the planner.</p>`});
        if(!confirmed)return;
        setPlannerEntryDeleted(app.campaign,type,key);open(type,'');
      }
      if(action==='restore-entry') {setPlannerEntryDeleted(app.campaign,target.dataset.type,key,false);open(target.dataset.type,key);}
      if(action==='new-adventure'||action==='new-person'||action==='new-session') {
        const type=action.slice(4),entry=createPlannerEntry(app.campaign,type,target.dataset.adventure||'');open(type,entry.id);
      }
      if(action==='add-participant')find(w,'adventure',key).participants.push({id:id(),personId:'',name:'',wants:'',resources:''});
      if(action==='remove-participant'){const a=find(w,'adventure',target.dataset.owner);a.participants=a.participants.filter(p=>p.id!==key);}
      if(action==='add-action') {
        const owner=target.dataset.owner,record=find(w,owner,key);
        const a=newPlannerAction(owner==='adventure'?key:owner==='session'?record.adventureId:'',owner==='person'?key:'');w.actions.push(a);
        if(owner!=='overview'&&record)record.actionIds.push(a.id);
      }
      if(action==='add-visit'||action==='add-material') {
        const a=find(w,'adventure',key),r={id:id(),name:action==='add-visit'?'New place or contact':'New material',kind:action==='add-visit'?'location':'other',notes:'',state:'',uuid:'',relatedIds:[],whereabouts:'',obstacle:'',opportunity:'',directions:'',actionIds:[]};w.resources.push(r);a[action==='add-visit'?'visitIds':'materialIds'].push(r.id);
      }
      if(action==='unlink-visit'){const a=find(w,'adventure',target.dataset.owner);a.visitIds=a.visitIds.filter(rid=>rid!==key);}
      if(action==='add-route')w.connections.push({id:id(),fromId:key,toId:'',description:'',kind:'access',clueId:''});
      if(action==='remove-route')w.connections=w.connections.filter(c=>c.id!==key);
      if(action==='add-discovery') {
        const a=find(w,'adventure',key),d={id:id(),title:'',conclusion:'',destinationId:'',essential:true,status:'open',understanding:'',clueIds:[]};w.revelations.push(d);a.revelationIds.push(d.id);
        for(let i=0;i<3;i++){const c={id:id(),name:`Clue ${i+1}`,kind:'clue',notes:'',source:'',method:'',sourceId:'',sourceGroup:'',clueStatus:'prepared',discovered:false,uuid:'',state:'',relatedIds:[]};w.resources.push(c);d.clueIds.push(c.id);}
      }
      if(action==='add-clue'){const d=find(w,'discovery',key),c={id:id(),name:`Clue ${d.clueIds.length+1}`,kind:'clue',notes:'',source:'',method:'',sourceId:'',sourceGroup:'',clueStatus:'prepared',discovered:false,uuid:'',state:'',relatedIds:[]};w.resources.push(c);d.clueIds.push(c.id);}
      if(action==='add-check')find(w,'session',key).checklist.push({id:id(),text:'',done:false});
      if(action==='remove-check'){const s=find(w,'session',target.dataset.owner);s.checklist=s.checklist.filter(r=>r.id!==key);}
      if(action==='complete-session')completePlannerSession(app.campaign,key);
      if(action==='reopen-session')reopenPlannerSession(w,key);
      if(action==='existing-journal') { const journal=game.journal.get(key);if(!journal)throw new Error('This earlier Session Journal is no longer available.');journal.sheet.render(true);return; }
      if(action==='document') {
        const r=find(w,'resource',key),doc=uuidOK(r?.uuid)?await fromUuid(r.uuid):null;
        if(!doc?.sheet)throw new Error('The linked document is unavailable. Check its link or drop it again.');doc.sheet.render(true);return;
      }
      if(action==='journal') {
        const type=target.dataset.type,entry=type==='overview'?w:find(w,type,key);
        const page=entryPlannerPages(app.campaign).find(p=>p.key===(type==='overview'?'entry-overview':`entry-${type}-${key}`));
        if(!page)throw new Error('This entry is unavailable.');
        let journal=game.journal.get(entry.entryJournalId);
        if(journal&&(journal.getFlag(SCOPE,'workspaceId')!==w.id||journal.getFlag(SCOPE,'plannerEntry')!==page.key))journal=null;
        const data={name:page.name,type:'text',text:{content:page.content,format:1},flags:{[SCOPE]:{plannerPage:true}}};
        if(journal){const existing=journal.pages.find(p=>p.getFlag(SCOPE,'plannerPage'));
          if(existing){if(existing.text?.content!==page.content&&existing.text?.content!==entry.generatedEntryContent){const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Update entry Journal'},content:'<p>This page may contain manual edits. Replace the generated entry page with the current planner notes? Other pages stay as they are.</p>'});if(!yes){journal.sheet.render(true);return;}}
            await journal.updateEmbeddedDocuments('JournalEntryPage',[{_id:existing.id,'text.content':page.content}]);
          }else await journal.createEmbeddedDocuments('JournalEntryPage',[data]);
        }else{journal=await JournalEntry.create({name:page.name,ownership:{default:0},flags:{[SCOPE]:{workspaceId:w.id,plannerEntry:page.key}},pages:[data]});entry.entryJournalId=journal.id;}
        external=true;entry.generatedEntryContent=page.content;journal.sheet.render(true);
      }
      await app.saveCampaignDraft();committed=true;await render();
    }catch(error){if(original&&!committed&&!external){app.campaign.workspace=original;app.campaignWorkspaceState=oldState;}fail(error);}finally{unlock();}
  });
  root.addEventListener('dragover',event=>{if(event.target.closest('[data-pl-drop]')){event.preventDefault();event.stopPropagation();}});
  root.addEventListener('drop',async event=>{
    const zone=event.target.closest('[data-pl-drop]');if(!zone)return;event.preventDefault();event.stopPropagation();if(busy)return;
    clearTimeout(app.campaignSaveTimer);lock();
    try{await save();const data=JSON.parse(event.dataTransfer?.getData('text/plain')||'{}'),doc=uuidOK(data.uuid)?await fromUuid(data.uuid):null;
      if(!doc||!['Actor','Scene','JournalEntry','JournalEntryPage','Item','Playlist'].includes(doc.documentName))throw new Error('Drop an Actor, Scene, Journal, Item, or Playlist.');
      const r=find(app.campaign.workspace,'resource',zone.dataset.plDrop);if(r){r.uuid=doc.uuid;if(!r.name.trim())r.name=doc.name;}await app.saveCampaignDraft();await render();
    }catch(error){fail(error);}finally{unlock();}
  });
}
