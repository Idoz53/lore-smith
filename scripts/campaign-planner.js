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

// Permanent deletion removes only the selected planner entry, never native documents or snapshots.
export function permanentlyDeletePlannerEntry(campaign, type, key) {
  const w=campaign.workspace, r=find(w,type,key);
  if(!Object.hasOwn(entryTypes,type)||!r||(type==='person'&&!personKinds.includes(r.kind)))throw new Error('This entry is no longer available.');
  if(!r.deletedAt)throw new Error('Move this entry to Deleted entries first.');
  const without=(values)=>arr(values).filter(value=>value!==key);
  if(type==='adventure') {
    w.situations=w.situations.filter(a=>a.id!==key);
    for(const s of w.sessions)if(s.adventureId===key)s.adventureId='';
    for(const a of w.actions)if(a.adventureId===key)a.adventureId='';
    w.prep.situationIds=without(w.prep.situationIds);
  } else if(type==='session') {
    // Remember source IDs only so older imports cannot resurrect an intentionally deleted entry.
    w.removedSessionSources=ids([...arr(w.removedSessionSources),r.id,r.sourceHistoryId,r.sourcePacketId]);
    w.sessions=w.sessions.filter(s=>s.id!==key);
    for(const s of w.sessions)if(s.carriedFromId===key)delete s.carriedFromId;
  } else {
    for(const a of w.situations) {
      for(const p of a.participants.filter(p=>p.personId===key)) {p.personId='';p.name=name(r);p.wants=r.desire||r.goals||p.wants;p.resources=r.assets||p.resources;}
      for(const field of ['resourceIds','visitIds','materialIds'])a[field]=without(a[field]);
    }
    for(const s of w.sessions)for(const field of ['visitIds','personIds','materialIds'])s[field]=without(s[field]);
    for(const a of w.actions)if(a.actorId===key){a.prose=actionText(w,a);a.actorId='';a.who=name(r);}
    for(const other of w.resources) {other.relatedIds=without(other.relatedIds);if(other.sourceId===key){other.source=sourceName(w,other);other.sourceId='';}}
    for(const d of w.revelations)if(d.destinationId===key)d.destinationId='';
    w.connections=w.connections.filter(c=>c.fromId!==key&&c.toId!==key);
    w.prep.resourceIds=without(w.prep.resourceIds);
    w.entryLegacyResourceIds=without(w.entryLegacyResourceIds);
    w.resources=w.resources.filter(person=>person.id!==key);
  }
}
export function deletePlannerAction(w,key) {
  if(!w.actions.some(a=>a.id===key))throw new Error('This plan is no longer available.');
  w.actions=w.actions.filter(a=>a.id!==key);
  for(const record of [...w.situations,...w.sessions,...w.resources])record.actionIds=arr(record.actionIds).filter(actionId=>actionId!==key);
}
const overviewActions = (w) => w.actions.filter(a=>a.overview===true);
function ensureFactEntries(w) {
  if(!Array.isArray(w.factEntries))w.factEntries=str(w.facts).split(/\r?\n/).filter(hasText).map(text=>({id:id(),text}));
  for(const row of w.factEntries){row.id ||= id();row.text=str(row.text);}
}
function syncFacts(w) {w.facts=w.factEntries.map(row=>row.text).filter(hasText).join('\n');}

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
  return { id: id(), adventureId, actorId, who: "", action: "", when: "", reason: "", status: "planned", overview: false };
}

// Additive migration: old fields, Acts, history, and document IDs are never removed.
export function ensureEntryPlanner(campaign, w = campaign.workspace) {
  const migrate = !w.entryPlannerVersion;
  if (migrate) w.entryLegacyResourceIds = w.resources.map(r => r.id);
  w.sessions = arr(w.sessions); w.actions = arr(w.actions);
  ensureFactEntries(w);
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
  for (const action of w.actions) {
    action.id ||= id(); fields(action, ["adventureId", "actorId", "who", "action", "when", "reason"]);
    action.status = actionStatus[action.status] ? action.status : "planned";
    if(!Object.hasOwn(action,'overview')) {
      const written=hasText(actionText(w,action));
      const linked=[...w.situations,...w.sessions,...w.resources].some(record=>arr(record.actionIds).includes(action.id));
      action.overview=written&&!action.adventureId&&!action.actorId&&!linked;
      // Earlier versions left empty completed rows behind when they disappeared from the overview.
      if(!written)action.status='planned';
    }
  }
  {
    for (const h of w.history) {
      if (arr(w.removedSessionSources).includes(h.id) || w.sessions.some(s => s.sourceHistoryId === h.id || s.id === h.id)) continue;
      const session = newPlannerSession(w, arr(h.prep?.situationIds)[0] || "");
      const historyContent = str(h.tableContent) + savedNotes({ summary: h.summary, nextIntent: h.nextIntent, decisions: h.decisions, newFacts: h.newFacts, worldChanges: h.worldChanges, rewardsGained: h.rewardsGained, changes: h.changes });
      Object.assign(session, { id: h.id || session.id, sourceHistoryId: h.id, title: h.prep?.title || "Earlier session", status: "complete", completedAt: h.date || "", notes: str(h.prep?.notes), journalId: h.prep?.journalId || h.prep?.detailJournalId || "", legacy: clone(h), snapshot: { content: historyContent, legacy: clone(h) } });
      Object.assign(session.after, { summary: str(h.summary), nextIntent: str(h.nextIntent), discoveries: str(h.newFacts), updateOverview: false });
      w.sessions.push(session);
    }
    const p = w.prep, pending = w.after;
    const usefulPrep = [p.title, p.opening, p.notes, p.characters, p.locations, p.npcs, p.opposition, p.rewards, pending.summary].some(hasText) || p.resourceIds.length || p.situationIds.length || p.revelationIds.length || p.scenes.length || p.secrets.length || p.detail;
    if (usefulPrep && !arr(w.removedSessionSources).includes(p.id) && !w.sessions.some(s => s.sourcePacketId === p.id)) {
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
    if (hasText(s.after.facts)) {ensureFactEntries(w);w.factEntries.push(...s.after.facts.trim().split(/\r?\n/).filter(hasText).map(text=>({id:id(),text})));syncFacts(w);}
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

const examples = {
  "Campaign name": "Campaign name",
  "Campaign premise": "Write your campaign premise…",
  "The party is at": "Current party location…",
  "They plan to": "What the party plans to do next…",
  "Fact": "The innkeeper lent the party a cart; they promised to return it.",
  "Adventure name": "The Missing Tools",
  "The problem": "Tools needed to repair the bridge have disappeared.",
  "Why the party might get involved": "The village asks the party to find the tools before the next supply wagon arrives.",
  "Person or group": "The carpenters’ guild",
  "What they want": "Reopen the bridge before the market.",
  "Resources they can use": "Skilled workers, timber, and a wagon.",
  "NPC action": "If the road stays blocked, the merchant hires a different escort tomorrow.",
  "Name of place or contact": "The village workshop",
  "What happens here?": "Workers are waiting for supplies. The foreman can explain what is missing and point out the storage shed.",
  "How they can get there or learn about it": "Follow the cart track behind the workshop.",
  "What do the characters need to learn?": "The tools were moved to the old warehouse.",
  "What have the players worked out so far?": "They know a cart carried the tools away but have not found its destination.",
  "Clue": "A delivery receipt lists the old warehouse.",
  "Where the characters can find it": "In the workshop’s accounts book.",
  "Material name": "Village map and bridge hazard",
  "Notes or rules reference": "Keep the bridge map, climbing rules, and guard statistics here.",
  "Session name": "Session 3 — The Workshop",
  "Where are the characters now?": "Outside the village workshop.",
  "What did they decide to do next?": "Ask the foreman about the missing tools.",
  "Preparation item": "Prepare the warehouse map and guard statistics.",
  "Notes during the game": "The party persuaded a worker to show them the delivery book.",
  "What happened and what changed?": "They found the receipt. The foreman agreed to delay the repairs.",
  "Which clues did they find, and what did they work out?": "They found the receipt and identified the warehouse.",
  "What does the party intend to do next?": "Visit the warehouse before it closes.",
  "Party location after the game": "Outside the warehouse gates.",
  "New facts to remember (optional)": "The foreman owes the party a favor.",
  "Person or Group name": "The bridge keeper",
  "Who they are": "A retired carpenter responsible for the crossing.",
  "Where to find them": "In the cottage beside the bridge.",
  "One detail that helps portray them": "Counts on their fingers while speaking.",
  "What they know": "A supply cart left before sunrise.",
  "How they feel about the party, and why": "Trusts them because they helped repair a wagon.",
  "Short name": "The delivery receipt",
  "How it can be found": "Read the workshop’s accounts book.",
  "Shared source or obstacle": "These details all depend on the same delivery book.",
  "Additional discovery notes": "The warehouse also holds supplies for the next market."
};
const example = (label, fallback) => examples[label] || fallback || 'Write a note…';
const button = (action, label, attrs = '') => `<button type="button" data-pl-action="${action}" ${attrs}>${label}</button>`;
const input = (label, attr, value = '', placeholder = '') => `<label>${label}<input aria-label="${esc(label)}" ${attr} value="${esc(value)}" placeholder="${esc(example(label,placeholder))}"></label>`;
const area = (label, attr, value = '', placeholder = '') => `<label>${label}<textarea aria-label="${esc(label)}" ${attr} rows="1" placeholder="${esc(example(label,placeholder))}">${esc(value)}</textarea></label>`;
const check = (label, attr, value) => `<label class="ls-cw-check"><input type="checkbox" ${attr} ${value ? 'checked' : ''}>${esc(label)}</label>`;
const fold = (key, label, content, open = false) => `<details data-pl-fold="${esc(key)}" ${open ? 'open' : ''}><summary>${label}</summary><div class="ls-cw-stack">${content}</div></details>`;
const field = (label, key, r, placeholder = '', short = false) => (short ? input : area)(label, `data-pl-field="${key}"`, r[key], placeholder);
const link = (type, r) => r.deletedAt ? `<span>${esc(entryLabel(r))}</span>` : button('open', esc(name(r)), `data-type="${type}" data-id="${esc(r.id)}" class="ls-cw-link"`);
const block = (title, value) => value ? `<h3>${esc(title)}</h3><p>${lines(value)}</p>` : '';
const reference = (r) => `<span class="ls-pl-note-attachment" data-pl-drop="${esc(r.id)}">${r.uuid ? button('document','Open document',`data-id="${esc(r.id)}" class="ls-pl-note-tool"`) : ''}${choose('document',r.id,r.uuid?'Change document':'Attach document')}</span>`;
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
function personContent(w, r) {
  return block('Who they are and where to find them', [r.notes,r.whereabouts].filter(Boolean).join('\n')) + block('Portrayal detail', r.memorable) + block('What they want', r.desire || r.goals) + block('Resources they can use', r.assets) + block('What they know', r.knowledge) + block('How they feel about the party, and why', r.attitude);
}
const plainArea = (label, attrs, value = '', placeholder = '') => `<textarea aria-label="${esc(label)}" ${attrs} rows="1" placeholder="${esc(example(label,placeholder))}">${esc(value)}</textarea>`;
const section = (title, content) => `<section class="ls-pl-note-section"><h2>${title}</h2>${content}</section>`;
const choose = (kind, key, label, owner = '') => button('choose-link', label, `data-kind="${kind}" data-id="${esc(key)}" data-owner="${esc(owner)}" class="ls-pl-note-tool"`);
const cellField = (label, key, r, placeholder = '') => `<textarea aria-label="${esc(label)}" data-pl-field="${key}" rows="1" placeholder="${esc(example(label,placeholder))}">${esc(r[key])}</textarea>`;
const titleField = (label, key, r, placeholder) => `<div class="ls-pl-note-title">${cellField(label,key,r,placeholder)}</div>`;
const note = (label, key, value, placeholder = '') => `<textarea aria-label="${esc(label)}" data-pl-note="${key}" rows="1" placeholder="${esc(example(label,placeholder))}">${esc(value)}</textarea>`;
const table = (headers, rows, label) => `<div class="ls-pl-note-table-wrap"><table class="ls-pl-note-table" aria-label="${esc(label)}"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
function actionText(w,a) {
  if (Object.hasOwn(a,'prose')) return str(a.prose);
  const who=find(w,'person',a.actorId)?.name || a.who;
  return [a.action ? `${who ? `${who}: ` : ''}${a.action}` : who, a.when ? `When: ${a.when}` : '', a.reason].filter(Boolean).join('\n');
}
function actionContent(w,a) {
  return `<p>${lines(actionText(w,a))}${a.status!=='planned'?` <small>(${actionStatus[a.status]})</small>`:''}</p>`;
}
function actionEditor(w,a) {
  return `<li data-pl-record="action" data-id="${esc(a.id)}" class="ls-pl-note-action ${a.status!=='planned'?'ls-pl-note-done':''}">${note('NPC action','prose',actionText(w,a),'At dawn, the merchant hires an escort if the road is still blocked.')}<div class="ls-pl-note-tools">${button('action-status',a.status==='planned'?'Mark happened':`${actionStatus[a.status]} · reopen`,`data-id="${esc(a.id)}" class="ls-pl-note-tool"`)}${button('delete-action','Delete',`data-id="${esc(a.id)}" class="ls-pl-note-tool" aria-label="Delete this plan"`)}${a.actorId&&find(w,'person',a.actorId)?link('person',find(w,'person',a.actorId)):''}</div></li>`;
}
function actionSection(w,selected,ownerType,ownerId) {
  return `<ul class="ls-pl-note-list">${selected.map(key=>find(w,'action',key)).filter(Boolean).map(a=>actionEditor(w,a)).join('')}</ul>${button('add-action','+ Add a plan',`data-owner="${ownerType}" data-id="${esc(ownerId)}" class="ls-pl-note-tool"`)}`;
}
function routeEditor(w,r) {
  return w.connections.filter(c=>c.fromId===r.id).map(c=>`<div class="ls-pl-note-route" data-pl-record="connection" data-id="${esc(c.id)}"><span>→ <strong>${esc(entryLabel(find(w,'resource',c.toId)||{name:'Choose a destination'}))}</strong></span>${cellField('How they can get there or learn about it','description',c,'A road, introduction, or clue leading here…')}<div class="ls-pl-note-tools">${choose('route-target',c.id,'Change destination')}${c.clueId?`<span>Clue: ${esc(name(find(w,'resource',c.clueId)))}</span>`:''}${choose('route-clue',c.id,c.clueId?'Change clue':'Link a clue')}${button('remove-route','Remove link',`data-id="${esc(c.id)}" class="ls-pl-note-tool"`)}</div></div>`).join('');
}
function routeContent(w,r,includeDirections=true) {
  return (includeDirections?block('Leads to further people or places',r.directions):'')+w.connections.filter(c=>c.fromId===r.id).map(c=>`<p>→ <strong>${esc(name(find(w,'resource',c.toId)))}:</strong> ${lines(c.description)}${c.clueId?` · Clue: ${esc(name(find(w,'resource',c.clueId)))} (${clueStatus[find(w,'resource',c.clueId)?.clueStatus]||'Unavailable'})`:''}</p>`).join('');
}
function visitText(r) {
  if(Object.hasOwn(r,'visitNote'))return str(r.visitNote);
  return [personKinds.includes(r.kind)?'':r.notes,r.state,r.obstacle,r.opportunity,r.directions].filter(Boolean).join('\n');
}
function visitContent(w,r) {
  return (personKinds.includes(r.kind)?personContent(w,r):'')+`<p>${lines(visitText(r))}</p>`+routeContent(w,r,false);
}
function visitEditor(w,r,owner='') {
  return `<li data-pl-record="resource" data-id="${esc(r.id)}"><div class="ls-pl-note-item-title">${cellField('Name of place or contact','name',r,'Place or contact')}</div>${personKinds.includes(r.kind)?`<div>${link('person',r)}${r.desire?` · ${lines(r.desire)}`:''}</div>`:''}${note('What happens here?','visitNote',visitText(r),'What is happening here, what can the party do, and where might it lead?')}${routeEditor(w,r)}<div class="ls-pl-note-tools">${choose('route-new',r.id,'+ Link a destination')}${reference(r)}${owner?button('unlink-visit','Remove from Adventure',`data-owner="${esc(owner)}" data-id="${esc(r.id)}" class="ls-pl-note-tool"`):'<small>Shared Adventure notes</small>'}</div></li>`;
}
function materialEditor(r) {
  return `<li data-pl-record="resource" data-id="${esc(r.id)}"><div class="ls-pl-note-item-title">${cellField('Material name','name',r,'Map, statistics, or handout')}</div>${cellField('Notes or rules reference','notes',r,'Notes or a rules reference…')}${reference(r)}</li>`;
}
function clueEditor(w,c) {
  return `<tr data-pl-record="resource" data-id="${esc(c.id)}"><td>${cellField('Clue','notes',c,'What evidence can they find?')}<div class="ls-pl-note-tools">${choose('clue-details',c.id,'Details')}${c.uuid?button('document','Open document',`data-id="${esc(c.id)}" class="ls-pl-note-tool"`):''}</div></td><td><textarea aria-label="Where the characters can find it" data-pl-source rows="1" placeholder="In the workshop’s accounts book.">${esc(sourceName(w,c))}</textarea>${c.method?`<small>${lines(c.method)}</small>`:''}</td><td class="ls-pl-note-found">${check('Found','data-pl-clue-found',c.clueStatus==='delivered')}${c.clueStatus==='unavailable'?'<small>Unavailable</small>':''}</td></tr>`;
}
function discoveryEditor(w,d) {
  const count=plannerClueCoverage(w,d);
  return `<div class="ls-pl-note-discovery" data-pl-record="discovery" data-id="${esc(d.id)}">${field('What do the characters need to learn?','title',d,'The tools are stored in the old warehouse.')}${d.conclusion?field('Additional discovery notes','conclusion',d):''}${table(['Clue','Where the characters can find it','Found?'],d.clueIds.map(key=>find(w,'resource',key)).filter(c=>c?.kind==='clue').map(c=>clueEditor(w,c)).join(''),'Clues to this discovery')}<div class="ls-pl-note-tools">${button('add-clue','+ Add a clue',`data-id="${esc(d.id)}" class="ls-pl-note-tool"`)}${choose('discovery-clue',d.id,'Link an existing clue')}<small data-pl-coverage="${esc(d.id)}">${count.clues} clues · ${count.sources} sources · ${count.found} found</small></div>${field('What have the players worked out so far?','understanding',d,'Their current conclusion…')}</div>`;
}
function participantsTable(w,a) {
  return table(['Person or group','What they want','Resources they can use'],a.participants.map(p=>{
    const r=find(w,'person',p.personId);
    return `<tr data-pl-record="participant" data-id="${esc(p.id)}" data-owner="${esc(a.id)}"><td>${r?link('person',r):cellField('Person or group','name',p,'Name')}<div class="ls-pl-note-tools">${choose('participant-person',p.id,r?'Change link':'Link existing',a.id)}${button('remove-participant','Remove',`data-owner="${esc(a.id)}" data-id="${esc(p.id)}" class="ls-pl-note-tool"`)}</div></td>${r?`<td data-pl-record="resource" data-id="${esc(r.id)}">${cellField('What they want','desire',r,'Their goal…')}</td><td data-pl-record="resource" data-id="${esc(r.id)}">${cellField('Resources they can use','assets',r,'People, equipment, information, influence…')}</td>`:`<td>${cellField('What they want','wants',p,'Their goal…')}</td><td>${cellField('Resources they can use','resources',p,'People, equipment, information, influence…')}</td>`}</tr>`;
  }).join(''),'Who is involved');
}
function adventureEditor(w,a) {
  const sessions=active(w.sessions).filter(s=>s.adventureId===a.id);
  return `<article class="ls-cw-editor ls-pl-note-page" data-pl-record="adventure" data-id="${esc(a.id)}">${titleField('Adventure name','title',a,'Adventure name')}<div class="ls-pl-note-tools ls-pl-note-status" aria-label="Adventure status">${Object.entries(adventureStatus).map(([key,label])=>button('adventure-status',label,`data-id="${esc(a.id)}" data-status="${key}" aria-pressed="${a.status===key}" class="ls-pl-note-tool"`)).join('')}</div>
    ${section('What is happening',field('The problem','summary',a,'What is going on?')+field('Why the party might get involved','stakes',a,'Why might the characters care?'))}
    ${section('Who is involved',participantsTable(w,a)+button('add-participant','+ Add a person or group',`data-id="${esc(a.id)}" class="ls-pl-note-tool"`))}
    ${section('What they will do if nobody stops them',actionSection(w,adventureActions(w,a),'adventure',a.id))}
    ${section('Places and people the party can visit',`<ul class="ls-pl-note-list">${a.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>visitEditor(w,r,a.id)).join('')}</ul><div class="ls-pl-note-tools">${button('add-visit','+ Add a place or contact',`data-id="${esc(a.id)}" class="ls-pl-note-tool"`)}${choose('adventure-visit',a.id,'Link existing')}</div>`)}
    ${section('Clues to an important discovery',`${a.revelationIds.map(key=>find(w,'discovery',key)).filter(Boolean).map(d=>discoveryEditor(w,d)).join('')}<div class="ls-pl-note-tools">${button('add-discovery','+ Add a discovery',`data-id="${esc(a.id)}" class="ls-pl-note-tool"`)}${choose('adventure-discovery',a.id,'Link existing')}<small>Optional. Aim for three clues from different sources; one useful clue is enough to act.</small></div>`)}
    ${section('Material to keep handy',`<ul class="ls-pl-note-list">${a.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(materialEditor).join('')}</ul><div class="ls-pl-note-tools">${button('add-material','+ Add material',`data-id="${esc(a.id)}" class="ls-pl-note-tool"`)}${choose('adventure-material',a.id,'Link existing')}</div>`)}
    ${section('Sessions',`<div class="ls-pl-note-links">${sessions.map(s=>`<div>${link('session',s)} <small>${s.status==='complete'?'Completed':''}</small></div>`).join('')}</div>${button('new-session','New Session for this Adventure',`data-adventure="${esc(a.id)}" class="ls-pl-note-tool"`)}`)}</article>`;
}
function personEditor(w,r) {
  const adventures=active(w.situations).filter(a=>a.participants.some(p=>p.personId===r.id)||a.visitIds.includes(r.id));
  return `<article class="ls-cw-editor ls-pl-note-page" data-pl-record="resource" data-id="${esc(r.id)}">${titleField('Person or Group name','name',r,'Person or group')}${reference(r)}${section('Who they are',plainArea('Who they are','data-pl-field="notes"',r.notes,'A few words about them…')+field('Where to find them','whereabouts',r)+field('One detail that helps portray them','memorable',r))}${section('Goals and resources',field('What they want','desire',r)+field('Resources they can use','assets',r)+field('What they know','knowledge',r))}${section('The party',field('How they feel about the party, and why','attitude',r))}${section('What they intend to do next, and when',actionSection(w,r.actionIds,'person',r.id))}<div class="ls-pl-note-links">${adventures.map(a=>link('adventure',a)).join('')}</div></article>`;
}
const previousJournals = (s) => ids([s.journalId,s.legacy?.prep?.detailJournalId,s.legacy?.prep?.journalId]).map(key=>button('existing-journal','Open earlier Session Journal',`data-id="${esc(key)}" class="ls-pl-note-tool"`)).join('');
function sessionEditor(w,s) {
  if(s.status==='complete')return `<article class="ls-cw-editor ls-pl-note-page"><p class="ls-pl-note-caption">Completed Session</p>${previousJournals(s)}${s.adventureId&&find(w,'adventure',s.adventureId)?link('adventure',find(w,'adventure',s.adventureId)):''}${s.snapshot?.content||savedNotes(s.legacy||s)}${button('reopen-session','Edit this completed Session',`data-id="${esc(s.id)}" class="ls-pl-note-tool"`)}${s.versions.length?fold(`versions-${s.id}`,`Earlier completed versions · ${s.versions.length}`,s.versions.map(v=>`<article>${v.snapshot?.content||savedNotes(v)}</article>`).join('')):''}</article>`;
  const a=find(w,'adventure',s.adventureId),clues=sessionClues(w,s),discoveries=sessionDiscoveries(w,s);
  return `<article class="ls-cw-editor ls-pl-note-page" data-pl-record="session" data-id="${esc(s.id)}">${titleField('Session name','title',s,'Session name')}<div class="ls-pl-note-tools"><span>Adventure: ${a?link('adventure',a):'Not linked'}</span>${choose('session-adventure',s.id,a?'Change':'Link Adventure')}${previousJournals(s)}</div>
    ${section('Where we start',field('Where are the characters now?','location',s)+field('What did they decide to do next?','intention',s))}
    ${section('People and places they could reach this session',`<ul class="ls-pl-note-list">${s.visitIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>visitEditor(w,r)).join('')}${s.personIds.filter(key=>!s.visitIds.includes(key)).map(key=>find(w,'person',key)).filter(Boolean).map(r=>`<li>${link('person',r)}${personContent(w,r)}</li>`).join('')}</ul><div class="ls-pl-note-tools">${choose('session-visits',s.id,'Choose people and places')}${choose('session-people',s.id,'Link another Person or Group')}</div>`)}
    ${section('What NPCs plan to do during this time',actionSection(w,s.actionIds,'session',s.id)+choose('session-actions',s.id,'Use existing plans'))}
    ${section('What I need ready',`<div class="ls-pl-note-checklist">${s.checklist.map(row=>`<div data-pl-record="checklist" data-owner="${esc(s.id)}" data-id="${esc(row.id)}">${check('Ready','data-pl-field="done"',row.done)}${cellField('Preparation item','text',row,'Map, statistics, rules, or handout…')}${button('remove-check','Remove',`data-owner="${esc(s.id)}" data-id="${esc(row.id)}" class="ls-pl-note-tool"`)}</div>`).join('')}</div>${button('add-check','+ Add preparation item',`data-id="${esc(s.id)}" class="ls-pl-note-tool"`)}<ul class="ls-pl-note-list">${s.materialIds.map(key=>find(w,'resource',key)).filter(Boolean).map(r=>`<li><strong>${esc(name(r))}</strong><p>${lines(r.notes)}</p>${reference(r)}</li>`).join('')}</ul><div class="ls-pl-note-tools">${choose('session-material',s.id,'Choose material')}${choose('session-clues',s.id,'Choose clues to keep handy')}</div>${s.clueIds.length?table(['Clue','Source'],s.clueIds.map(key=>find(w,'resource',key)).filter(Boolean).map(c=>`<tr><td>${lines(c.notes)}</td><td>${esc(sourceName(w,c))}</td></tr>`).join(''),'Prepared clues'):''}`)}
    ${section('Notes during the game',plainArea('Notes during the game','data-pl-field="notes"',s.notes,'Write as you play…'))}
    ${section('After the game',`<div data-pl-after="${esc(s.id)}">${area('What happened and what changed?','data-pl-after-field="summary"',s.after.summary)}${area('Which clues did they find, and what did they work out?','data-pl-after-field="discoveries"',s.after.discoveries)}${clues.length?table(['Clue','Found this game?'],w.resources.filter(c=>c.kind==='clue'&&clues.includes(c.id)).map(c=>`<tr><td>${lines(c.notes)}<small>${esc(sourceName(w,c))}</small></td><td class="ls-pl-note-found">${check(c.clueStatus==='delivered'?'Already found':'Found',`data-pl-found value="${esc(c.id)}" ${c.clueStatus==='delivered'?'disabled':''}`,c.clueStatus==='delivered'||s.after.foundClueIds.includes(c.id))}</td></tr>`).join(''),'Clues found'):''}${discoveries.map(d=>{const update=s.after.understanding.find(r=>r.discoveryId===d.id);return `<div data-pl-understanding="${esc(d.id)}"><strong>${esc(d.title)}</strong>${area('What have the players worked out so far?','data-pl-understanding-value',update?.value??d.understanding)}${check('Update this discovery when completing the Session','data-pl-understanding-apply',update?.apply)}</div>`;}).join('')}${area('What does the party intend to do next?','data-pl-after-field="nextIntent"',s.after.nextIntent)}${fold(`session-overview-${s.id}`,'Update Campaign Overview',`${input('Party location after the game','data-pl-after-field="location"',s.after.location,s.location)}${area('New facts to remember (optional)','data-pl-after-field="facts"',s.after.facts)}${check('Update Campaign Overview with this location, next intention, and new facts','data-pl-after-field="updateOverview"',s.after.updateOverview)}`)}</div>${button('complete-session','Complete Session and keep its history',`data-id="${esc(s.id)}" class="ls-cw-primary"`)}`)}</article>`;
}
function factsEditor(w) {
  return `<ul class="ls-pl-note-list" aria-label="Facts to remember">${w.factEntries.map(row=>`<li data-pl-record="fact" data-id="${esc(row.id)}">${cellField('Fact','text',row)}${button('remove-fact','Remove fact',`data-id="${esc(row.id)}" class="ls-pl-note-tool"`)}</li>`).join('')}</ul>${button('add-fact','+ Add Fact','class="ls-pl-note-tool"')}`;
}
function overview(c,w) {
  return `<div class="ls-cw-editor ls-pl-note-page"><div class="ls-pl-note-title">${input('Campaign name','name="campaignName"',c.name)}</div><p class="ls-pl-note-hint">Keep updating this note as the campaign progresses.</p>
    ${section('Campaign premise',plainArea('Campaign premise','name="campaignPremise"',c.premise))}
    ${section('Where we left off',input('The party is at','data-pl-current="location"',w.location)+area('They plan to','data-pl-current="partyIntent"',w.partyIntent))}
    ${section('Active adventures',`<p class="ls-pl-note-hint">Your ongoing Adventure notes. Create and manage them in Adventures.</p><ul class="ls-pl-note-list">${active(w.situations).filter(a=>a.status==='active').map(a=>`<li>${link('adventure',a)}</li>`).join('')||'<li class="ls-pl-note-empty">No active adventures yet.</li>'}</ul>`)}
    ${section('Consequences still to come',`<p class="ls-pl-note-hint">What happened, how someone will respond, and when. Mark a response Happened once it occurs; the note stays here.</p>`+actionSection(w,overviewActions(w).map(a=>a.id),'overview',''))}
    ${section('Facts to remember',`<p class="ls-pl-note-hint">Established names, promises, relationships, or changes to the world.</p>`+factsEditor(w))}</div>`;
}

function help() {
  return fold('help','When to create each entry · brief help',`<p><strong>Adventure:</strong> create one for a situation the party can engage with. Keep updating it across games.</p><p><strong>Session:</strong> create one for an individual game. Select the people, places, and material you might need; the linked Adventure stays the maintained record.</p><p><strong>Person or Group:</strong> optional notes for a recurring NPC or faction. A few lines inside an Adventure are often enough.</p><p>Start with what is happening, who wants what, and what they can use. Prepare nearby possibilities and destinations the party’s leads might reach. Add details only when useful.</p><p>Methods: <a href="https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots" target="_blank" rel="noopener noreferrer">Don’t Prep Plots</a> · <a href="https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule" target="_blank" rel="noopener noreferrer">Three Clue Rule</a> · <a href="https://thealexandrian.net/wordpress/52735/roleplaying-games/random-gm-tip-managing-prep-load" target="_blank" rel="noopener noreferrer">Managing Prep Load</a> · <a href="https://thealexandrian.net/wordpress/42961/roleplaying-games/smart-prep-part-4-campaign-status-documents" target="_blank" rel="noopener noreferrer">Campaign Status Documents</a>.</p>`);
}
function pickerOptions(w,p) {
  const a=find(w,'adventure',p.id),s=find(w,'session',p.id),d=find(w,'discovery',p.id);
  switch(p.kind) {
    case 'participant-person': return {title:'Link a Person or Group',records:people(w),clear:'Use plain notes instead'};
    case 'adventure-visit': return {title:'Link a place or person',records:visits(w).filter(r=>!a.visitIds.includes(r.id))};
    case 'adventure-material': return {title:'Link material',records:materials(w).filter(r=>!a.materialIds.includes(r.id))};
    case 'adventure-discovery': return {title:'Link a discovery',records:w.revelations.filter(r=>!a.revelationIds.includes(r.id))};
    case 'discovery-clue': return {title:'Link a clue',records:w.resources.filter(r=>r.kind==='clue'&&!d.clueIds.includes(r.id))};
    case 'clue-source': return {title:'Link a clue source',records:visits(w),clear:'Use a written source instead'};
    case 'route-new': return {title:'Where does this lead?',records:visits(w).filter(r=>r.id!==p.id)};
    case 'route-target': return {title:'Change destination',records:visits(w).filter(r=>r.id!==w.connections.find(c=>c.id===p.id)?.fromId)};
    case 'route-clue': return {title:'Link the evidence',records:w.resources.filter(r=>r.kind==='clue'),clear:'No clue needed'};
    case 'session-adventure': return {title:'Link an Adventure',records:active(w.situations),clear:'No Adventure linked'};
    case 'session-visits': return {title:'People and places for this Session',records:plannerSessionOptions(w,s),field:'visitIds'};
    case 'session-people': return {title:'Other People or Groups',records:people(w,s.personIds),field:'personIds'};
    case 'session-actions': return {title:'NPC plans for this Session',records:w.actions.filter(r=>r.status==='planned'||s.actionIds.includes(r.id)).map(r=>({...r,title:actionText(w,r)||'New plan'})),field:'actionIds'};
    case 'session-material': return {title:'Material for this Session',records:materials(w,s.materialIds),field:'materialIds'};
    case 'session-clues': return {title:'Clues to keep handy',records:w.resources.filter(r=>r.kind==='clue'&&sessionClues(w,s).includes(r.id)),field:'clueIds'};
    default: return {title:'Choose a record',records:[]};
  }
}
function pickerContent(w,p) {
  if(!p)return '';
  let title,body;
  if(p.kind==='document'||p.kind==='clue-details') {
    const r=find(w,'resource',p.id);if(!r)return '';
    title=p.kind==='document'?'Attach a Foundry document':'Clue details';
    body=`<div data-pl-record="resource" data-id="${esc(r.id)}">${p.kind==='clue-details'?`${field('Short name','name',r,'Optional short label',true)}${field('How it can be found','method',r)}${field('Shared source or obstacle','sourceGroup',r,'Same witness, archive, or obstacle',true)}${check('Unavailable','data-pl-clue-unavailable',r.clueStatus==='unavailable')}<div>${choose('clue-source',r.id,'Link a source')} ${esc(sourceName(w,r))}</div>`:''}<div class="ls-cw-drop" data-pl-drop="${esc(r.id)}">${field('Foundry document (optional)','uuid',r,'Drop a document or paste its UUID',true)}</div></div>`;
  } else {
    const config=pickerOptions(w,p);title=config.title;
    body=`<input type="search" data-pl-search aria-label="Find an entry" placeholder="Find an entry…" value="${esc(p.query||'')}">${config.field?`<div data-pl-record="session" data-id="${esc(p.id)}">`:''}<div class="ls-pl-note-picker-list">${config.clear?button('pick-link',config.clear,'data-value="" class="ls-pl-note-tool"'):''}${config.records.map(r=>`<div data-pl-option="${esc(entryLabel(r).toLowerCase())}" ${p.query&&!entryLabel(r).toLowerCase().includes(p.query.trim().toLowerCase())?'hidden':''}>${config.field?check(entryLabel(r),`data-pl-select="${config.field}" value="${esc(r.id)}"`,find(w,'session',p.id)[config.field].includes(r.id)):button('pick-link',esc(entryLabel(r)),`data-value="${esc(r.id)}"`)}</div>`).join('')||'<p>No existing entries to link yet.</p>'}</div>${config.field?'</div>':''}`;
  }
  return `<div class="ls-pl-note-picker-backdrop"><div class="ls-pl-note-picker" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${title}</h2>${button('close-picker','Done','class="ls-pl-note-tool"')}</header>${body}</div></div>`;
}
function applyPickerLink(w,p,value) {
  const config=pickerOptions(w,p);
  if(!value&&!config.clear)throw new Error('Choose an existing entry.');
  if(value&&!config.records.some(r=>r.id===value))throw new Error('That entry is no longer available.');
  if(p.kind==='participant-person')find(w,'adventure',p.owner).participants.find(r=>r.id===p.id).personId=value;
  else if(p.kind==='session-adventure')find(w,'session',p.id).adventureId=value;
  else if(p.kind==='clue-source') {const r=find(w,'resource',p.id);if(!value)r.source=sourceName(w,r);r.sourceId=value;}
  else if(p.kind==='route-new')w.connections.push({id:id(),fromId:p.id,toId:value,description:'',kind:'access',clueId:''});
  else if(p.kind==='route-target'||p.kind==='route-clue')w.connections.find(r=>r.id===p.id)[p.kind==='route-target'?'toId':'clueId']=value;
  else {const key={'adventure-visit':'visitIds','adventure-material':'materialIds','adventure-discovery':'revelationIds','discovery-clue':'clueIds'}[p.kind];const r=find(w,p.kind==='discovery-clue'?'discovery':'adventure',p.id);if(!key||!r)throw new Error('This link is no longer available.');r[key]=ids([...r[key],value]);}
}

function entryControls(type, record) {
  return `<div class="ls-planner-entry-actions">${button('delete-entry', `<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete ${entryTypes[type]}`, `data-type="${type}" data-id="${esc(record.id)}"`)}</div>`;
}
function deletedEntries(w) {
  const records = [['adventure', w.situations], ['session', w.sessions], ['person', w.resources.filter(r => personKinds.includes(r.kind))]]
    .flatMap(([type, entries]) => entries.filter(r => r.deletedAt).map(record => ({type, record})));
  if (!records.length) return '';
  return fold('deleted-entries', `Deleted entries · ${records.length}`, `<p>Restore an entry, or permanently remove it from the planner. Separate entries and Foundry documents are kept.</p>${records.map(({type, record}) => `<div class="ls-cw-row"><span><strong>${esc(name(record))}</strong> · ${entryTypes[type]}</span><div class="ls-pl-note-tools">${button('restore-entry', `Restore ${entryTypes[type]}`, `data-type="${type}" data-id="${esc(record.id)}"`)}${button('purge-entry','Delete permanently',`data-type="${type}" data-id="${esc(record.id)}" class="ls-pl-note-tool"`)}</div></div>`).join('')}`);
}
export function renderEntryPlanner(campaign,state={}) {
  const w=campaign.workspace, view=['overview','adventures','sessions','people'].includes(state.view)?state.view:'overview';
  const type={adventures:'adventure',sessions:'session',people:'person'}[view], records=type==='adventure'?active(w.situations):type==='session'?active(w.sessions):type==='person'?people(w):[];
  const selected=records.find(r=>r.id===state.selectedId);
  const create=type?`<div class="ls-planner-create">${button(`new-${type}`,`New ${entryTypes[type]}`,'class="ls-cw-primary"')}</div>`:'';
  let body=view==='overview'?overview(campaign,w):`<div class="ls-planner-columns"><aside class="ls-cw-index" aria-label="${esc(view)}">${create}${records.map(r=>`<div class="${r.id===state.selectedId?'selected':''}">${link(type,r)}${type==='session'?`<small>${r.status==='complete'?'Completed':'Preparing / playing'}</small>`:type==='adventure'?`<small>${adventureStatus[r.status]}</small>`:''}</div>`).join('')||'<p class="ls-cw-empty">Create your first entry here.</p>'}</aside><div>${selected?entryControls(type,selected)+(type==='adventure'?adventureEditor(w,selected):type==='session'?sessionEditor(w,selected):personEditor(w,selected)):'<p class="ls-cw-empty">Open an entry to keep working on it, or create a new one.</p>'}</div></div>`;
  const html=`<section class="ls-panel ls-cw ls-planner ls-notebook" data-campaign-workspace><header><div><h1>Campaign Planner</h1><small>Click a note or table cell to edit. Changes save automatically.</small></div></header><nav class="ls-cw-tabs" aria-label="Campaign planner">${Object.entries({overview:'Campaign Overview',adventures:'Adventures',sessions:'Sessions',people:'People or Groups'}).map(([key,label])=>button('view',label,`data-view="${key}" aria-pressed="${key===view}"`)).join('')}</nav>${body}${view==='overview'?`<div class="ls-planner-reset"><div>${button('clear-planner','Clear planner')}<small>Empty this browser’s saved campaign notes and entries.</small></div>${check('Erase my saved planner after each module update','data-pl-reset-on-update',state.resetOnUpdate)}</div>`:''}${pickerContent(w,state.picker)}${deletedEntries(w)}${help()}<footer class="ls-cw-footer">${button('journal',selected?'Create / update this entry’s Journal':'Create / update Overview Journal',selected?`data-type="${type}" data-id="${esc(selected.id)}"`:'data-type="overview"')}<small>Drafts save automatically. Journals are snapshots you can open in Foundry.</small><span data-cw-save aria-live="polite"></span></footer></section>`;
  return html.replace(/<details data-pl-fold="([^"]+)"\s*(open)?/g,(_,key,open)=>`<details data-pl-fold="${key}"${(state.openDetails?.[key]??Boolean(open))?' open':''}`);
}

function recordForCard(w, card) {
  const type=card.dataset.plRecord,key=card.dataset.id;
  if(type==='fact') return w.factEntries.find(r=>r.id===key);
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
  const edits=[];
  container.querySelectorAll('[data-pl-record]').forEach(card=>{
    const record=recordForCard(w,card); if(!record || card.dataset.plRecord==='session'&&record.status==='complete') return;
    card.querySelectorAll('[data-pl-field], [data-pl-note], [data-pl-source], [data-pl-clue-found], [data-pl-clue-unavailable]').forEach(el=>{
      if(el.closest('[data-pl-record]')!==card)return;
      const key=el.dataset.plField, checkbox=el.type==='checkbox';
      if(checkbox ? el.checked===el.defaultChecked : el.value===el.defaultValue)return;
      edits.push({el,record,order:Number(el.dataset.plEditOrder)||0,apply:()=>{
        if(key&&Object.hasOwn(record,key))record[key]=checkbox?el.checked:el.value;
        else if(el.dataset.plNote==='prose'&&card.dataset.plRecord==='action')record.prose=el.value;
        else if(el.dataset.plNote==='visitNote'&&card.dataset.plRecord==='resource')record.visitNote=el.value;
        else if(el.hasAttribute('data-pl-source')){record.source=el.value;record.sourceId='';}
        else if(el.hasAttribute('data-pl-clue-found'))record.clueStatus=el.checked?'delivered':record.clueStatus==='unavailable'?'unavailable':'prepared';
        else if(el.hasAttribute('data-pl-clue-unavailable'))record.clueStatus=el.checked?'unavailable':record.clueStatus==='unavailable'?'prepared':record.clueStatus;
      }});
    });
    if(card.dataset.plRecord==='session') {
      for(const key of ['visitIds','personIds','actionIds','clueIds','materialIds']) {
        const controls=[...card.querySelectorAll(`[data-pl-select="${key}"]`)];
        const visible=new Set(controls.map(el=>el.value));
        record[key]=ids([...record[key].filter(rid=>!visible.has(rid)),...controls.filter(el=>el.checked).map(el=>el.value)]);
      }
    }
  });
  edits.sort((a,b)=>a.order-b.order).forEach(edit=>edit.apply());
  for(const r of w.resources.filter(r=>r.kind==='clue'))r.discovered=r.clueStatus==='delivered';
  // The same clue/person may appear in several tables. Reflect its one maintained value.
  container.querySelectorAll('[data-pl-record]').forEach(card=>{
    const record=recordForCard(w,card);if(!record)return;
    card.querySelectorAll('[data-pl-field], [data-pl-note], [data-pl-source], [data-pl-clue-found], [data-pl-clue-unavailable]').forEach(el=>{
      if(el.closest('[data-pl-record]')!==card)return;
      let value;
      if(el.dataset.plField)value=record[el.dataset.plField];
      else if(el.dataset.plNote==='prose')value=actionText(w,record);
      else if(el.dataset.plNote==='visitNote')value=visitText(record);
      else if(el.hasAttribute('data-pl-source'))value=sourceName(w,record);
      else value=record.clueStatus===(el.hasAttribute('data-pl-clue-found')?'delivered':'unavailable');
      if(value===undefined)return;
      if(el.type==='checkbox'){el.checked=Boolean(value);el.defaultChecked=el.checked;}
      else {if(el.value!==String(value))el.value=String(value);el.defaultValue=el.value;}
    });
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
  if(edits.some(edit=>edit.el.closest('[data-pl-record]')?.dataset.plRecord==='fact'))syncFacts(w);
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
  return `<h1>${esc(c.name||'Campaign')}</h1>${block('Campaign premise',c.premise)}${block('The party is at',w.location)}${block('They plan to',w.partyIntent)}<h2>Active adventures</h2><ul>${active(w.situations).filter(a=>a.status==='active').map(a=>`<li>${esc(a.title)}</li>`).join('')}</ul><h2>Consequences still to come</h2>${overviewActions(w).map(a=>actionContent(w,a)).join('')}<h2>Facts to remember</h2><ul>${w.factEntries.filter(row=>hasText(row.text)).map(row=>`<li>${lines(row.text)}</li>`).join('')}</ul>`;
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
  let editOrder=0;
  const fitNotes=()=>root.querySelectorAll('textarea').forEach(el=>{if(el.getClientRects().length){el.style.height='auto';el.style.height=`${Math.max(32,el.scrollHeight+2)}px`;}});
  fitNotes();
  app.campaignNoteObserver?.disconnect();
  if(globalThis.ResizeObserver){const observer=new ResizeObserver(()=>{if(root.isConnected)fitNotes();else observer.disconnect();});app.campaignNoteObserver=observer;observer.observe(root);}
  const picker=root.querySelector('[role="dialog"]');
  if(picker)queueMicrotask(()=>picker.querySelector('[data-pl-search], input:not([type=checkbox]), textarea')?.focus());
  const status=(message)=>{const el=app.element?.querySelector('[data-cw-save]');if(el)el.textContent=message;};
  const save=async()=>{await app.syncCampaignForm();const w=app.campaign.workspace;root.querySelectorAll('[data-pl-coverage]').forEach(el=>{const d=find(w,'discovery',el.dataset.plCoverage);if(d){const c=plannerClueCoverage(w,d);el.textContent=`${c.clues} clues · ${c.sources} sources · ${c.found} found`;}});fitNotes();status('Saved');};
  const render=()=>app.renderCampaignPreservingScroll();
  const fail=(error)=>{console.error('Lore Smith | Campaign planner',error);status('Not saved — keep this window open and retry');globalThis.ui?.notifications.error(error.message||'The campaign could not be saved.');};
  const lock=()=>{busy=true;root.inert=true;app.campaignWorkspacePending=new Promise(resolve=>{release=resolve;});};
  const unlock=()=>{busy=false;root.inert=false;release?.();};
  const state=()=>app.campaignWorkspaceState;
  const open=(type,key)=>{state().view={adventure:'adventures',session:'sessions',person:'people'}[type]||'overview';state().selectedId=key||'';state().planner=false;state().picker=null;};
  root.addEventListener('toggle',event=>{const key=event.target.dataset.plFold;if(key){state().openDetails??={};state().openDetails[key]=event.target.open;fitNotes();}},true);
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-pl-search]')){state().picker.query=event.target.value;const term=event.target.value.trim().toLowerCase();root.querySelectorAll('[data-pl-option]').forEach(el=>{el.hidden=!el.dataset.plOption.includes(term);});return;}
    event.target.dataset.plEditOrder=String(++editOrder);fitNotes();status('Saving…');clearTimeout(app.campaignSaveTimer);app.campaignSaveTimer=setTimeout(()=>{if(!busy&&root.isConnected)void save().catch(fail);},350);
  });
  root.addEventListener('keydown',event=>{
    const dialog=root.querySelector('[role="dialog"]');if(!dialog)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.querySelector('[data-pl-action="close-picker"]')?.click();}
    if(event.key==='Tab'){const controls=[...dialog.querySelectorAll('button,input,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  root.addEventListener('change',async event=>{
    if(busy)return;const el=event.target;
    if(el.matches('[data-pl-reset-on-update]')) {
      clearTimeout(app.campaignSaveTimer);lock();
      try { await save();await app.setPlannerResetOnUpdate(el.checked);state().resetOnUpdate=el.checked;status('Saved'); }
      catch(error) { el.checked=!el.checked;fail(error); } finally { unlock(); }
      return;
    }
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
      if(action==='clear-planner') {
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Clear planner'},content:'<p>Erase this browser’s saved Campaign Planner: the name, premise, notes, Adventures, Sessions, People or Groups, and deleted entries?</p><p>This cannot be undone. Linked preparation drafts are also cleared. Foundry Journals, maps, and other builders are separate and will remain.</p>',yes:{label:'Clear planner'},no:{label:'Cancel'}});
        if(!confirmed)return;
        await app.clearCampaignPlanner();committed=true;await render();return;
      }
      if(action==='view'){state().view=target.dataset.view;state().selectedId='';state().picker=null;}
      if(action==='open')open(target.dataset.type,key);
      if(action==='choose-link')state().picker={kind:target.dataset.kind,id:key,owner:target.dataset.owner};
      if(action==='close-picker')state().picker=null;
      if(action==='pick-link'){applyPickerLink(w,state().picker,target.dataset.value);state().picker=null;}
      if(action==='adventure-status'&&Object.hasOwn(adventureStatus,target.dataset.status))find(w,'adventure',key).status=target.dataset.status;
      if(action==='action-status'){const a=find(w,'action',key);a.status=a.status==='planned'?'happened':'planned';}
      if(action==='delete-action') {
        const plan=find(w,'action',key);if(!plan)throw new Error('This plan is no longer available.');
        if(hasText(actionText(w,plan))) {
          const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:'Delete plan'},content:'<p>Delete this plan from the planner and any linked entries? Completed Session snapshots will be kept.</p>'});
          if(!confirmed)return;
        }
        deletePlannerAction(w,key);
      }
      if(action==='delete-entry') {
        const type=target.dataset.type,record=find(w,type,key);
        if(!Object.hasOwn(entryTypes,type)||!record)throw new Error('This entry is no longer available.');
        const details=type==='adventure' ? 'Its Sessions, shared people, places, clues, and Foundry documents will be kept.' : type==='session' ? 'The Adventure, shared material, Foundry Journals, and campaign updates already recorded will be kept.' : 'Existing links will keep these notes. This entry will no longer be offered for new links. Foundry documents will be kept.';
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:`Delete ${entryTypes[type]}`},content:`<p>Move <strong>${esc(name(record))}</strong> to Deleted entries?</p><p>${details}</p><p>You can restore it from <strong>Deleted entries</strong> below the planner.</p>`});
        if(!confirmed)return;
        setPlannerEntryDeleted(app.campaign,type,key);open(type,'');
      }
      if(action==='purge-entry') {
        const type=target.dataset.type,record=find(w,type,key);
        if(!Object.hasOwn(entryTypes,type)||!record?.deletedAt)throw new Error('Choose an entry in Deleted entries.');
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:`Permanently delete ${entryTypes[type]}`},content:`<p>Permanently delete <strong>${esc(name(record))}</strong> from the planner?</p><p>This cannot be undone. Its live links will be detached. Separate entries, completed history in other Sessions, and Foundry documents will be kept.</p>`});
        if(!confirmed)return;
        permanentlyDeletePlannerEntry(app.campaign,type,key);
      }
      if(action==='add-fact'){w.factEntries.push({id:id(),text:''});syncFacts(w);}
      if(action==='remove-fact'){w.factEntries=w.factEntries.filter(row=>row.id!==key);syncFacts(w);}
      if(action==='restore-entry') {setPlannerEntryDeleted(app.campaign,target.dataset.type,key,false);open(target.dataset.type,key);}
      if(action==='new-adventure'||action==='new-person'||action==='new-session') {
        const type=action.slice(4),entry=createPlannerEntry(app.campaign,type,target.dataset.adventure||'');open(type,entry.id);
      }
      if(action==='add-participant')find(w,'adventure',key).participants.push({id:id(),personId:'',name:'',wants:'',resources:''});
      if(action==='remove-participant'){const a=find(w,'adventure',target.dataset.owner);a.participants=a.participants.filter(p=>p.id!==key);}
      if(action==='add-action') {
        const owner=target.dataset.owner,record=find(w,owner,key);
        const a=newPlannerAction(owner==='adventure'?key:owner==='session'?record.adventureId:'',owner==='person'?key:'');w.actions.push(a);
        a.overview=owner==='overview';
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
