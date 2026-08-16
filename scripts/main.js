const MODULE_ID = "lore-smith";
const FLAG_SCOPE = MODULE_ID;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const ITEM_TYPE_LABELS = {
  action: "Action",
  ammo: "Ammunition",
  affliction: "Affliction",
  ancestry: "Ancestry",
  armor: "Armor",
  background: "Background",
  backpack: "Container",
  book: "Book",
  class: "Class",
  condition: "Condition",
  consumable: "Consumable",
  effect: "Effect",
  equipment: "Equipment",
  feat: "Feat",
  heritage: "Heritage",
  kit: "Kit",
  lore: "Lore",
  melee: "NPC Strike",
  shield: "Shield",
  spell: "Spell",
  spellcastingEntry: "Spellcasting Entry",
  treasure: "Treasure",
  weapon: "Weapon",
};

function getHtmlRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
}

function escapeHtml(value = "") {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function activateWikiLinks(editor) {
  if (!editor) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest(".ls-wiki-link")) return NodeFilter.FILTER_REJECT;
      return /\[\[[^\]\n]{1,100}\]\]/.test(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/\[\[([^\]\n]{1,100})\]\]/g)) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const link = document.createElement("span");
      link.className = "ls-wiki-link";
      link.dataset.noteName = match[1].trim();
      link.contentEditable = "false";
      link.tabIndex = 0;
      link.title = `Open or create “${match[1].trim()}”`;
      link.textContent = match[1].trim();
      fragment.append(link);
      cursor = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

function insertCompletedWikiPair() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const textNode = range.startContainer;
  const before = textNode.nodeValue?.slice(0, range.startOffset) ?? "";
  if (!before.endsWith("[")) return false;
  textNode.insertData(range.startOffset, "[]]");
  range.setStart(textNode, range.startOffset + 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function numeric(value, fallback = 0) {
  const result = Number(value?.value ?? value?.mod ?? value?.modifier ?? value);
  return Number.isFinite(result) ? result : fallback;
}


function newSessionLocation() {
  return { id: foundry.utils.randomID(), name: "", image: "", purpose: "", sight: "", hearing: "", smell: "", touch: "", taste: "" };
}

function newSessionNpc() {
  return { id: foundry.utils.randomID(), name: "", image: "", role: "", motivation: "", secret: "" };
}

const SESSION_MUSIC_MOMENTS = ["Opening", "Exploration", "Social scene", "Tension", "Combat", "Revelation", "Victory", "Defeat", "Closing", "Custom"];

function newSessionMusicCue() {
  return { id: foundry.utils.randomID(), name: "", moment: "Opening", mood: "", playlistId: "", soundId: "", audio: "", notes: "" };
}

function newSessionPeopleEntry(description = "") {
  return { id: foundry.utils.randomID(), name: "", description };
}

function newSessionTextEntry(text = "") {
  return { id: foundry.utils.randomID(), text };
}

function newSessionEncounter() {
  return { id: foundry.utils.randomID(), type: "social", description: "", actors: [] };
}

function newSessionPrep(campaignLink = null) {
  return {
    campaignLink,
    title: "", goal: "", opening: "", ending: "",
    locations: [newSessionLocation(), newSessionLocation()],
    npcs: [newSessionNpc()],
    musicCues: [newSessionMusicCue()],
    peopleEntries: [newSessionPeopleEntry()], hazards: [], encounterEntries: [newSessionEncounter()],
    sceneEntries: [newSessionTextEntry()], clueEntries: [newSessionTextEntry()], rewardItems: [],
    consequenceEntries: [newSessionTextEntry()], changeEntries: [newSessionTextEntry()],
    people: "", opposition: "", scenes: "", rewards: "", reminders: "",
  };
}

function sessionHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function sessionBlock(title, value) {
  const content = String(value ?? "").trim();
  return content ? `<p><strong>${escapeHtml(title)}</strong></p><p>${sessionHtml(content)}</p>` : "";
}

function sessionLocationPage(location) {
  const senses = [["Sight", location.sight], ["Hearing", location.hearing], ["Smell", location.smell], ["Touch", location.touch], ["Taste", location.taste]]
    .filter(([, value]) => String(value ?? "").trim())
    .map(([sense, value]) => `<p><strong>${sense}</strong> ${sessionHtml(value)}</p>`).join("");
  const image = String(location.image ?? "").trim()
    ? `<figure><img src="${escapeHtml(location.image)}" alt="${escapeHtml(location.name)}"></figure>` : "";
  return `${image}${sessionBlock("Why this place matters", location.purpose)}${senses ? `<hr><p><strong>Description</strong></p>${senses}` : ""}` || "<p>Describe this location before play.</p>";
}

function sessionNpcPage(npc) {
  const image = String(npc.image ?? "").trim()
    ? `<figure><img src="${escapeHtml(npc.image)}" alt="${escapeHtml(npc.name)}"></figure>` : "";
  return `${image}${sessionBlock("Role in the session", npc.role)}${sessionBlock("Motivation", npc.motivation)}${sessionBlock("Secret or complication", npc.secret)}`
    || "<p>Add this NPC's role, motivation, and secrets here.</p>";
}

function sessionReferenceLink(reference) {
  return reference?.uuid ? `@UUID[${reference.uuid}]{${escapeHtml(reference.name || "Foundry document")}}` : escapeHtml(reference?.name || "Foundry document");
}

function sessionList(title, entries) {
  const rows = entries.filter((value) => String(value ?? "").trim());
  return rows.length ? `<p><strong>${escapeHtml(title)}</strong></p><ul>${rows.map((value) => `<li>${sessionHtml(value)}</li>`).join("")}</ul>` : "";
}

function normalizeSessionReference(reference = {}) {
  return {
    id: reference.id || foundry.utils.randomID(),
    uuid: String(reference.uuid ?? ""), name: String(reference.name ?? "Foundry document"),
    img: String(reference.img ?? "icons/svg/item-bag.svg"), type: String(reference.type ?? ""),
  };
}

function normalizeSessionTextEntries(entries, fallback = "") {
  const source = Array.isArray(entries) && entries.length ? entries : [newSessionTextEntry(fallback)];
  return source.map((entry) => ({ ...newSessionTextEntry(), ...entry, id: entry.id || foundry.utils.randomID() }));
}

const CAMPAIGN_LENGTHS = {
  short: { label: "Short campaign", scope: "A focused campaign with one central conflict, 3–5 major milestones, a compact setting, and a clear range of possible endings.", structureLabel: "Campaign milestones", structureSingular: "Milestone", structureSummaryLabel: "Situation or turning point", structureOutcomeLabel: "Possible outcomes and transition", resolutionLabel: "Possible campaign endings", structureMin: 3, locationMin: 2, factionMin: 2, threatMin: 2, peopleMin: 3 },
  long: { label: "Long campaign", scope: "A multi-arc campaign with evolving threats, several regions, recurring factions, character development, and 3 or more distinct story arcs.", structureLabel: "Story arcs", structureSingular: "Arc", structureSummaryLabel: "Central conflict and developments", structureOutcomeLabel: "How this reshapes later arcs", resolutionLabel: "Possible endings and lasting outcomes", structureMin: 3, locationMin: 4, factionMin: 4, threatMin: 3, peopleMin: 5 },
  open: { label: "Open-ended sandbox", scope: "A reactive campaign built from locations, opportunities, faction agendas, and threat clocks rather than a predetermined sequence or ending.", structureLabel: "Active situations and opportunities", structureSingular: "Situation", structureSummaryLabel: "Who wants what, and what is happening now?", structureOutcomeLabel: "What advances or changes if ignored?", resolutionLabel: "Ways the world can change through play", structureMin: 4, locationMin: 4, factionMin: 4, threatMin: 4, peopleMin: 4 },
};

const CAMPAIGN_STYLES = {
  adventure: {
    label: "Adventure",
    guidance: "Keep the objective visible, make each location present a meaningful choice, and let success change the situation.",
    people: ["A capable ally who can point toward the first objective", "An opponent actively advancing the central problem", "A witness who knows where the danger began"],
  },
  mystery: {
    label: "Mystery",
    guidance: "Define the true answer privately, then make every essential conclusion discoverable through multiple clues.",
    people: ["A witness who wants the truth discovered", "A suspect or obstructive authority", "An informed person who is hiding part of the truth"],
  },
  exploration: {
    label: "Exploration",
    guidance: "Give places distinct identities, discoveries, routes, and risks. Travel should reveal choices rather than consume time by itself.",
    people: ["A guide, patron, or survivor", "A rival explorer or territorial resident", "A scholar who understands one part of the destination"],
  },
  politics: {
    label: "Political intrigue",
    guidance: "Give every important person a public objective, a private need, and leverage that can change their position.",
    people: ["A potential ally with a price", "A rival representative with legitimate interests", "An intermediary who knows the relationships between factions"],
  },
  horror: {
    label: "Horror",
    guidance: "Establish boundaries first, reveal the threat gradually, and preserve meaningful choices even when the characters feel vulnerable.",
    people: ["A survivor or protector", "A person influenced by the threat", "A witness who understands one disturbing sign"],
  },
  sandbox: {
    label: "Sandbox",
    guidance: "Prepare active situations, not a sequence. The world should react consistently to whichever direction the party chooses.",
    people: ["A local contact offering an opportunity", "A rival pursuing their own objective", "A well-connected person who knows several possible directions"],
  },
};

const CAMPAIGN_TONES = {
  heroic: "Heroic and hopeful",
  "dark-heroic": "Dark but heroic",
  lighthearted: "Lighthearted",
  grim: "Grim and dangerous",
  mythic: "Mythic and wondrous",
};

function newCampaignPerson(slot, label) {
  return { id: foundry.utils.randomID(), slot, label, name: "", description: "", wants: "", knows: "", secret: "" };
}

function newCampaignCharacter() {
  return { id: foundry.utils.randomID(), name: "", involvement: "", npcConnection: "", desire: "", bond: "", complication: "", growth: "" };
}

function newCampaignStructure() {
  return { id: foundry.utils.randomID(), name: "", summary: "", outcome: "" };
}

function newCampaignLocation() {
  return {
    id: foundry.utils.randomID(), name: "", type: "settlement", x: null, y: null, image: "",
    description: "", importance: "", secret: "", currentSituation: "", people: "", services: "",
    reasonToLeave: "", ignored: "", relationship: "", reasonToVisit: "", opportunity: "",
    danger: "", lead: "", travel: "", knownFor: "", rumor: "", futureUse: "",
  };
}

function normalizeSessionPrep(stored = {}) {
  const fresh = newSessionPrep(stored.campaignLink ?? null);
  const storedLocations = Array.isArray(stored.locations) ? stored.locations : [];
  return {
    ...fresh,
    ...stored,
    campaignLink: stored.campaignLink && typeof stored.campaignLink === "object" ? { ...stored.campaignLink } : null,
    locations: storedLocations.length
      ? storedLocations.map((location) => ({ ...newSessionLocation(), ...location, id: location.id || foundry.utils.randomID() }))
      : fresh.locations,
    npcs: Array.isArray(stored.npcs)
      ? stored.npcs.map((npc) => ({ ...newSessionNpc(), ...npc, id: npc.id || foundry.utils.randomID() }))
      : fresh.npcs,
    musicCues: Array.isArray(stored.musicCues)
      ? stored.musicCues.map((cue) => ({ ...newSessionMusicCue(), ...cue, id: cue.id || foundry.utils.randomID() }))
      : fresh.musicCues,
    peopleEntries: Array.isArray(stored.peopleEntries)
      ? stored.peopleEntries.map((entry) => ({ ...newSessionPeopleEntry(), ...entry, id: entry.id || foundry.utils.randomID() }))
      : [newSessionPeopleEntry(stored.people ?? "")],
    hazards: Array.isArray(stored.hazards) ? stored.hazards.map(normalizeSessionReference) : [],
    encounterEntries: Array.isArray(stored.encounterEntries)
      ? stored.encounterEntries.map((entry) => ({ ...newSessionEncounter(), ...entry, id: entry.id || foundry.utils.randomID(), actors: (entry.actors ?? []).map(normalizeSessionReference) }))
      : [newSessionEncounter()],
    sceneEntries: normalizeSessionTextEntries(stored.sceneEntries, stored.scenes ?? ""),
    clueEntries: normalizeSessionTextEntries(stored.clueEntries),
    rewardItems: Array.isArray(stored.rewardItems) ? stored.rewardItems.map(normalizeSessionReference) : [],
    consequenceEntries: normalizeSessionTextEntries(stored.consequenceEntries, stored.rewards ?? ""),
    changeEntries: normalizeSessionTextEntries(stored.changeEntries),
  };
}

function newCampaignRoute() {
  return { id: foundry.utils.randomID(), fromId: "", toId: "", type: "road", travel: "", feature: "", complication: "" };
}

const CAMPAIGN_POINT_TYPES = {
  settlement: "Settlement", city: "City", town: "Town", village: "Village", landmark: "Landmark",
  ruin: "Ruins", dungeon: "Dungeon", lake: "Lake", river: "River", mountains: "Mountains",
  forest: "Forest", road: "Road", pass: "Mountain pass", custom: "Custom",
};

const CAMPAIGN_POINT_ICONS = {
  settlement: "fa-house", city: "fa-city", town: "fa-building", village: "fa-house-chimney",
  landmark: "fa-monument", ruin: "fa-archway", dungeon: "fa-dungeon", lake: "fa-water",
  river: "fa-water", mountains: "fa-mountain", forest: "fa-tree", road: "fa-road",
  pass: "fa-mountain-sun", custom: "fa-location-dot",
};

function campaignMapRecoveryKey() {
  return `${MODULE_ID}.campaign-map-recovery.${game.world?.id ?? "world"}.${game.user?.id ?? "user"}`;
}

function readCampaignMapRecovery() {
  try {
    const raw = globalThis.localStorage?.getItem(campaignMapRecoveryKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Lore Smith | Could not read the emergency campaign-map recovery copy.", error);
    return null;
  }
}

function writeCampaignMapRecovery(serialized) {
  try {
    globalThis.localStorage?.setItem(campaignMapRecoveryKey(), serialized);
  } catch (error) {
    console.warn("Lore Smith | Could not write the emergency campaign-map recovery copy.", error);
  }
}

function parseStoredDraft(raw, label) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Lore Smith | Could not read the ${label} campaign-map draft.`, error);
    return null;
  }
}

const CAMPAIGN_ROUTE_TYPES = {
  road: "Road", trail: "Trail", river: "River route", ferry: "Ferry or sea route", pass: "Mountain pass",
  trade: "Trade connection", political: "Political relationship", conflict: "Conflict", mystery: "Shared mystery",
};

function newCampaignFaction() {
  return { id: foundry.utils.randomID(), name: "", goal: "", methods: "", resources: "", relationship: "", ignored: "" };
}

function newCampaignThreat() {
  return { id: foundry.utils.randomID(), name: "", goal: "", escalation: "", consequences: "" };
}

function newCampaignQuestion() {
  return { id: foundry.utils.randomID(), text: "" };
}

function newCampaignSecret() {
  return { id: foundry.utils.randomID(), secret: "", clues: "", knownBy: "" };
}

function newCampaignRumor() {
  return { id: foundry.utils.randomID(), text: "", truth: "" };
}

function newCampaignWorldEvent() {
  return { id: foundry.utils.randomID(), trigger: "", event: "", consequence: "" };
}

function newCampaignChapter(number = 1) {
  return {
    id: foundry.utils.randomID(), number, title: "", purpose: "", opening: "", information: "",
    locations: "", npcs: "", scenes: "", revelations: "", encounters: "", rewards: "",
    choices: "", consequences: "", transition: "",
  };
}

const CAMPAIGN_ACT_CHAPTERS = [
  { name: "Introduction", guidance: "Establish the situation, put the Act's problem in front of the characters, and give them a reason to engage with it." },
  { name: "Escalation", guidance: "Complicate the situation, reveal useful information, make choices matter, and increase pressure without dictating one route." },
  { name: "Resolution", guidance: "Bring the Act's central problem to a decisive change and establish what becomes true before the next Act begins." },
];

function newCampaignActSession(number = 1) {
  return { id: foundry.utils.randomID(), number, title: "", purpose: "", prep: null, journalId: "" };
}

function newCampaignActChapter(number = 1) {
  const preset = CAMPAIGN_ACT_CHAPTERS[number - 1] ?? CAMPAIGN_ACT_CHAPTERS[1];
  return { id: foundry.utils.randomID(), number, name: preset.name, guidance: preset.guidance, sessions: [] };
}

function campaignActChapterCounts(total) {
  const sessions = Math.max(3, Math.min(100, Number(total) || 3));
  const introduction = Math.max(1, Math.round(sessions * 0.25));
  const resolution = Math.max(1, Math.round(sessions * 0.25));
  return [introduction, Math.max(1, sessions - introduction - resolution), resolution];
}

function ensureCampaignActChapters(act) {
  act.estimatedSessions = Math.max(3, Math.min(100, Number(act.estimatedSessions) || 3));
  const storedChapters = Array.isArray(act.chapters) ? act.chapters : [];
  const existing = [...(act.archivedSessions ?? []), ...storedChapters.flatMap((chapter) => Array.isArray(chapter.sessions) ? chapter.sessions : [])];
  const byNumber = new Map(existing.map((session) => [Number(session.number), session]));
  const sessions = Array.from({ length: act.estimatedSessions }, (_, index) => {
    const stored = byNumber.get(index + 1) ?? newCampaignActSession(index + 1);
    return {
      ...newCampaignActSession(index + 1), ...stored,
      id: stored.id || foundry.utils.randomID(), number: index + 1,
      prep: stored.prep && typeof stored.prep === "object" ? normalizeSessionPrep(stored.prep) : null,
      journalId: String(stored.journalId ?? ""),
    };
  });
  act.archivedSessions = existing.filter((session) => Number(session.number) > act.estimatedSessions);
  const counts = campaignActChapterCounts(act.estimatedSessions);
  let offset = 0;
  act.chapters = CAMPAIGN_ACT_CHAPTERS.map((preset, index) => {
    const stored = storedChapters[index] ?? {};
    const count = counts[index];
    const chapter = {
      ...newCampaignActChapter(index + 1), ...stored,
      id: stored.id || foundry.utils.randomID(), number: index + 1,
      name: preset.name, guidance: preset.guidance,
      sessions: sessions.slice(offset, offset + count),
    };
    offset += count;
    return chapter;
  });
  return act;
}

function campaignActMissingRequirements(campaign, act) {
  const missing = [];
  if (!campaign?.name?.trim()) missing.push("Name the campaign.");
  if (!act?.name?.trim()) missing.push("Name this act.");
  if (!act?.objective?.trim()) missing.push("Describe what this act must accomplish.");
  if (!act?.startingSituation?.trim()) missing.push("Describe how the act begins.");
  if (!act?.endingCondition?.trim()) missing.push("Describe what ends this act.");
  for (const session of act?.chapters?.flatMap((chapter) => chapter.sessions ?? []) ?? []) {
    if (!session.title?.trim()) missing.push(`Name Session ${session.number}.`);
    if (!session.purpose?.trim()) missing.push(`Describe what Session ${session.number} should accomplish.`);
  }
  return missing;
}

function newCampaignAct(number = 1) {
  const defaults = [
    { name: "Introduction", objective: "", guidance: "Introduce the characters to the central problem, give them a reason to act, and end with a decision that carries them into the wider conflict." },
    { name: "Escalation", objective: "", guidance: "Make the problem harder to ignore, reveal important truths, let earlier choices matter, and end with an irreversible turn toward the finale." },
    { name: "Resolution", objective: "", guidance: "Bring the central conflict to a decisive confrontation, resolve the campaign's major questions, and show what changes because of the characters." },
  ];
  const preset = defaults[number - 1] ?? { name: `Act ${number}`, objective: "", guidance: "Continue from the previous act's outcome. Escalate what remains unresolved and end this act with a clear change in the campaign." };
  return {
    id: foundry.utils.randomID(), number, name: preset.name, status: "draft", estimatedSessions: number === 2 ? 5 : 3,
    objective: preset.objective, startingSituation: "", locations: "", people: "", developments: "", clues: "",
    encounters: "", turningPoint: "", endingCondition: "", gmNotes: "", actualOutcome: "", carryForward: "",
    actorRefs: [], itemRefs: [], journalRefs: [], chapters: [], archivedSessions: [], guidance: preset.guidance, readyAt: "", completedAt: "",
  };
}

function ensureCampaignActs(campaign) {
  if (!Array.isArray(campaign.acts)) campaign.acts = [];
  if (!campaign.acts.length) {
    campaign.acts = [newCampaignAct(1), newCampaignAct(2), newCampaignAct(3)];
    const first = campaign.acts[0];
    first.objective = campaign.problem?.wrong ?? "";
    first.startingSituation = campaign.problem?.involvement ?? "";
    first.gmNotes = campaign.background ?? "";
  }
  campaign.acts = campaign.acts.map((act, index) => ensureCampaignActChapters({
    ...newCampaignAct(index + 1), ...act, id: act.id || foundry.utils.randomID(), number: index + 1,
    status: ["draft", "ready", "completed"].includes(act.status) ? act.status : "draft",
    actorRefs: (act.actorRefs ?? []).map(normalizeSessionReference),
    itemRefs: (act.itemRefs ?? []).map(normalizeSessionReference),
    journalRefs: (act.journalRefs ?? []).map(normalizeSessionReference),
  }));
  return campaign;
}

function campaignScope(campaign) {
  return CAMPAIGN_LENGTHS[campaign.length] ?? CAMPAIGN_LENGTHS.short;
}

function campaignSessionCount(campaign) {
  return Math.max(1, Math.min(100, Number(campaign.sessionCount) || 10));
}

function campaignPlanTargets(campaign) {
  const sessions = campaignSessionCount(campaign);
  if (campaign.length === "open") return {
    sessions, structure: Math.max(4, Math.ceil(sessions / 2)), locations: Math.max(4, Math.ceil(sessions * 0.6)),
    factions: Math.max(3, Math.ceil(sessions / 3)), threats: Math.max(4, Math.ceil(sessions / 2)),
    people: Math.max(4, Math.ceil(sessions * 0.5)), rumors: Math.max(6, Math.ceil(sessions * 1.2)), worldEvents: sessions,
  };
  if (campaign.length === "long") return {
    sessions, structure: Math.max(3, Math.ceil(sessions / 6)), locations: Math.max(4, Math.ceil(sessions / 4)),
    factions: Math.max(4, Math.ceil(sessions / 7)), threats: Math.max(3, Math.ceil(sessions / 8)),
    people: Math.max(5, Math.ceil(sessions / 4)), rumors: 0, worldEvents: 0,
  };
  return {
    sessions, structure: 3, locations: Math.max(2, Math.min(5, Math.ceil(sessions / 3))), factions: 2,
    threats: Math.max(2, Math.min(3, Math.ceil(sessions / 5))), people: Math.max(3, Math.min(5, Math.ceil(sessions / 3))),
    rumors: 0, worldEvents: 0,
  };
}

function campaignChapterGrouping(campaign, chapterIndex) {
  const count = campaignSessionCount(campaign);
  if (campaign.length === "short") {
    const firstActEnd = Math.max(1, Math.ceil(count * 0.2));
    const secondActEnd = Math.max(firstActEnd + 1, count - Math.max(1, Math.floor(count * 0.2)));
    if (chapterIndex < firstActEnd) return { group: 1, groupLabel: "Act I — Introduction" };
    if (chapterIndex < secondActEnd) return { group: 2, groupLabel: "Act II — Escalation" };
    return { group: 3, groupLabel: "Act III — Resolution" };
  }
  const arcCount = Math.max(2, Math.ceil(count / 6));
  const group = Math.min(arcCount, Math.floor((chapterIndex * arcCount) / count) + 1);
  return { group, groupLabel: group === arcCount ? `Final Arc ${group}` : `Arc ${group}` };
}

function ensureCampaignPlan(campaign) {
  const targets = campaignPlanTargets(campaign);
  campaign.sessionCount = targets.sessions;
  if (!Array.isArray(campaign.chapters)) campaign.chapters = [];
  if (campaign.length !== "open") {
    while (campaign.chapters.length < targets.sessions) campaign.chapters.push(newCampaignChapter(campaign.chapters.length + 1));
    campaign.chapters = campaign.chapters.map((chapter, index) => ({ ...newCampaignChapter(index + 1), ...chapter, number: index + 1, id: chapter.id || foundry.utils.randomID() }));
  }
  if (!Array.isArray(campaign.rumors)) campaign.rumors = [];
  if (!Array.isArray(campaign.worldEvents)) campaign.worldEvents = [];
  if (campaign.length === "open") {
    while (campaign.rumors.length < targets.rumors) campaign.rumors.push(newCampaignRumor());
    while (campaign.worldEvents.length < targets.worldEvents) campaign.worldEvents.push(newCampaignWorldEvent());
  }
  return campaign;
}

function campaignMarkerDistance(campaign, location) {
  const focus = campaign.map?.focus;
  if (!focus || !Number.isFinite(Number.parseFloat(location.x)) || !Number.isFinite(Number.parseFloat(location.y))) return null;
  const aspect = Math.max(0.1, Number(focus.aspect) || 1);
  return Math.hypot(Number(location.x) - Number(focus.x), (Number(location.y) - Number(focus.y)) / aspect);
}

function campaignLocationBand(campaign, location) {
  if (location.id === campaign.map?.startLocationId) return "center";
  const distance = campaignMarkerDistance(campaign, location);
  const radius = Math.max(0.02, Number(campaign.map?.focus?.radius) || 0.25);
  if (distance === null || distance > radius) return "outside";
  return distance <= radius * 0.6 ? "nearby" : "distant";
}

function campaignLocationGuidance(location, band) {
  const type = CAMPAIGN_POINT_TYPES[location.type] ?? "Location";
  if (band === "center") return `Prepare ${location.name || "the starting location"} deeply. Establish what is happening now, who matters, what the characters can do here, and what pushes them toward the surrounding region.`;
  if (band === "nearby") return `Prepare this nearby ${type.toLowerCase()} enough to support a visit: its relationship with the starting area, a reason to travel there, an opportunity or danger, and a lead pointing toward it.`;
  if (band === "distant") return `Keep this distant ${type.toLowerCase()} light. Give it one memorable identity, one rumor, and one reason it might matter later. Expand it only when play moves toward it.`;
  return "This point is outside the current campaign focus. Name it for map context, but do not prepare it yet.";
}

function campaignMapView(campaign) {
  const start = campaign.locations.find((location) => location.id === campaign.map?.startLocationId);
  const focusX = Number(campaign.map?.focus?.x) || 0.5;
  const focusY = Number(campaign.map?.focus?.y) || 0.5;
  const radius = Math.max(0.02, Number(campaign.map?.focus?.radius) || 0.25);
  const aspect = Math.max(0.1, Number(campaign.map?.focus?.aspect) || 1);
  return {
    image: campaign.map?.image ?? "", hasImage: Boolean(campaign.map?.image), startLocationId: campaign.map?.startLocationId ?? "",
    focusX, focusY, radius, aspect, focusLeft: `${focusX * 100}%`, focusTop: `${focusY * 100}%`,
    focusSize: `${radius * 200}%`, focusHeight: `${radius * 200 * aspect}%`, startName: start?.name || "No starting point selected",
    zoom: Math.max(1, Math.min(5, Number(campaign.map?.view?.zoom) || 1)),
    panX: Number(campaign.map?.view?.panX) || 0,
    panY: Number(campaign.map?.view?.panY) || 0,
  };
}

function ensureCampaignMapScope(campaign) {
  if (!campaign.map || typeof campaign.map !== "object") campaign.map = { image: "", startLocationId: "", focus: { x: 0.5, y: 0.5, radius: 0.25, aspect: 2 }, view: { zoom: 1, panX: 0, panY: 0 } };
  campaign.map.focus = { x: 0.5, y: 0.5, radius: 0.25, aspect: 2, ...(campaign.map.focus ?? {}) };
  campaign.map.view = { zoom: 1, panX: 0, panY: 0, ...(campaign.map.view ?? {}) };
  if (!Array.isArray(campaign.routes)) campaign.routes = [];
  for (const property of ["structure", "locations", "factions", "threats"]) if (!Array.isArray(campaign[property])) campaign[property] = [];
  if (!Array.isArray(campaign.people)) campaign.people = [];
  if (!Array.isArray(campaign.openQuestions) || !campaign.openQuestions.length) campaign.openQuestions = [newCampaignQuestion()];
  if (!Array.isArray(campaign.secrets) || !campaign.secrets.length) campaign.secrets = [newCampaignSecret()];
  return ensureCampaignPlan(campaign);
}

function newCampaignMapBuild() {
  return ensureCampaignMapScope({
    journalId: "", name: "", premise: "", startingLevel: 1, finalLevel: 5, sessionCount: 10, sessionHours: 4,
    map: { image: "", startLocationId: "", focus: { x: 0.5, y: 0.5, radius: 0.25, aspect: 2 }, view: { zoom: 1, panX: 0, panY: 0 } }, routes: [],
    length: "short", style: "adventure", tone: "heroic",
    identity: { themes: "", playerPromise: "", boundaries: "" }, background: "", characterHooks: "",
    problem: { wrong: "", cause: "", stakes: "", involvement: "", distinction: "", resolution: "" },
    structure: [], locations: [], factions: [], threats: [], chapters: [], rumors: [], worldEvents: [], secrets: [newCampaignSecret()],
    setting: { history: "", cultures: "", magic: "", politics: "" },
    people: [
      newCampaignPerson("ally", "Someone who helps the party"),
      newCampaignPerson("opponent", "Someone who opposes the party"),
      newCampaignPerson("informant", "Someone who knows important information"),
    ],
    characters: [newCampaignCharacter()],
    progression: { leveling: "milestone", treasure: "", narrative: "", reputation: "", options: "" },
    consistency: { imagery: "", naming: "", rules: "", timeline: "", travel: "" },
    openQuestions: [newCampaignQuestion()],
  });
}

function normalizeCampaignMapBuild(stored = {}) {
  const fresh = newCampaignMapBuild();
  const people = Array.isArray(stored.people) ? stored.people : fresh.people;
  const characters = Array.isArray(stored.characters) ? stored.characters : [];
  const oldPlace = stored.place && [stored.place.name, stored.place.description, stored.place.image].some(Boolean)
    ? [{ ...newCampaignLocation(), name: stored.place.name ?? "", image: stored.place.image ?? "", description: stored.place.description ?? "", importance: stored.place.interest ?? "", secret: stored.place.problem ?? "" }]
    : [];
  const normalized = {
    ...fresh, ...stored,
    length: stored.length === "one-shot" ? "short" : (stored.length ?? fresh.length),
    identity: { ...fresh.identity, ...(stored.identity ?? {}) },
    problem: { ...fresh.problem, ...(stored.problem ?? {}) },
    structure: (Array.isArray(stored.structure) ? stored.structure : []).map((entry) => ({ ...newCampaignStructure(), ...entry, id: entry.id || foundry.utils.randomID() })),
    locations: (Array.isArray(stored.locations) && stored.locations.length ? stored.locations : oldPlace).map((entry) => ({ ...newCampaignLocation(), ...entry, id: entry.id || foundry.utils.randomID() })),
    factions: (Array.isArray(stored.factions) ? stored.factions : []).map((entry) => ({ ...newCampaignFaction(), ...entry, id: entry.id || foundry.utils.randomID() })),
    threats: (Array.isArray(stored.threats) ? stored.threats : []).map((entry) => ({ ...newCampaignThreat(), ...entry, id: entry.id || foundry.utils.randomID() })),
    map: { ...fresh.map, ...(stored.map ?? {}), focus: { ...fresh.map.focus, ...(stored.map?.focus ?? {}) } },
    routes: (Array.isArray(stored.routes) ? stored.routes : []).map((entry) => ({ ...newCampaignRoute(), ...entry, id: entry.id || foundry.utils.randomID() })),
    chapters: (Array.isArray(stored.chapters) ? stored.chapters : []).map((entry, index) => ({ ...newCampaignChapter(index + 1), ...entry, number: index + 1, id: entry.id || foundry.utils.randomID() })),
    rumors: (Array.isArray(stored.rumors) ? stored.rumors : []).map((entry) => ({ ...newCampaignRumor(), ...entry, id: entry.id || foundry.utils.randomID() })),
    worldEvents: (Array.isArray(stored.worldEvents) ? stored.worldEvents : []).map((entry) => ({ ...newCampaignWorldEvent(), ...entry, id: entry.id || foundry.utils.randomID() })),
    secrets: (Array.isArray(stored.secrets) ? stored.secrets : []).map((entry) => ({ ...newCampaignSecret(), ...entry, id: entry.id || foundry.utils.randomID() })),
    setting: { ...fresh.setting, ...(stored.setting ?? {}) },
    people: people.map((person, index) => ({ ...newCampaignPerson(person.slot ?? "person", person.label ?? `Important person ${index + 1}`), ...person, id: person.id || foundry.utils.randomID() })),
    characters: (characters.length ? characters : fresh.characters).map((character) => ({ ...newCampaignCharacter(), ...character, id: character.id || foundry.utils.randomID() })),
    progression: { ...fresh.progression, ...(stored.progression ?? {}) },
    consistency: { ...fresh.consistency, ...(stored.consistency ?? {}) },
    openQuestions: (Array.isArray(stored.openQuestions) ? stored.openQuestions : []).map((entry) => typeof entry === "string" ? { ...newCampaignQuestion(), text: entry } : { ...newCampaignQuestion(), ...entry, id: entry.id || foundry.utils.randomID() }),
  };
  delete normalized.firstSession;
  delete normalized.place;
  return ensureCampaignMapScope(normalized);
}

const WORLD_REGION_TYPES = {
  realm: { label: "Realm or nation", icon: "fa-crown", color: "#8f3029" },
  province: { label: "Province or territory", icon: "fa-flag", color: "#b85f2c" },
  cultural: { label: "Cultural region", icon: "fa-people-group", color: "#7452a3" },
  wilderness: { label: "Wilderness", icon: "fa-campground", color: "#6c7d35" },
  forest: { label: "Forest", icon: "fa-tree", color: "#327048" },
  mountains: { label: "Mountain range", icon: "fa-mountain", color: "#74665b" },
  coast: { label: "Coast", icon: "fa-water", color: "#377c8f" },
  watershed: { label: "Lake, sea, or river basin", icon: "fa-water", color: "#3f6fa6" },
  disputed: { label: "Disputed region", icon: "fa-shield-halved", color: "#9a4b4b" },
  other: { label: "Other region", icon: "fa-draw-polygon", color: "#8a6337" },
};

const WORLD_REGION_DEVELOPMENT = {
  named: "Named only",
  outlined: "Outlined",
  playable: "Ready for play",
  developed: "Fully developed",
};

function newWorldRegion() {
  const type = "province";
  return {
    id: foundry.utils.randomID(), name: "", type, parentId: "", journalId: "",
    color: WORLD_REGION_TYPES[type].color, opacity: 0.26, development: "named", vertices: [],
    summary: "", terrain: "", climate: "", inhabitants: "", authority: "", culture: "",
    resources: "", factions: "", currentSituation: "", dangers: "", hooks: "", travel: "",
  };
}

function newWorldMapBuild() {
  return {
    schemaVersion: 1, id: foundry.utils.randomID(), name: "", journalFolderId: "", indexJournalId: "",
    map: { image: "", view: { zoom: 1, panX: 0, panY: 0 } },
    regions: [], selectedRegionId: "", draftVertices: [], updatedAt: 0,
  };
}

function worldMapRecoveryKey() {
  return `${MODULE_ID}.world-map-recovery.${game.world?.id ?? "world"}.${game.user?.id ?? "user"}`;
}

function readWorldMapRecovery() {
  try {
    const raw = globalThis.localStorage?.getItem(worldMapRecoveryKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Lore Smith | Could not read the emergency world-map recovery copy.", error);
    return null;
  }
}

function writeWorldMapRecovery(serialized) {
  try {
    globalThis.localStorage?.setItem(worldMapRecoveryKey(), serialized);
  } catch (error) {
    console.warn("Lore Smith | Could not write the emergency world-map recovery copy.", error);
  }
}

function clampWorldCoordinate(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeWorldVertices(vertices) {
  if (!Array.isArray(vertices)) return [];
  const normalized = vertices
    .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .map((point) => ({ x: clampWorldCoordinate(point.x), y: clampWorldCoordinate(point.y) }));
  if (normalized.length > 1) {
    const first = normalized[0]; const last = normalized.at(-1);
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.0001) normalized.pop();
  }
  return normalized.filter((point, index) => index === 0 || Math.hypot(point.x - normalized[index - 1].x, point.y - normalized[index - 1].y) >= 0.0001);
}

function normalizeWorldMapBuild(stored = {}) {
  const fresh = newWorldMapBuild();
  const map = stored.map ?? {};
  const normalized = {
    ...fresh, ...stored,
    schemaVersion: 1,
    id: stored.id || fresh.id,
    map: {
      ...fresh.map, ...map,
      view: {
        zoom: Math.max(1, Math.min(6, Number(map.view?.zoom) || 1)),
        panX: Number(map.view?.panX) || 0,
        panY: Number(map.view?.panY) || 0,
      },
    },
    regions: (Array.isArray(stored.regions) ? stored.regions : []).map((entry) => {
      const base = newWorldRegion();
      const type = WORLD_REGION_TYPES[entry?.type] ? entry.type : base.type;
      return {
        ...base, ...entry,
        id: entry?.id || foundry.utils.randomID(), type,
        color: /^#[0-9a-f]{6}$/i.test(entry?.color ?? "") ? entry.color : WORLD_REGION_TYPES[type].color,
        opacity: Math.max(0.08, Math.min(0.72, Number(entry?.opacity) || base.opacity)),
        development: WORLD_REGION_DEVELOPMENT[entry?.development] ? entry.development : base.development,
        vertices: normalizeWorldVertices(entry?.vertices),
      };
    }),
    draftVertices: normalizeWorldVertices(stored.draftVertices),
  };
  if (!normalized.regions.some((region) => region.id === normalized.selectedRegionId)) normalized.selectedRegionId = "";
  const ids = new Set(normalized.regions.map((region) => region.id));
  for (const region of normalized.regions) if (!ids.has(region.parentId) || region.parentId === region.id) region.parentId = "";
  for (const region of normalized.regions) {
    const visited = new Set([region.id]); let current = region;
    while (current.parentId) {
      if (visited.has(current.parentId)) { current.parentId = ""; break; }
      visited.add(current.parentId);
      current = normalized.regions.find((candidate) => candidate.id === current.parentId);
      if (!current) break;
    }
  }
  return normalized;
}

function worldPolygonSignedArea(vertices) {
  if (vertices.length < 3) return 0;
  return vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function worldPolygonArea(vertices) {
  return Math.abs(worldPolygonSignedArea(vertices));
}

function worldPolygonCentroid(vertices) {
  const signedArea = worldPolygonSignedArea(vertices);
  if (vertices.length < 3 || Math.abs(signedArea) < 0.000001) {
    const total = vertices.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    return { x: total.x / Math.max(1, vertices.length), y: total.y / Math.max(1, vertices.length) };
  }
  let x = 0; let y = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const point = vertices[index]; const next = vertices[(index + 1) % vertices.length];
    const cross = point.x * next.y - next.x * point.y;
    x += (point.x + next.x) * cross; y += (point.y + next.y) * cross;
  }
  return { x: x / (6 * signedArea), y: y / (6 * signedArea) };
}

function worldPolygonLabelPoint(vertices) {
  const centroid = worldPolygonCentroid(vertices);
  if (worldPointInPolygon(centroid, vertices)) return centroid;
  const xs = vertices.map((point) => point.x); const ys = vertices.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  let best = vertices[0] ?? { x: 0.5, y: 0.5 }; let bestDistance = -1;
  const steps = 24;
  for (let yIndex = 0; yIndex < steps; yIndex += 1) for (let xIndex = 0; xIndex < steps; xIndex += 1) {
    const point = { x: minX + ((xIndex + 0.5) / steps) * (maxX - minX), y: minY + ((yIndex + 0.5) / steps) * (maxY - minY) };
    if (!worldPointInPolygon(point, vertices)) continue;
    let distance = Infinity;
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index]; const end = vertices[(index + 1) % vertices.length];
      const dx = end.x - start.x; const dy = end.y - start.y; const length = dx * dx + dy * dy;
      const projection = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
      distance = Math.min(distance, Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy)));
    }
    if (distance > bestDistance) { best = point; bestDistance = distance; }
  }
  return best;
}

function worldPointOnSegment(point, start, end, epsilon = 0.00001) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y) <= epsilon;
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength));
  const nearestX = start.x + projection * dx; const nearestY = start.y + projection * dy;
  return Math.hypot(point.x - nearestX, point.y - nearestY) <= epsilon;
}

function worldPointInPolygon(point, vertices) {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const left = vertices[index]; const right = vertices[previous];
    if (worldPointOnSegment(point, left, right)) return true;
    const crosses = (left.y > point.y) !== (right.y > point.y)
      && point.x < ((right.x - left.x) * (point.y - left.y)) / ((right.y - left.y) || Number.EPSILON) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function worldSegmentOrientation(a, b, c, epsilon = 0.0000001) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) <= epsilon ? 0 : Math.sign(cross);
}

function worldSegmentsIntersect(a, b, c, d) {
  const o1 = worldSegmentOrientation(a, b, c); const o2 = worldSegmentOrientation(a, b, d);
  const o3 = worldSegmentOrientation(c, d, a); const o4 = worldSegmentOrientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && worldPointOnSegment(c, a, b))
    || (o2 === 0 && worldPointOnSegment(d, a, b))
    || (o3 === 0 && worldPointOnSegment(a, c, d))
    || (o4 === 0 && worldPointOnSegment(b, c, d));
}

function worldSegmentsProperlyIntersect(a, b, c, d) {
  const o1 = worldSegmentOrientation(a, b, c); const o2 = worldSegmentOrientation(a, b, d);
  const o3 = worldSegmentOrientation(c, d, a); const o4 = worldSegmentOrientation(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function worldPolygonSelfIntersects(vertices) {
  for (let left = 0; left < vertices.length; left += 1) {
    const leftNext = (left + 1) % vertices.length;
    for (let right = left + 1; right < vertices.length; right += 1) {
      const rightNext = (right + 1) % vertices.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (worldSegmentsIntersect(vertices[left], vertices[leftNext], vertices[right], vertices[rightNext])) return true;
    }
  }
  return false;
}

function worldRegionDepth(region, regions) {
  let depth = 0; let current = region; const visited = new Set([region.id]);
  while (current?.parentId && depth < regions.length) {
    if (visited.has(current.parentId)) break;
    visited.add(current.parentId); current = regions.find((entry) => entry.id === current.parentId); depth += 1;
  }
  return depth;
}

function worldRegionAtPoint(point, regions) {
  return regions.filter((region) => worldPointInPolygon(point, region.vertices))
    .sort((left, right) => worldRegionDepth(right, regions) - worldRegionDepth(left, regions)
      || worldPolygonArea(left.vertices) - worldPolygonArea(right.vertices)
      || left.id.localeCompare(right.id))[0] ?? null;
}

function worldRegionContainsRegion(parent, child) {
  if (parent.vertices.length < 3 || child.vertices.length < 3
    || worldPolygonArea(parent.vertices) <= worldPolygonArea(child.vertices) + 0.000001
    || !child.vertices.every((point) => worldPointInPolygon(point, parent.vertices))) return false;
  for (let childIndex = 0; childIndex < child.vertices.length; childIndex += 1) {
    const start = child.vertices[childIndex]; const end = child.vertices[(childIndex + 1) % child.vertices.length];
    for (const fraction of [0.25, 0.5, 0.75]) {
      if (!worldPointInPolygon({ x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction }, parent.vertices)) return false;
    }
    for (let parentIndex = 0; parentIndex < parent.vertices.length; parentIndex += 1) {
      const parentStart = parent.vertices[parentIndex]; const parentEnd = parent.vertices[(parentIndex + 1) % parent.vertices.length];
      if (worldSegmentsProperlyIntersect(start, end, parentStart, parentEnd)) return false;
    }
  }
  return true;
}

function worldContentFingerprint(content) {
  let hash = 2166136261;
  const text = String(content ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureCampaignScope(campaign) {
  const targets = campaignPlanTargets(campaign);
  const factories = { structure: newCampaignStructure, locations: newCampaignLocation, factions: newCampaignFaction, threats: newCampaignThreat };
  const minimums = { structure: targets.structure, locations: targets.locations, factions: targets.factions, threats: targets.threats };
  for (const [property, minimum] of Object.entries(minimums)) {
    if (!Array.isArray(campaign[property])) campaign[property] = [];
    while (campaign[property].length < minimum) campaign[property].push(factories[property]());
  }
  if (!Array.isArray(campaign.people)) campaign.people = [];
  while (campaign.people.length < targets.people) campaign.people.push(newCampaignPerson("person", `Important person ${campaign.people.length + 1}`));
  if (!Array.isArray(campaign.openQuestions) || !campaign.openQuestions.length) campaign.openQuestions = [newCampaignQuestion()];
  if (!Array.isArray(campaign.secrets) || !campaign.secrets.length) campaign.secrets = [newCampaignSecret()];
  return ensureCampaignPlan(campaign);
}

function newCampaignBuild() {
  return ensureCampaignActs({
    journalId: "", name: "", premise: "", startingLevel: 1, finalLevel: 5, sessionCount: 10, sessionHours: 4,
    length: "short", style: "adventure", tone: "heroic", identity: { themes: "", playerPromise: "", boundaries: "" },
    background: "", characterHooks: "", problem: { wrong: "", cause: "", stakes: "", involvement: "", distinction: "", resolution: "" },
    structure: [], locations: [], factions: [], threats: [], chapters: [], rumors: [], worldEvents: [], secrets: [newCampaignSecret()],
    setting: { history: "", cultures: "", magic: "", politics: "" },
    people: [newCampaignPerson("ally", "Someone who helps the party"), newCampaignPerson("opponent", "Someone who opposes the party"), newCampaignPerson("informant", "Someone who knows important information")],
    characters: [newCampaignCharacter()], progression: { leveling: "milestone", treasure: "", narrative: "", reputation: "", options: "" },
    consistency: { imagery: "", naming: "", rules: "", timeline: "", travel: "" }, openQuestions: [newCampaignQuestion()], acts: [],
  });
}

function normalizeCampaignBuild(stored = {}) {
  const fresh = newCampaignBuild();
  const normalized = {
    ...fresh, ...stored, length: stored.length === "one-shot" ? "short" : (stored.length ?? fresh.length),
    identity: { ...fresh.identity, ...(stored.identity ?? {}) }, problem: { ...fresh.problem, ...(stored.problem ?? {}) },
    setting: { ...fresh.setting, ...(stored.setting ?? {}) }, progression: { ...fresh.progression, ...(stored.progression ?? {}) }, consistency: { ...fresh.consistency, ...(stored.consistency ?? {}) },
    structure: (Array.isArray(stored.structure) ? stored.structure : []).map((entry) => ({ ...newCampaignStructure(), ...entry, id: entry.id || foundry.utils.randomID() })),
    locations: (Array.isArray(stored.locations) ? stored.locations : []).map((entry) => ({ ...newCampaignLocation(), ...entry, id: entry.id || foundry.utils.randomID() })),
    factions: (Array.isArray(stored.factions) ? stored.factions : []).map((entry) => ({ ...newCampaignFaction(), ...entry, id: entry.id || foundry.utils.randomID() })),
    threats: (Array.isArray(stored.threats) ? stored.threats : []).map((entry) => ({ ...newCampaignThreat(), ...entry, id: entry.id || foundry.utils.randomID() })),
    chapters: (Array.isArray(stored.chapters) ? stored.chapters : []).map((entry, index) => ({ ...newCampaignChapter(index + 1), ...entry, number: index + 1, id: entry.id || foundry.utils.randomID() })),
    rumors: (Array.isArray(stored.rumors) ? stored.rumors : []).map((entry) => ({ ...newCampaignRumor(), ...entry, id: entry.id || foundry.utils.randomID() })),
    worldEvents: (Array.isArray(stored.worldEvents) ? stored.worldEvents : []).map((entry) => ({ ...newCampaignWorldEvent(), ...entry, id: entry.id || foundry.utils.randomID() })),
    secrets: (Array.isArray(stored.secrets) ? stored.secrets : []).map((entry) => ({ ...newCampaignSecret(), ...entry, id: entry.id || foundry.utils.randomID() })),
    people: (Array.isArray(stored.people) ? stored.people : fresh.people).map((entry, index) => ({ ...newCampaignPerson(entry.slot ?? "person", entry.label ?? `Important person ${index + 1}`), ...entry, id: entry.id || foundry.utils.randomID() })),
    characters: (Array.isArray(stored.characters) && stored.characters.length ? stored.characters : fresh.characters).map((entry) => ({ ...newCampaignCharacter(), ...entry, id: entry.id || foundry.utils.randomID() })),
    openQuestions: (Array.isArray(stored.openQuestions) ? stored.openQuestions : []).map((entry) => typeof entry === "string" ? { ...newCampaignQuestion(), text: entry } : { ...newCampaignQuestion(), ...entry, id: entry.id || foundry.utils.randomID() }),
  };
  normalized.acts = Array.isArray(stored.acts) ? stored.acts : [];
  return ensureCampaignActs(normalized);
}

function campaignList(title, entries) {
  const values = entries.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  return values.length ? `<h2>${escapeHtml(title)}</h2><ul>${values.map((entry) => `<li>${sessionHtml(entry)}</li>`).join("")}</ul>` : "";
}

function legacyCampaignJournalPages(campaign) {
  ensureCampaignScope(campaign);
  const length = campaignScope(campaign);
  const targets = campaignPlanTargets(campaign);
  const overview = `${sessionBlock("Adventure summary", campaign.premise)}<p><strong>Format</strong> ${escapeHtml(length.label)}</p><p><strong>Expected length</strong> ${targets.sessions} sessions of about ${Number(campaign.sessionHours) || 4} hours</p><p><strong>Level range</strong> ${Number(campaign.startingLevel) || 1}–${Number(campaign.finalLevel) || Number(campaign.startingLevel) || 1}</p>${sessionBlock("What makes this campaign distinctive", campaign.problem.distinction)}`;
  const conflict = `${sessionBlock("What is happening now", campaign.problem.wrong)}${sessionBlock("Who or what is causing it", campaign.problem.cause)}${sessionBlock("What happens without intervention", campaign.problem.stakes)}${sessionBlock("Why the characters become involved", campaign.problem.involvement)}${sessionBlock("Possible endings", campaign.problem.resolution)}`;
  const background = `${sessionBlock("Background", campaign.background)}${sessionBlock("History that matters now", campaign.setting.history)}${sessionBlock("Cultures and communities", campaign.setting.cultures)}${sessionBlock("Magic, religion, and technology", campaign.setting.magic)}${sessionBlock("Political situation", campaign.setting.politics)}`;
  const locations = campaign.locations.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed location")}</h2>${entry.image ? `<figure><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}"></figure>` : ""}${sessionBlock("Description", entry.description)}${sessionBlock("Purpose in the adventure", entry.importance)}${sessionBlock("Secret or revelation", entry.secret)}</section>`).join("<hr>");
  const factions = campaign.factions.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed faction")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Methods", entry.methods)}${sessionBlock("Resources", entry.resources)}${sessionBlock("Relationship with the party", entry.relationship)}${sessionBlock("What happens if ignored", entry.ignored)}</section>`).join("<hr>");
  const threats = campaign.threats.map((entry) => `<section><h2>${escapeHtml(entry.name || "Unnamed threat")}</h2>${sessionBlock("Goal", entry.goal)}${sessionBlock("Escalation", entry.escalation)}${sessionBlock("Consequences", entry.consequences)}</section>`).join("<hr>");
  const people = campaign.people.map((person) => `<section><h2>${escapeHtml(person.name || person.label || "Unnamed NPC")}</h2><p><em>${escapeHtml(person.label || "Important NPC")}</em></p>${sessionBlock("Description", person.description)}${sessionBlock("What they want", person.wants)}${sessionBlock("What they know", person.knows)}${sessionBlock("Secret or complication", person.secret)}</section>`).join("<hr>");
  const characters = `${sessionBlock("General character hooks", campaign.characterHooks)}${campaign.characters.map((character) => `<section><h2>${escapeHtml(character.name || "Player character")}</h2>${sessionBlock("Reason to become involved", character.involvement)}${sessionBlock("NPC or faction connection", character.npcConnection)}${sessionBlock("Personal goal", character.desire)}${sessionBlock("Party bond", character.bond)}${sessionBlock("Complication", character.complication)}${sessionBlock("Possible development", character.growth)}</section>`).join("<hr>")}`;
  const secrets = campaign.secrets.map((entry, index) => `<section><h2>Revelation ${index + 1}</h2>${sessionBlock("Truth", entry.secret)}${sessionBlock("Clues that reveal it", entry.clues)}${sessionBlock("Who already knows", entry.knownBy)}</section>`).join("<hr>");
  const structure = campaign.structure.map((entry, index) => `<section><h2>${escapeHtml(entry.name || `${length.structureSingular} ${index + 1}`)}</h2>${sessionBlock(length.structureSummaryLabel, entry.summary)}${sessionBlock(length.structureOutcomeLabel, entry.outcome)}</section>`).join("<hr>");
  const progression = `<p><strong>Leveling</strong> ${campaign.progression.leveling === "xp" ? "Experience Points" : "Milestone leveling"}</p>${sessionBlock("Important treasure", campaign.progression.treasure)}${sessionBlock("Narrative rewards", campaign.progression.narrative)}${sessionBlock("Reputation, allies, titles, or holdings", campaign.progression.reputation)}${sessionBlock("Campaign-specific character options", campaign.progression.options)}`;
  const reference = `${sessionBlock("Rules and setting conventions", campaign.consistency.rules)}${sessionBlock("Timeline", campaign.consistency.timeline)}${sessionBlock("Travel assumptions", campaign.consistency.travel)}${campaignList("Open questions", campaign.openQuestions.map((entry) => entry.text))}`;
  const pages = [
    { key: "overview", name: "1. Adventure Overview", content: overview },
    { key: "background", name: "2. Background", content: background },
    { key: "conflict", name: "3. Central Conflict", content: conflict },
    { key: "hooks", name: "4. Character Hooks", content: characters },
    { key: "factions", name: "5. Factions", content: factions },
    { key: "people", name: "6. Important NPCs", content: people },
    { key: "locations", name: "7. Important Locations", content: locations },
    { key: "secrets", name: "8. Secrets and Revelations", content: secrets },
    { key: "threats", name: "9. Threats and Conflicts", content: threats },
    { key: "structure", name: "10. Adventure Structure", content: structure },
  ];
  if (campaign.length === "open") {
    pages.push({ key: "sandbox-rumors", name: "11. Rumors and Leads", content: campaign.rumors.map((entry, index) => `<h2>Rumor ${index + 1}</h2>${sessionBlock("What people say", entry.text)}${sessionBlock("What is actually true", entry.truth)}`).join("<hr>") });
    pages.push({ key: "sandbox-events", name: "12. World Event Timeline", content: campaign.worldEvents.map((entry, index) => `<h2>Event ${index + 1}</h2>${sessionBlock("Trigger or timing", entry.trigger)}${sessionBlock("What happens", entry.event)}${sessionBlock("How the world changes", entry.consequence)}`).join("<hr>") });
  } else {
    let previousGroup = 0;
    for (const [index, chapter] of campaign.chapters.slice(0, targets.sessions).entries()) {
      const grouping = campaignChapterGrouping(campaign, index);
      if (grouping.group !== previousGroup) {
        pages.push({ key: `group-${grouping.group}`, name: grouping.groupLabel, content: `<h1>${escapeHtml(grouping.groupLabel)}</h1><p>This section contains the next part of the planned adventure. Outcomes should change later chapters rather than force the players back onto one path.</p>` });
        previousGroup = grouping.group;
      }
      const content = `${sessionBlock("Purpose", chapter.purpose)}${sessionBlock("Opening situation", chapter.opening)}${sessionBlock("Information the GM needs", chapter.information)}${sessionBlock("Locations", chapter.locations)}${sessionBlock("NPCs and factions", chapter.npcs)}${sessionBlock("Likely scenes", chapter.scenes)}${sessionBlock("Revelations and clues", chapter.revelations)}${sessionBlock("Encounters and hazards", chapter.encounters)}${sessionBlock("Rewards", chapter.rewards)}${sessionBlock("Meaningful choices", chapter.choices)}${sessionBlock("Consequences", chapter.consequences)}${sessionBlock("Transition to the next chapter", chapter.transition)}`;
      pages.push({ key: `chapter-${index + 1}`, name: `Session ${index + 1} — ${chapter.title || "Untitled Chapter"}`, content });
    }
  }
  pages.push({ key: "progression", name: "Progression and Rewards", content: progression });
  pages.push({ key: "reference", name: "GM Reference", content: reference });
  return pages;
}

function campaignJournalPages(campaign) {
  ensureCampaignMapScope(campaign);
  const map = campaignMapView(campaign);
  const positioned = campaign.locations.filter((entry) => Number.isFinite(Number.parseFloat(entry.x)) && Number.isFinite(Number.parseFloat(entry.y)));
  const byBand = (band) => positioned.filter((entry) => campaignLocationBand(campaign, entry) === band);
  const center = byBand("center")[0];
  const locationSection = (entry, fields) => `<section><h2>${escapeHtml(entry.name || "Unnamed location")}</h2><p><em>${escapeHtml(CAMPAIGN_POINT_TYPES[entry.type] ?? "Location")}</em></p>${entry.image ? `<figure><img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}"></figure>` : ""}${fields.map(([label, key]) => sessionBlock(label, entry[key])).join("")}</section>`;
  const markers = positioned.map((entry) => `<span class="ls-journal-map-marker ${campaignLocationBand(campaign, entry)}" style="left:${Number(entry.x) * 100}%;top:${Number(entry.y) * 100}%" title="${escapeHtml(entry.name || "Unnamed point")}"></span>`).join("");
  const mapPage = `<div class="ls-journal-region-map"><img src="${escapeHtml(map.image)}" alt="${escapeHtml(campaign.name)} regional map"><span class="ls-journal-focus" style="left:${map.focusX * 100}%;top:${map.focusY * 100}%;width:${map.radius * 200}%;height:${map.radius * 200 * map.aspect}%"></span>${markers}</div><p><strong>Starting point:</strong> ${escapeHtml(map.startName)}</p><p>The focus circle records the region currently prepared for play. Center locations receive full detail, nearby locations are ready to visit, and distant locations remain light until the party travels toward them.</p>`;
  const overview = `${sessionBlock("Opening problem", campaign.problem.wrong)}${sessionBlock("Cause", campaign.problem.cause)}${sessionBlock("Stakes", campaign.problem.stakes)}${sessionBlock("Why the characters become involved", campaign.problem.involvement)}${sessionBlock("Sign that the problem reaches beyond the starting point", campaign.problem.distinction)}${sessionBlock("Rumor of the wider world", campaign.premise)}`;
  const centerPage = center ? locationSection(center, [["Description", "description"], ["What is happening now", "currentSituation"], ["Why the characters are here", "importance"], ["People who matter", "people"], ["Help, services, and resources", "services"], ["Immediate danger", "danger"], ["Reason to leave and explore", "reasonToLeave"], ["What happens if ignored", "ignored"]]) : "<p>No starting point has been prepared.</p>";
  const nearby = byBand("nearby").map((entry) => locationSection(entry, [[`Relationship with ${map.startName}`, "relationship"], ["Reason to travel here", "reasonToVisit"], ["Opportunity or useful resource", "opportunity"], ["Danger or mystery", "danger"], ["Lead pointing here", "lead"], ["Travel and route", "travel"]])).join("<hr>") || "<p>No nearby locations are currently inside the focus.</p>";
  const distant = byBand("distant").map((entry) => locationSection(entry, [["One-sentence identity", "description"], ["Known for", "knownFor"], ["Rumor or visible sign", "rumor"], ["Possible future use", "futureUse"]])).join("<hr>") || "<p>No distant locations are currently inside the focus.</p>";
  const nameFor = (id) => campaign.locations.find((entry) => entry.id === id)?.name || "Unnamed point";
  const routes = campaign.routes.map((route) => `<section><h2>${escapeHtml(nameFor(route.fromId))} to ${escapeHtml(nameFor(route.toId))}</h2><p><strong>Connection:</strong> ${escapeHtml(CAMPAIGN_ROUTE_TYPES[route.type] ?? "Route")}</p>${sessionBlock("Travel time", route.travel)}${sessionBlock("Memorable feature", route.feature)}${sessionBlock("Travel complication", route.complication)}</section>`).join("<hr>") || "<p>No regional connections have been prepared yet.</p>";
  const outside = campaign.locations.filter((entry) => campaignLocationBand(campaign, entry) === "outside").map((entry) => `<li>${escapeHtml(entry.name || "Unnamed point")} <em>(${escapeHtml(CAMPAIGN_POINT_TYPES[entry.type] ?? "location")})</em></li>`).join("");
  return [
    { key: "regional-map", name: "1. Regional Map", content: mapPage },
    { key: "opening-situation", name: "2. Opening Situation", content: overview },
    { key: "starting-point", name: `3. Starting Point - ${center?.name || "Unprepared"}`, content: centerPage },
    { key: "nearby-places", name: "4. Nearby Places", content: nearby },
    { key: "distant-places", name: "5. Distant Gazetteer", content: distant },
    { key: "regional-connections", name: "6. Routes and Connections", content: routes },
    { key: "outside-focus", name: "7. Beyond the Current Focus", content: outside ? `<p>These places exist on the map but deliberately require no preparation yet.</p><ul>${outside}</ul>` : "<p>No marked points lie outside the current focus.</p>" },
  ];
}

function adventureCampaignJournalPages(campaign) {
  ensureCampaignActs(campaign);
  const referenceList = (title, refs) => refs?.length
    ? `<h2>${escapeHtml(title)}</h2><ul>${refs.map((entry) => `<li>${sessionReferenceLink(entry)}</li>`).join("")}</ul>` : "";
  const completed = campaign.acts.filter((act) => act.status === "completed").length;
  const overview = `${sessionBlock("Campaign summary", campaign.premise)}<p><strong>Progress</strong> ${completed} of ${campaign.acts.length} acts completed</p><ol>${campaign.acts.map((act) => `<li><strong>Act ${act.number}: ${escapeHtml(act.name || "Untitled")}</strong> — ${escapeHtml(act.status === "completed" ? "Completed" : act.status === "ready" ? "Ready to play" : "Draft")}</li>`).join("")}</ol>`;
  const pages = [{ key: "overview", name: "Campaign Overview", content: overview }];
  for (const act of campaign.acts) {
    const status = act.status === "completed" ? "Completed" : act.status === "ready" ? "Ready to play" : "Draft";
    const chapterContent = act.chapters.map((chapter) => {
      const roman = ["I", "II", "III"][chapter.number - 1] ?? chapter.number;
      const sessions = chapter.sessions.map((session) => {
        const journal = game.journal.get(session.journalId);
        const link = journal ? `<p>${sessionReferenceLink({ uuid: journal.uuid, name: "Open prepared session Journal" })}</p>` : "";
        return `<section><h4>Session ${session.number}${session.title ? ` — ${escapeHtml(session.title)}` : ""}</h4>${sessionBlock("Purpose", session.purpose)}${link}</section>`;
      }).join("");
      return `<section><h3>Chapter ${roman} — ${escapeHtml(chapter.name)}</h3><p>${escapeHtml(chapter.guidance)}</p>${sessions}</section>`;
    }).join("");
    const content = `<p><strong>Status</strong> ${status}</p><p><strong>Estimated sessions</strong> ${Number(act.estimatedSessions) || 1}</p>
      ${sessionBlock("Act objective", act.objective)}${sessionBlock("Starting situation", act.startingSituation)}
      <h2>Chapters and sessions</h2>${chapterContent}
      ${sessionBlock("Important locations", act.locations)}${sessionBlock("People and factions", act.people)}
      ${referenceList("Linked actors", act.actorRefs)}${referenceList("Linked locations and notes", act.journalRefs)}
      ${sessionBlock("Developments and pressure", act.developments)}${sessionBlock("Clues and revelations", act.clues)}
      ${sessionBlock("Encounters and hazards", act.encounters)}${referenceList("Linked rewards and items", act.itemRefs)}
      ${sessionBlock("Turning point", act.turningPoint)}${sessionBlock("What ends this act", act.endingCondition)}
      ${sessionBlock("GM notes", act.gmNotes)}${sessionBlock("What actually happened", act.actualOutcome)}
      ${sessionBlock("What carries into the next act", act.carryForward)}`;
    pages.push({ key: `act-${act.id}`, name: `Act ${act.number} — ${act.name || "Untitled"}`, content });
  }
  return pages;
}

const LOOT_FILTER_MODES = {
  required: "Required", preferred: "Preferred", excluded: "Excluded",
};

const LOOT_DAMAGE_TYPES = ["acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic", "spirit", "vitality", "void"];
const LOOT_CONDITIONS = ["blinded", "clumsy", "concealed", "confused", "dazzled", "deafened", "doomed", "drained", "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "immobilized", "off-guard", "paralyzed", "persistent damage", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "wounded"];

const LOOT_MECHANICS = {
  resistance: { label: "Resistance", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "ac-bonus": { label: "AC bonus" },
  "saving-throw": { label: "Saving throw bonus", detailLabel: "Save", details: ["fortitude", "reflex", "will"] },
  healing: { label: "Healing" },
  vitality: { label: "Vitality" },
  "temporary-hp": { label: "Temporary Hit Points" },
  "condition-removal": { label: "Condition removal", detailLabel: "Condition", details: LOOT_CONDITIONS },
  counteract: { label: "Counteract or affliction protection" },
  "attack-bonus": { label: "Attack bonus" },
  "additional-damage": { label: "Additional damage", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "persistent-damage": { label: "Persistent damage", detailLabel: "Damage type", details: LOOT_DAMAGE_TYPES },
  "applies-condition": { label: "Applies a condition", detailLabel: "Condition", details: LOOT_CONDITIONS },
  "forced-movement": { label: "Forced movement" },
  "difficult-terrain": { label: "Difficult terrain" },
  "speed-bonus": { label: "Speed or movement" },
  "skill-bonus": { label: "Skill bonus" },
  perception: { label: "Perception or special senses" },
  shield: { label: "Shield, Hardness, or Shield Block" },
};

function newLootFilter() {
  return { id: foundry.utils.randomID(), mechanic: "resistance", detail: "", mode: "required" };
}

function lootPlainText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ").toLowerCase().replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
}

function lootFilterCorpus(entry) {
  const traits = Array.isArray(entry.traits) ? entry.traits : entry.traits instanceof Set ? [...entry.traits] : [];
  const structured = lootPlainText(`${entry.documentType ?? entry.type ?? ""} ${entry.category ?? ""} ${traits.join(" ")} ${JSON.stringify(entry.rules ?? [])}`);
  const prose = lootPlainText(`${entry.name ?? ""} ${entry.description ?? ""}`);
  return { structured, prose, combined: `${structured} ${prose}`.trim() };
}

function lootMechanicPatterns(mechanic) {
  return {
    resistance: ["resistance", "resistant"],
    "ac-bonus": ["selector ac", "armor class", "bonus to ac", "bonus to your ac", " ac by"],
    "saving-throw": ["saving throw", "fortitude", "reflex", "will save", "saves against"],
    healing: ["healing", "restore hit points", "restores hit points", "regain hit points", "regains hit points", "recover hit points"],
    vitality: ["vitality"],
    "temporary-hp": ["temporary hit points", "temporary hp"],
    "condition-removal": ["remove the condition", "reduces the value", "reduce the value", "recover from", "end the condition", "counteract"],
    counteract: ["counteract", "antidote", "antiplague", "affliction"],
    "attack-bonus": ["attack roll", "bonus to attack", "item bonus to attack", "selector attack"],
    "additional-damage": ["damage dice", "additional damage", "extra damage", "damage die", "bonus to damage", "key damagedice"],
    "persistent-damage": ["persistent damage", "persistent"],
    "applies-condition": ["becomes", "is frightened", "is clumsy", "is enfeebled", "is stupefied", "is slowed", "is stunned", "is sickened", "knocked prone", "grantitem"],
    "forced-movement": ["forced movement", "push the target", "pull the target", "shove", "moves the target"],
    "difficult-terrain": ["difficult terrain", "greater difficult terrain"],
    "speed-bonus": ["speed bonus", "land speed", "fly speed", "swim speed", "climb speed", "burrow speed", "teleport"],
    "skill-bonus": ["skill check", "item bonus to", "bonus to checks"],
    perception: ["perception", "darkvision", "low light vision", "scent", "tremorsense", "echolocation"],
    shield: ["shield", "hardness", "shield block"],
  }[mechanic] ?? [];
}

function lootFilterMatch(entry, filter, flexible = true) {
  const definition = LOOT_MECHANICS[filter.mechanic];
  if (!definition) return { matched: false, reason: "", native: false };
  const corpus = lootFilterCorpus(entry);
  const patterns = lootMechanicPatterns(filter.mechanic);
  const type = String(entry.documentType ?? "").toLowerCase();
  const nativeTypeMatch = filter.mechanic === "shield" && type === "shield";
  const structuredMatch = nativeTypeMatch || patterns.some((pattern) => corpus.structured.includes(pattern));
  const proseMatch = flexible && patterns.some((pattern) => corpus.prose.includes(pattern));
  let matched = structuredMatch || proseMatch;
  const detail = lootPlainText(filter.detail);
  if (matched && detail) {
    const detailCorpus = structuredMatch ? corpus.structured : corpus.combined;
    matched = detailCorpus.includes(detail);
  }
  const detailLabel = detail ? `: ${detail}` : "";
  return {
    matched,
    native: matched && structuredMatch,
    reason: matched ? `${structuredMatch ? "Native" : "Description"}: ${definition.label}${detailLabel}` : "",
  };
}

function applyLootFilters(entry, filters, matchMode = "all", flexible = true) {
  const evaluations = filters.map((filter) => ({ filter, ...lootFilterMatch(entry, filter, flexible) }));
  if (evaluations.some((evaluation) => evaluation.filter.mode === "excluded" && evaluation.matched)) return null;
  const required = evaluations.filter((evaluation) => evaluation.filter.mode === "required");
  const requiredPass = !required.length || (matchMode === "any" ? required.some((evaluation) => evaluation.matched) : required.every((evaluation) => evaluation.matched));
  if (!requiredPass) return null;
  const preferredMatches = evaluations.filter((evaluation) => evaluation.filter.mode === "preferred" && evaluation.matched);
  const reasons = evaluations.filter((evaluation) => evaluation.filter.mode !== "excluded" && evaluation.matched).map((evaluation) => evaluation.reason);
  return {
    filterScore: preferredMatches.length * 10 + required.filter((evaluation) => evaluation.matched).length * 2,
    reasons: [...new Set(reasons)],
  };
}

function lootFamilyKey(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(lesser|moderate|greater|major|true|minor|standard|light|heavy)\b/g, " ")
    .replace(/\+\d+/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function lootItemSourceKind(entry = {}) {
  const type = String(entry.documentType ?? entry.type ?? "").toLowerCase();
  const category = String(entry.category ?? entry.system?.category ?? "").toLowerCase();
  const rawTraits = entry.traits ?? entry.system?.traits?.value ?? [];
  const traitList = rawTraits instanceof Set ? [...rawTraits] : Array.isArray(rawTraits) ? rawTraits : rawTraits ? [rawTraits] : [];
  const traits = new Set(traitList.map((trait) => String(trait).toLowerCase()));
  if (type === "consumable" || type === "ammo" || category === "bomb" || traits.has("consumable") || traits.has("bomb")) return "consumable";
  return "permanent";
}

function lootSourceAllowed(entry, includePermanent, includeConsumable) {
  const sourceKind = lootItemSourceKind(entry);
  return (sourceKind === "permanent" && includePermanent) || (sourceKind === "consumable" && includeConsumable);
}

async function resolveTableResultDocument(result) {
  const uuid = result.documentUuid || (result.documentCollection && result.documentId
    ? (game.packs.get(result.documentCollection) ? `Compendium.${result.documentCollection}.${result.documentId}` : `${result.documentCollection}.${result.documentId}`)
    : "");
  try { return uuid ? await fromUuid(uuid) : null; } catch { return null; }
}

async function installedTreasureTables(kind, level) {
  const aliases = { permanent: ["permanent"], consumable: ["consumable"], gems: ["gem", "precious stone"], art: ["art object"] }[kind] ?? [];
  const matches = (name) => {
    const text = String(name ?? "").toLowerCase();
    const kindMatch = aliases.some((alias) => text.includes(alias));
    return kindMatch && (["gems", "art"].includes(kind) || new RegExp(`(^|\\D)${level}(\\D|$)`).test(text));
  };
  const tables = game.tables.contents.filter((table) => matches(table.name));
  for (const pack of game.packs.filter((candidate) => candidate.documentName === "RollTable")) {
    const index = await pack.getIndex({ fields: ["name"] });
    for (const entry of index.filter((candidate) => matches(candidate.name))) {
      const table = await pack.getDocument(entry._id);
      if (table) tables.push(table);
    }
  }
  return tables;
}

async function rollTreasureTable(kind, level) {
  const tables = await installedTreasureTables(kind, level);
  if (!tables.length) return null;
  const table = tables[Math.floor(Math.random() * tables.length)];
  const draw = await table.roll({ recursive: true });
  const result = draw?.results?.[0];
  if (!result) return null;
  const document = await resolveTableResultDocument(result);
  if (document?.documentName === "Item") return { document, table: table.name };
  return { text: result.text || result.name || "Treasure result", img: result.img || "icons/commodities/gems/gem-faceted-round-white.webp", table: table.name };
}

async function collectFilteredLoot(minLevel, maxLevel, { includePermanent, includeConsumable, rarities, filters, matchMode, flexible }) {
  const supportedTypes = new Set(["armor", "shield", "weapon", "equipment", "backpack", "kit", "book", "treasure", "consumable", "ammo"]);
  const entries = [];
  for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["name", "img", "type", "system.level.value", "system.description.value", "system.traits.value", "system.traits.rarity", "system.category", "system.rules"] });
    for (const entry of index) {
      if (!supportedTypes.has(entry.type)) continue;
      const itemLevel = numeric(entry.system?.level, 0);
      if (itemLevel < minLevel || itemLevel > maxLevel) continue;
      const candidate = {
        name: entry.name, img: entry.img, type: ITEM_TYPE_LABELS[entry.type] ?? entry.type, level: itemLevel,
        description: entry.system?.description?.value ?? "", traits: entry.system?.traits?.value ?? [],
        rarity: String(entry.system?.traits?.rarity ?? "common").toLowerCase(), category: entry.system?.category ?? "", rules: entry.system?.rules ?? [],
        uuid: entry.uuid ?? `Compendium.${pack.collection}.${entry._id}`, source: pack.metadata.label, documentType: entry.type,
      };
      if (!lootSourceAllowed(candidate, includePermanent, includeConsumable)) continue;
      if (!rarities[candidate.rarity]) continue;
      const filterResult = applyLootFilters(candidate, filters, matchMode, flexible);
      if (!filterResult) continue;
      candidate.filterScore = filterResult.filterScore;
      candidate.matchReasons = filterResult.reasons;
      entries.push(candidate);
    }
  }
  const roleMatches = entries.sort((left, right) => right.filterScore - left.filterScore || Math.random() - 0.5);
  const unique = new Map();
  for (const entry of roleMatches) {
    const key = lootFamilyKey(entry.name);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function activeSessionMusicCues(prep) {
  return (prep.musicCues ?? []).filter((cue) => [cue.name, cue.mood, cue.playlistId, cue.audio, cue.notes].some((value) => String(value ?? "").trim()));
}

async function getOrCreateSessionPlaylist(prep) {
  const title = String(prep.title ?? "").trim() || "Next Session";
  const name = `${title} — Music`;
  const existing = game.playlists.find((playlist) => playlist.name === name);
  if (existing) return existing;
  return Playlist.create({
    name,
    flags: { [FLAG_SCOPE]: { sessionMusic: true, sessionTitle: title } },
  });
}

async function ensureSessionPlaylistAvailable(prep) {
  if (game.playlists.size) return null;
  const playlist = await getOrCreateSessionPlaylist(prep);
  for (const cue of prep.musicCues ?? []) if (!cue.playlistId) cue.playlistId = playlist.id;
  return playlist;
}

async function materializeSessionMusic(prep) {
  const cues = activeSessionMusicCues(prep);
  let defaultPlaylist = null;
  if (!game.playlists.size || cues.some((cue) => !game.playlists.get(cue.playlistId))) {
    defaultPlaylist = await getOrCreateSessionPlaylist(prep);
  }
  for (const cue of cues) {
    const playlist = game.playlists.get(cue.playlistId) ?? defaultPlaylist;
    if (!playlist) continue;
    cue.playlistId = playlist.id;
    if (cue.soundId && playlist.sounds.get(cue.soundId)) continue;
    const audio = String(cue.audio ?? "").trim();
    if (!audio) continue;
    const existing = playlist.sounds.find((sound) => sound.path === audio);
    if (existing) { cue.soundId = existing.id; continue; }
    const [created] = await playlist.createEmbeddedDocuments("PlaylistSound", [{
      name: cue.name.trim() || `${cue.moment || "Music"} cue`,
      path: audio,
    }]);
    cue.soundId = created?.id ?? "";
  }
  return defaultPlaylist;
}

function sessionMusicPage(prep) {
  const cues = activeSessionMusicCues(prep);
  if (!cues.length) return "<p>Add music, ambience, and moments of deliberate silence here.</p>";
  return cues.map((cue, index) => {
    const playlist = game.playlists.get(cue.playlistId);
    const sound = playlist?.sounds?.get(cue.soundId);
    const title = cue.name.trim() || `${cue.moment || "Music"} cue ${index + 1}`;
    const source = playlist && sound
      ? `<p><strong>Song</strong> ${escapeHtml(sound.name)} <button type="button" class="ls-play-session-track" data-playlist-id="${playlist.id}" data-sound-id="${sound.id}"><i class="fa-solid fa-play"></i> Play this song</button></p><p><strong>Playlist</strong> @UUID[${playlist.uuid}]{${escapeHtml(playlist.name)}}</p>`
      : playlist
        ? `<p><strong>Foundry Playlist</strong> @UUID[${playlist.uuid}]{${escapeHtml(playlist.name)}}</p><p><em>Choose a specific song in Session Prep before creating the Journal.</em></p>`
      : (cue.audio ? `<p><strong>Audio file</strong> ${escapeHtml(cue.audio)}</p><audio controls src="${escapeHtml(cue.audio)}"></audio>` : "");
    return `<section><p><strong>${escapeHtml(title)}</strong></p>${sessionBlock("When to play", cue.moment)}${sessionBlock("Mood and purpose", cue.mood)}${source}${sessionBlock("Cue notes", cue.notes)}</section>`;
  }).join("<hr>");
}

function sessionJournalPages(prep) {
  const placeNames = prep.locations.map((location, index) => location.name.trim() || `Important Place ${index + 1}`);
  const npcs = (prep.npcs ?? []).filter((npc) => [npc.name, npc.image, npc.role, npc.motivation, npc.secret].some((value) => String(value ?? "").trim()));
  const npcNames = npcs.map((npc, index) => npc.name.trim() || `Important NPC ${index + 1}`);
  const overview = [
    sessionBlock("Main goal", prep.goal), sessionBlock("Opening situation", prep.opening), sessionBlock("Likely ending or cliffhanger", prep.ending),
    `<hr><p><strong>Important places</strong></p><ul>${placeNames.map((name) => `<li>Place — ${escapeHtml(name)}</li>`).join("")}</ul>`,
    "<p><em>See each place page for its description and table-ready details.</em></p>",
  ].filter(Boolean).join("");
  const pages = [{ name: "Session Overview", content: overview }];
  for (const [index, location] of prep.locations.entries()) pages.push({ name: `Place — ${placeNames[index]}`, content: sessionLocationPage({ ...location, name: placeNames[index] }) });
  const peopleRows = (prep.peopleEntries ?? []).filter((entry) => entry.name?.trim() || entry.description?.trim())
    .map((entry) => `<li><strong>${sessionHtml(entry.name || "Unnamed person or faction")}</strong>${entry.description ? ` — ${sessionHtml(entry.description)}` : ""}</li>`).join("");
  const hazardRows = (prep.hazards ?? []).map((entry) => `<li>${sessionReferenceLink(entry)}</li>`).join("");
  const encounterRows = (prep.encounterEntries ?? []).filter((entry) => entry.description?.trim() || entry.actors?.length).map((entry) => {
    const actors = (entry.actors ?? []).map(sessionReferenceLink).join(", ");
    return `<li><strong>${entry.type === "combat" ? "Combat encounter" : "Social encounter"}</strong>${actors ? ` — ${actors}` : ""}${entry.description ? `<br>${sessionHtml(entry.description)}` : ""}</li>`;
  }).join("");
  const peopleOverview = [
    npcNames.length ? `<p><strong>Important NPCs</strong></p><ul>${npcNames.map((name) => `<li>NPC - ${escapeHtml(name)}</li>`).join("")}</ul>` : "",
    peopleRows ? `<p><strong>Other people and factions</strong></p><ul>${peopleRows}</ul>` : "",
    hazardRows ? `<p><strong>Hazards</strong></p><ul>${hazardRows}</ul>` : "",
    encounterRows ? `<p><strong>Encounters</strong></p><ul>${encounterRows}</ul>` : "",
  ].filter(Boolean).join("") || "<p>Who can help, hinder, or surprise the party?</p>";
  pages.push({ name: "People, Hazards & Encounters", content: peopleOverview });
  for (const [index, npc] of npcs.entries()) pages.push({ name: `NPC - ${npcNames[index]}`, content: sessionNpcPage({ ...npc, name: npcNames[index] }) });
  pages.push({ name: "Music & Atmosphere", content: sessionMusicPage(prep) });
  const rewardRows = (prep.rewardItems ?? []).map((entry) => sessionReferenceLink(entry));
  pages.push(
    { name: "Scenes, Clues & Rewards", content: `${sessionList("Likely scenes", (prep.sceneEntries ?? []).map((entry) => entry.text))}${sessionList("Clues", (prep.clueEntries ?? []).map((entry) => entry.text))}${sessionList("Rewards", rewardRows)}${sessionList("Consequences", (prep.consequenceEntries ?? []).map((entry) => entry.text))}${sessionList("Changes", (prep.changeEntries ?? []).map((entry) => entry.text))}` || "<p>Prepare situations, clues, and consequences here.</p>" },
    { name: "GM Reminders & Secrets", content: sessionBlock("GM-only notes", prep.reminders) || "<p>Private reminders, secrets, and contingencies.</p>" },
  );
  return pages;
}

const SESSION_PREP_SECTION_LABELS = new Set([
  "Main goal", "Opening situation", "Likely ending or cliffhanger", "Important places",
  "Why this place matters", "Five senses", "Important NPCs", "NPCs and factions",
  "Other people and factions", "Opposition, hazards, and encounters", "Role in the session",
  "Motivation", "Secret or complication", "Likely scenes and clues",
  "Rewards, consequences, and changes", "GM-only notes",
]);

function cleanSessionPrepHeadings(content) {
  return String(content ?? "").replace(/<h2>([^<]+)<\/h2>/gi, (match, rawLabel) => {
    const label = String(rawLabel).trim();
    if (!SESSION_PREP_SECTION_LABELS.has(label)) return match;
    const cleanLabel = label === "Five senses" ? "Description" : label;
    return `<p><strong>${cleanLabel}</strong></p>`;
  }).replace(/\[\[([^\]\r\n]{1,200})\]\]/g, "$1");
}

async function migrateSessionPrepJournals() {
  if (!game.user.isGM) return;
  for (const journal of game.journal.contents.filter((entry) => entry.getFlag(FLAG_SCOPE, "sessionPrep"))) {
    if (Number(journal.getFlag(FLAG_SCOPE, "sessionPrepVersion") ?? 0) >= 3) continue;
    const updates = [];
    for (const page of journal.pages.contents.filter((entry) => entry.type === "text")) {
      const content = cleanSessionPrepHeadings(page.text?.content);
      if (content !== page.text?.content) updates.push({ _id: page.id, "text.content": content });
    }
    if (updates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", updates);
    await journal.setFlag(FLAG_SCOPE, "sessionPrepVersion", 3);
  }
}

class LoreSmithDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-dashboard",
    classes: ["lore-smith-app"],
    tag: "section",
    position: { width: 1120, height: 760 },
    window: { title: "Lore Smith", icon: "fa-solid fa-book-sparkles", resizable: true },
    actions: {
      dashboardTab: LoreSmithDashboard.changeTab,
      newSessionPrep: LoreSmithDashboard.newSessionPrep,
      previousSessionStep: LoreSmithDashboard.previousSessionStep,
      nextSessionStep: LoreSmithDashboard.nextSessionStep,
      goToSessionStep: LoreSmithDashboard.goToSessionStep,
      addLocation: LoreSmithDashboard.addLocation,
      removeLocation: LoreSmithDashboard.removeLocation,
      browseLocationImage: LoreSmithDashboard.browseLocationImage,
      addSessionNpc: LoreSmithDashboard.addSessionNpc,
      removeSessionNpc: LoreSmithDashboard.removeSessionNpc,
      browseSessionNpcImage: LoreSmithDashboard.browseSessionNpcImage,
      addMusicCue: LoreSmithDashboard.addMusicCue,
      removeMusicCue: LoreSmithDashboard.removeMusicCue,
      browseMusicAudio: LoreSmithDashboard.browseMusicAudio,
      addPeopleEntry: LoreSmithDashboard.addPeopleEntry,
      removePeopleEntry: LoreSmithDashboard.removePeopleEntry,
      addSessionEncounter: LoreSmithDashboard.addSessionEncounter,
      removeSessionEncounter: LoreSmithDashboard.removeSessionEncounter,
      addSessionTextEntry: LoreSmithDashboard.addSessionTextEntry,
      removeSessionTextEntry: LoreSmithDashboard.removeSessionTextEntry,
      removeSessionReference: LoreSmithDashboard.removeSessionReference,
      createSessionJournal: LoreSmithDashboard.createSessionJournal,
      openLastSessionJournal: LoreSmithDashboard.openLastSessionJournal,
      createNote: LoreSmithDashboard.createNote,
      openNote: LoreSmithDashboard.openNote,
      openNotebook: LoreSmithDashboard.openNotebook,
      searchCreatures: LoreSmithDashboard.searchCreatures,
      cloneCreature: LoreSmithDashboard.cloneCreature,
      blankCreature: LoreSmithDashboard.blankCreature,
      searchItems: LoreSmithDashboard.searchItems,
      cloneItem: LoreSmithDashboard.cloneItem,
      blankItem: LoreSmithDashboard.blankItem,
      generateLoot: LoreSmithDashboard.generateLoot,
      addLootFilter: LoreSmithDashboard.addLootFilter,
      removeLootFilter: LoreSmithDashboard.removeLootFilter,
      clearLoot: LoreSmithDashboard.clearLoot,
      addLootToRewards: LoreSmithDashboard.addLootToRewards,
      openLootDocument: LoreSmithDashboard.openLootDocument,
      newCampaignBuild: LoreSmithDashboard.newCampaignBuild,
      previousCampaignStep: LoreSmithDashboard.previousCampaignStep,
      nextCampaignStep: LoreSmithDashboard.nextCampaignStep,
      goToCampaignStep: LoreSmithDashboard.goToCampaignStep,
      browseCampaignMap: LoreSmithDashboard.browseCampaignMap,
      activateCampaignMapTool: LoreSmithDashboard.activateCampaignMapTool,
      cancelCampaignMapTool: LoreSmithDashboard.cancelCampaignMapTool,
      resetCampaignMapView: LoreSmithDashboard.resetCampaignMapView,
      toggleLoreSmithFullscreen: LoreSmithDashboard.toggleLoreSmithFullscreen,
      selectCampaignMarker: LoreSmithDashboard.selectCampaignMarker,
      removeCampaignMarker: LoreSmithDashboard.removeCampaignMarker,
      browseCampaignLocationImage: LoreSmithDashboard.browseCampaignLocationImage,
      addCampaignEntry: LoreSmithDashboard.addCampaignEntry,
      removeCampaignEntry: LoreSmithDashboard.removeCampaignEntry,
      addCampaignCharacter: LoreSmithDashboard.addCampaignCharacter,
      removeCampaignCharacter: LoreSmithDashboard.removeCampaignCharacter,
      addCampaignAct: LoreSmithDashboard.addCampaignAct,
      prepareCampaignSession: LoreSmithDashboard.prepareCampaignSession,
      openCampaignSessionJournal: LoreSmithDashboard.openCampaignSessionJournal,
      backToCampaignAct: LoreSmithDashboard.backToCampaignAct,
      markCampaignActReady: LoreSmithDashboard.markCampaignActReady,
      reopenCampaignAct: LoreSmithDashboard.reopenCampaignAct,
      completeCampaignAct: LoreSmithDashboard.completeCampaignAct,
      removeCampaignActReference: LoreSmithDashboard.removeCampaignActReference,
      createCampaignJournal: LoreSmithDashboard.createCampaignJournal,
      openCampaignJournal: LoreSmithDashboard.openCampaignJournal,
      newWorldMapBuild: LoreSmithDashboard.newWorldMapBuild,
      browseWorldMap: LoreSmithDashboard.browseWorldMap,
      activateWorldRegionTool: LoreSmithDashboard.activateWorldRegionTool,
      cancelWorldRegionTool: LoreSmithDashboard.cancelWorldRegionTool,
      resetWorldMapView: LoreSmithDashboard.resetWorldMapView,
      selectWorldRegion: LoreSmithDashboard.selectWorldRegion,
      deleteWorldRegion: LoreSmithDashboard.deleteWorldRegion,
      openWorldRegionJournal: LoreSmithDashboard.openWorldRegionJournal,
      createWorldAtlas: LoreSmithDashboard.createWorldAtlas,
    },
  };

  static PARTS = {
    dashboard: { template: `modules/${MODULE_ID}/templates/dashboard.hbs` },
  };

  activeTab = "campaign";
  activeNoteId = null;
  creatureSearch = "";
  itemSearch = "";
  itemType = "";
  creatureResults = [];
  itemResults = [];
  sessionStep = 0;
  sessionPrep = newSessionPrep();
  sessionDraftLoaded = false;
  sessionSaveTimer = null;
  lastSessionJournalId = null;
  sessionScrollTop = 0;
  lootResults = [];
  lootStatus = "";
  lootMinLevel = 1;
  lootMaxLevel = 1;
  lootCount = 6;
  lootSources = { permanent: true, consumable: true, gems: false, art: false };
  lootRarities = { common: true, uncommon: true, rare: false, unique: false };
  lootFilters = [];
  lootMatchMode = "all";
  lootFlexible = true;
  campaignStep = 0;
  campaign = newCampaignBuild();
  adventureCampaign = this.campaign;
  mapCampaign = newCampaignMapBuild();
  adventureCampaignStep = 0;
  mapCampaignStep = 0;
  campaignDraftLoaded = false;
  campaignSaveTimer = null;
  campaignSavePromise = Promise.resolve();
  campaignSaveRevision = 0;
  campaignDeletedLocationIds = new Set();
  campaignScrollTop = 0;
  campaignMapTool = "";
  worldMap = newWorldMapBuild();
  worldMapDraftLoaded = false;
  worldMapTool = "";
  worldMapSaveTimer = null;
  worldMapSavePromise = Promise.resolve();
  worldMapSaveRevision = 0;
  worldMapScrollTop = 0;
  _worldJournalPromises = new Map();
  _worldJournalSyncPromises = new Map();
  _worldFolderPromise = null;
  _worldAtlasPromise = null;
  dashboardFullscreen = false;

  async getNotebook(create = false) {
    let journal = game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "notebook"));
    if (!journal) {
      journal = game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "note"));
      if (journal) await journal.setFlag(FLAG_SCOPE, "notebook", true);
    }
    if (!journal && create) {
      journal = await JournalEntry.create({
        name: "Campaign Journal",
        flags: { [FLAG_SCOPE]: { note: true, notebook: true } },
        pages: [],
      });
    }
    return journal;
  }

  async _prepareContext(options) {
    if (!this.sessionDraftLoaded) {
      this.sessionDraftLoaded = true;
      try {
        const rawDraft = game.settings.get(MODULE_ID, "sessionPrepDraft");
        const stored = rawDraft ? JSON.parse(rawDraft) : null;
        const storedPrep = stored?.prep ?? stored;
        if (storedPrep && typeof storedPrep === "object") {
          const fresh = newSessionPrep();
          const storedLocations = Array.isArray(storedPrep.locations) ? storedPrep.locations : [];
          this.sessionPrep = {
            ...fresh,
            ...storedPrep,
            locations: storedLocations.length
              ? storedLocations.map((location) => ({ ...newSessionLocation(), ...location, id: location.id || foundry.utils.randomID() }))
              : fresh.locations,
            npcs: Array.isArray(storedPrep.npcs)
              ? storedPrep.npcs.map((npc) => ({ ...newSessionNpc(), ...npc, id: npc.id || foundry.utils.randomID() }))
              : fresh.npcs,
            musicCues: Array.isArray(storedPrep.musicCues)
              ? storedPrep.musicCues.map((cue) => ({ ...newSessionMusicCue(), ...cue, id: cue.id || foundry.utils.randomID() }))
              : fresh.musicCues,
            peopleEntries: Array.isArray(storedPrep.peopleEntries)
              ? storedPrep.peopleEntries.map((entry) => ({ ...newSessionPeopleEntry(), ...entry, id: entry.id || foundry.utils.randomID() }))
              : [newSessionPeopleEntry(storedPrep.people ?? "")],
            hazards: Array.isArray(storedPrep.hazards) ? storedPrep.hazards.map(normalizeSessionReference) : [],
            encounterEntries: Array.isArray(storedPrep.encounterEntries)
              ? storedPrep.encounterEntries.map((entry) => ({ ...newSessionEncounter(), ...entry, id: entry.id || foundry.utils.randomID(), actors: (entry.actors ?? []).map(normalizeSessionReference) }))
              : [newSessionEncounter()],
            sceneEntries: normalizeSessionTextEntries(storedPrep.sceneEntries, storedPrep.scenes ?? ""),
            clueEntries: normalizeSessionTextEntries(storedPrep.clueEntries),
            rewardItems: Array.isArray(storedPrep.rewardItems) ? storedPrep.rewardItems.map(normalizeSessionReference) : [],
            consequenceEntries: normalizeSessionTextEntries(storedPrep.consequenceEntries, storedPrep.rewards ?? ""),
            changeEntries: normalizeSessionTextEntries(storedPrep.changeEntries),
          };
          this.sessionStep = Math.max(0, Math.min(5, Number(stored?.step) || 0));
        }
      } catch (error) {
        console.warn("Lore Smith | Could not restore the Session Prep draft.", error);
      }
    }
    if (!this.campaignDraftLoaded) {
      this.campaignDraftLoaded = true;
      try {
        const rawDraft = game.settings.get(MODULE_ID, "campaignBuilderDraft");
        const stored = rawDraft ? JSON.parse(rawDraft) : null;
        const rawWorldMapDraft = game.settings.get(MODULE_ID, "campaignMapBuilderWorldDraft");
        const rawClientMapDraft = game.settings.get(MODULE_ID, "campaignMapBuilderDraft");
        const worldMapDraft = parseStoredDraft(rawWorldMapDraft, "world");
        const clientMapDraft = parseStoredDraft(rawClientMapDraft, "Foundry browser");
        const recoveryMapDraft = readCampaignMapRecovery();
        const storedMap = [
          { draft: worldMapDraft, priority: 0 },
          { draft: clientMapDraft, priority: 1 },
          { draft: recoveryMapDraft, priority: 2 },
        ].filter(({ draft }) => draft?.campaign || draft?.name).sort((left, right) =>
          (Number(left.draft.updatedAt) || 0) - (Number(right.draft.updatedAt) || 0)
          || (Number(left.draft.revision) || 0) - (Number(right.draft.revision) || 0)
          || left.priority - right.priority
        ).at(-1)?.draft ?? null;
        if (stored?.campaign || stored?.name) {
          this.adventureCampaign = normalizeCampaignBuild(stored.campaign ?? stored);
          this.adventureCampaignStep = Math.max(0, Math.min(7, Number(stored.step) || 0));
        }
        if (storedMap?.campaign || storedMap?.name) {
          this.mapCampaign = normalizeCampaignMapBuild(storedMap.campaign ?? storedMap);
          this.mapCampaignStep = Math.max(0, Math.min(7, Number(storedMap.step) || 0));
          this.campaignSaveRevision = Math.max(Number(storedMap.revision) || 0, Number(worldMapDraft?.revision) || 0, Number(clientMapDraft?.revision) || 0, Number(recoveryMapDraft?.revision) || 0);
        } else if (stored?.campaign?.map || stored?.map) {
          this.mapCampaign = normalizeCampaignMapBuild(stored.campaign ?? stored);
          this.mapCampaignStep = Math.max(0, Math.min(7, Number(stored.step) || 0));
        }
        this.campaign = this.activeTab === "campaignMap" ? this.mapCampaign : this.adventureCampaign;
        this.campaignStep = this.activeTab === "campaignMap" ? this.mapCampaignStep : this.adventureCampaignStep;
      } catch (error) {
        console.warn("Lore Smith | Could not restore the Campaign Builder draft.", error);
      }
    }
    if (!this.worldMapDraftLoaded) {
      this.worldMapDraftLoaded = true;
      try {
        const candidates = [
          { draft: parseStoredDraft(game.settings.get(MODULE_ID, "worldMapBuilderWorldDraft"), "shared world-map"), priority: 0 },
          { draft: parseStoredDraft(game.settings.get(MODULE_ID, "worldMapBuilderDraft"), "browser world-map"), priority: 1 },
          { draft: readWorldMapRecovery(), priority: 2 },
        ].filter(({ draft }) => draft?.worldMap || draft?.map || draft?.regions)
          .sort((left, right) => (Number(left.draft.updatedAt) || 0) - (Number(right.draft.updatedAt) || 0)
            || (Number(left.draft.revision) || 0) - (Number(right.draft.revision) || 0)
            || left.priority - right.priority);
        const storedWorld = candidates.at(-1)?.draft ?? null;
        if (storedWorld) {
          this.worldMap = normalizeWorldMapBuild(storedWorld.worldMap ?? storedWorld);
          this.worldMapSaveRevision = Math.max(...candidates.map(({ draft }) => Number(draft.revision) || 0), 0);
          if (this.worldMap.draftVertices.length) this.worldMapTool = "draw";
        }
      } catch (error) {
        console.warn("Lore Smith | Could not restore the World Map Builder draft.", error);
      }
    }
    const notebook = await this.getNotebook(false);
    const notePages = notebook?.pages?.contents
      ?.filter((page) => page.type === "text")
      .sort((left, right) => left.sort - right.sort) ?? [];
    if (!notePages.some((page) => page.id === this.activeNoteId)) this.activeNoteId = notePages[0]?.id ?? null;
    const notes = notePages.map((page) => ({
      id: page.id,
      name: page.name,
      active: page.id === this.activeNoteId,
    }));
    const activePage = notebook?.pages?.get(this.activeNoteId) ?? null;
    const activeNote = activePage ? {
      id: activePage.id,
      name: activePage.name,
      content: activePage.text?.content ?? "",
    } : null;
    if (!this.lastSessionJournalId) {
      const latestSession = game.journal.contents
        .filter((entry) => entry.getFlag(FLAG_SCOPE, "sessionPrep"))
        .sort((left, right) => String(right.getFlag(FLAG_SCOPE, "createdAt") ?? "").localeCompare(String(left.getFlag(FLAG_SCOPE, "createdAt") ?? "")))[0];
      this.lastSessionJournalId = latestSession?.id ?? null;
    }
    const locationViews = this.sessionPrep.locations.map((location, index) => ({ ...location, number: index + 1, canRemove: this.sessionPrep.locations.length > 2 }));
    const npcViews = (this.sessionPrep.npcs ?? []).map((npc, index) => ({ ...npc, number: index + 1 }));
    const playlists = [...game.playlists.contents].sort((left, right) => left.name.localeCompare(right.name));
    const musicCueViews = (this.sessionPrep.musicCues ?? []).map((cue, index) => ({
      ...cue,
      number: index + 1,
      momentOptions: SESSION_MUSIC_MOMENTS.map((moment) => ({ value: moment, label: moment, selected: cue.moment === moment })),
      playlistOptions: [
        { value: "", label: "No Foundry Playlist", selected: !cue.playlistId },
        ...playlists.map((playlist) => ({ value: playlist.id, label: playlist.name, selected: cue.playlistId === playlist.id })),
      ],
      trackOptions: [
        { value: "", label: cue.playlistId ? "Choose a song from this Playlist" : "Choose a Playlist first", selected: !cue.soundId },
        ...(game.playlists.get(cue.playlistId)?.sounds?.contents ?? []).map((sound) => ({ value: sound.id, label: sound.name, selected: cue.soundId === sound.id })),
      ],
    }));
    const sessionValidation = [];
    if (!this.sessionPrep.title.trim()) sessionValidation.push("Add a session title.");
    if (!this.sessionPrep.goal.trim()) sessionValidation.push("Add the session's main goal.");
    if (this.sessionPrep.locations.length < 2) sessionValidation.push("Prepare at least two important places.");
    for (const [index, location] of this.sessionPrep.locations.entries()) {
      if (!location.name.trim()) sessionValidation.push(`Name important place ${index + 1}.`);
      if (!location.image.trim()) sessionValidation.push(`Choose an image for important place ${index + 1}.`);
    }
    const sessionStepEntries = [["goal", "Goal"], ["locations", "Places"], ["people", "People"], ["music", "Music"], ["scenes", "Scenes"], ["review", "Review"]];
    const sessionSteps = Object.fromEntries(sessionStepEntries.map(([key, label], index) => [key, { index, number: index + 1, label, active: this.sessionStep === index }]));
    const mapBuilderActive = this.activeTab === "campaignMap";
    if (mapBuilderActive) ensureCampaignMapScope(this.campaign); else ensureCampaignActs(this.campaign);
    const campaignStepEntries = mapBuilderActive
      ? [["map", "Map"], ["focus", "Starting Area"], ["center", "Center"], ["nearby", "Nearby"], ["distant", "Distant"], ["routes", "Connections"], ["opening", "Opening"], ["review", "Review"]]
      : this.campaign.acts.map((act, index) => [`act${index}`, act.name || `Act ${index + 1}`]);
    const campaignSteps = Object.fromEntries(campaignStepEntries.map(([key, label], index) => [key, { index, number: index + 1, label, active: this.campaignStep === index }]));
    const campaignStyle = CAMPAIGN_STYLES[this.campaign.style] ?? CAMPAIGN_STYLES.adventure;
    const campaignLength = CAMPAIGN_LENGTHS[this.campaign.length] ?? CAMPAIGN_LENGTHS.short;
    const campaignTargets = campaignPlanTargets(this.campaign);
    const campaignPeople = this.campaign.people.map((person, index) => ({ ...person, number: index + 1, suggestion: campaignStyle.people[index % campaignStyle.people.length] ?? "" }));
    let previousChapterGroup = 0;
    const campaignChapters = this.campaign.chapters.slice(0, campaignTargets.sessions).map((chapter, index) => {
      const grouping = campaignChapterGrouping(this.campaign, index);
      const firstInGroup = grouping.group !== previousChapterGroup;
      previousChapterGroup = grouping.group;
      return { ...chapter, ...grouping, firstInGroup, number: index + 1 };
    });
    const campaignMap = mapBuilderActive ? campaignMapView(this.campaign) : campaignMapView({ locations: [], map: {} });
    const startOptions = [{ value: "", label: "Choose the starting point", selected: !campaignMap.startLocationId }, ...this.campaign.locations.map((location) => ({ value: location.id, label: location.name || "Unnamed point", selected: location.id === campaignMap.startLocationId }))];
    const markerViews = this.campaign.locations.map((location, index) => {
      const band = campaignLocationBand(this.campaign, location);
      const distance = campaignMarkerDistance(this.campaign, location);
      return {
        ...location, number: index + 1, band, guidance: campaignLocationGuidance(location, band),
        positioned: Number.isFinite(Number.parseFloat(location.x)) && Number.isFinite(Number.parseFloat(location.y)),
        left: `${(Number(location.x) || 0) * 100}%`, top: `${(Number(location.y) || 0) * 100}%`,
        distancePercent: distance === null ? "" : Math.round(distance * 100), isCenter: band === "center",
        isNearby: band === "nearby", isDistant: band === "distant", isOutside: band === "outside",
        icon: CAMPAIGN_POINT_ICONS[location.type] ?? CAMPAIGN_POINT_ICONS.custom,
        markerScale: Math.max(0.55, Math.min(1.35, 1 / (Number(campaignMap.zoom) || 1))),
        typeOptions: Object.entries(CAMPAIGN_POINT_TYPES).map(([value, label]) => ({ value, label, selected: value === location.type })),
      };
    });
    const markerByBand = (band) => markerViews.filter((entry) => entry.band === band);
    const locationOptions = [{ value: "", label: "Choose a point", selected: false }, ...this.campaign.locations.map((location) => ({ value: location.id, label: location.name || "Unnamed point" }))];
    const campaignRoutes = (this.campaign.routes ?? []).map((route, index) => ({
      ...route, number: index + 1,
      fromOptions: locationOptions.map((option) => ({ ...option, selected: option.value === route.fromId })),
      toOptions: locationOptions.map((option) => ({ ...option, selected: option.value === route.toId })),
      typeOptions: Object.entries(CAMPAIGN_ROUTE_TYPES).map(([value, label]) => ({ value, label, selected: value === route.type })),
    }));
    if (!mapBuilderActive) {
      const requestedAct = this.campaign.acts[this.campaignStep];
      if (!requestedAct || (this.campaignStep > 0 && this.campaign.acts[this.campaignStep - 1]?.status !== "completed")) {
        const firstAvailable = this.campaign.acts.findIndex((act, index) => act.status !== "completed" && (index === 0 || this.campaign.acts[index - 1]?.status === "completed"));
        this.campaignStep = firstAvailable >= 0 ? firstAvailable : Math.max(0, this.campaign.acts.length - 1);
      }
    }
    const campaignActs = mapBuilderActive ? [] : this.campaign.acts.map((act, index) => {
      const previousComplete = index === 0 || this.campaign.acts[index - 1]?.status === "completed";
      const locked = !previousComplete;
      const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][index] ?? String(index + 1);
      const chapters = act.chapters.map((chapter, chapterIndex) => ({
        ...chapter,
        roman: ["I", "II", "III"][chapterIndex],
        sessionCount: chapter.sessions.length,
        sessions: chapter.sessions.map((session) => ({
          ...session,
          prepared: Boolean(session.prep),
          journalReady: Boolean(game.journal.get(session.journalId)),
        })),
      }));
      return {
        ...act, index, roman, locked, active: index === this.campaignStep,
        chapters,
        draft: act.status === "draft", ready: act.status === "ready", completed: act.status === "completed",
        previousCarryForward: this.campaign.acts[index - 1]?.carryForward ?? "",
        statusLabel: act.status === "completed" ? "Completed" : act.status === "ready" ? "Ready to play" : "Draft",
      };
    });
    const campaignCurrentAct = mapBuilderActive ? null : campaignActs[this.campaignStep];
    const linkedSession = this.sessionPrep.campaignLink;
    const linkedAct = linkedSession ? this.adventureCampaign.acts.find((act) => act.id === linkedSession.actId) : null;
    const linkedChapter = linkedAct?.chapters.find((chapter) => chapter.id === linkedSession.chapterId);
    const linkedActSession = linkedChapter?.sessions.find((session) => session.id === linkedSession.sessionId);
    const sessionCampaignLink = linkedAct && linkedChapter && linkedActSession ? {
      ...linkedSession,
      actName: linkedAct.name,
      actNumber: linkedAct.number,
      actRoman: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][linkedAct.number - 1] ?? String(linkedAct.number),
      chapterName: linkedChapter.name,
      chapterRoman: ["I", "II", "III"][linkedChapter.number - 1],
      sessionNumber: linkedActSession.number,
    } : null;
    const campaignActValidation = campaignCurrentAct ? campaignActMissingRequirements(this.campaign, campaignCurrentAct) : [];
    const campaignValidation = [];
    if (!this.campaign.name.trim()) campaignValidation.push("Name the campaign.");
    if (mapBuilderActive) {
      if (!campaignMap.image) campaignValidation.push("Upload a regional map.");
      if (!campaignMap.startLocationId) campaignValidation.push("Choose a starting point.");
      if (!this.campaign.problem.wrong.trim()) campaignValidation.push("Describe the opening problem.");
    } else campaignValidation.push(...campaignActValidation);
    const campaignRecommendations = [];
    const namedCount = (entries) => entries.filter((entry) => entry.name.trim()).length;
    if (mapBuilderActive && !markerViews.some((entry) => entry.isNearby)) campaignRecommendations.push("Place at least one nearby point to give the players an immediate direction beyond the starting location.");
    if (mapBuilderActive && !markerViews.some((entry) => entry.isDistant)) campaignRecommendations.push("Include one distant point inside the focus circle to suggest a wider region without preparing it deeply.");
    const worldMapView = {
      image: this.worldMap.map.image,
      hasImage: Boolean(this.worldMap.map.image),
      zoom: Math.max(1, Math.min(6, Number(this.worldMap.map.view.zoom) || 1)),
      panX: Number(this.worldMap.map.view.panX) || 0,
      panY: Number(this.worldMap.map.view.panY) || 0,
    };
    const worldMapSameSource = Boolean(this.worldMap.map.image && this.worldMap.map.image === this.mapCampaign.map.image);
    const positionedWorldLocations = worldMapSameSource
      ? this.mapCampaign.locations.filter((entry) => Number.isFinite(Number.parseFloat(entry.x)) && Number.isFinite(Number.parseFloat(entry.y)))
      : [];
    const regionSort = (left, right) => worldRegionDepth(left, this.worldMap.regions) - worldRegionDepth(right, this.worldMap.regions)
      || worldPolygonArea(right.vertices) - worldPolygonArea(left.vertices)
      || right.id.localeCompare(left.id);
    const worldRegionViews = [...this.worldMap.regions].sort(regionSort).map((region) => {
      const centroid = worldPolygonLabelPoint(region.vertices);
      const containedLocations = positionedWorldLocations.filter((location) => worldPointInPolygon({ x: Number(location.x), y: Number(location.y) }, region.vertices));
      const children = this.worldMap.regions.filter((candidate) => candidate.parentId === region.id);
      return {
        ...region,
        selected: region.id === this.worldMap.selectedRegionId,
        points: region.vertices.map((point) => `${(point.x * 1000).toFixed(2)},${(point.y * 1000).toFixed(2)}`).join(" "),
        vertexViews: region.vertices.map((point, index) => ({ index, left: `${point.x * 100}%`, top: `${point.y * 100}%`, markerScale: Math.max(0.62, Math.min(1.15, 1 / worldMapView.zoom)) })),
        labelLeft: `${centroid.x * 100}%`, labelTop: `${centroid.y * 100}%`,
        labelScale: Math.max(0.62, Math.min(1.15, 1 / worldMapView.zoom)),
        icon: WORLD_REGION_TYPES[region.type]?.icon ?? WORLD_REGION_TYPES.other.icon,
        typeLabel: WORLD_REGION_TYPES[region.type]?.label ?? WORLD_REGION_TYPES.other.label,
        developmentLabel: WORLD_REGION_DEVELOPMENT[region.development] ?? WORLD_REGION_DEVELOPMENT.named,
        depth: worldRegionDepth(region, this.worldMap.regions), area: worldPolygonArea(region.vertices),
        containedLocations, children, journalAvailable: Boolean(game.journal.get(region.journalId)),
      };
    });
    const selectedWorldRegion = this.worldMap.regions.find((region) => region.id === this.worldMap.selectedRegionId) ?? null;
    const wouldCreateWorldRegionCycle = (candidate) => {
      if (!selectedWorldRegion) return false;
      let current = candidate; const visited = new Set();
      while (current?.parentId && !visited.has(current.id)) {
        if (current.parentId === selectedWorldRegion.id) return true;
        visited.add(current.id); current = this.worldMap.regions.find((entry) => entry.id === current.parentId);
      }
      return false;
    };
    const selectedWorldRegionView = selectedWorldRegion ? {
      ...selectedWorldRegion,
      typeOptions: Object.entries(WORLD_REGION_TYPES).map(([value, data]) => ({ value, label: data.label, selected: value === selectedWorldRegion.type })),
      developmentOptions: Object.entries(WORLD_REGION_DEVELOPMENT).map(([value, label]) => ({ value, label, selected: value === selectedWorldRegion.development })),
      parentOptions: [
        { value: "", label: "No parent region", selected: !selectedWorldRegion.parentId },
        ...this.worldMap.regions.filter((candidate) => candidate.id !== selectedWorldRegion.id && !wouldCreateWorldRegionCycle(candidate))
          .map((candidate) => ({ value: candidate.id, label: candidate.name || "Unnamed region", selected: selectedWorldRegion.parentId === candidate.id })),
      ],
      containedLocations: positionedWorldLocations.filter((location) => worldPointInPolygon({ x: Number(location.x), y: Number(location.y) }, selectedWorldRegion.vertices)),
      childRegions: this.worldMap.regions.filter((candidate) => candidate.parentId === selectedWorldRegion.id),
      journalAvailable: Boolean(game.journal.get(selectedWorldRegion.journalId)),
    } : null;
    const worldMapPointViews = positionedWorldLocations.map((location) => {
      const primary = worldRegionAtPoint({ x: Number(location.x), y: Number(location.y) }, this.worldMap.regions);
      return {
        ...location,
        left: `${Number(location.x) * 100}%`, top: `${Number(location.y) * 100}%`,
        icon: CAMPAIGN_POINT_ICONS[location.type] ?? CAMPAIGN_POINT_ICONS.custom,
        primaryRegionName: primary?.name ?? "",
      };
    });
    const worldMapValidation = [];
    if (!this.worldMap.name.trim()) worldMapValidation.push("Name the world or atlas.");
    if (!this.worldMap.map.image) worldMapValidation.push("Choose a world map.");
    if (!this.worldMap.regions.length) worldMapValidation.push("Draw at least one region.");
    if (this.worldMap.regions.some((region) => !region.name.trim())) worldMapValidation.push("Name every region.");
    if (this.worldMap.regions.some((region) => region.vertices.length < 3 || worldPolygonArea(region.vertices) < 0.0001 || worldPolygonSelfIntersects(region.vertices))) {
      worldMapValidation.push("Repair invalid or self-crossing region boundaries.");
    }
    if (this.worldMap.regions.some((region) => {
      const parent = this.worldMap.regions.find((candidate) => candidate.id === region.parentId);
      return parent && !worldRegionContainsRegion(parent, region);
    })) worldMapValidation.push("A subregion extends beyond its parent. Reshape it or change its parent region.");
    return {
      ...await super._prepareContext(options),
      tabs: { [this.activeTab]: true },
      notes,
      activeNote,
      notebookName: notebook?.name ?? "Campaign Journal",
      creatureSearch: this.creatureSearch,
      itemSearch: this.itemSearch,
      itemTypes: Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label, selected: value === this.itemType })),
      creatureResults: this.creatureResults,
      itemResults: this.itemResults,
      sessionPrep: { ...this.sessionPrep, locations: locationViews, npcs: npcViews, musicCues: musicCueViews },
      sessionCampaignLink,
      sessionSteps,
      sessionValidation,
      canSessionBack: this.sessionStep > 0,
      lastSessionJournalId: this.lastSessionJournalId,
      hasFoundryPlaylists: game.playlists.size > 0,
      peopleEntries: (this.sessionPrep.peopleEntries ?? []).map((entry, index) => ({ ...entry, number: index + 1 })),
      hazards: this.sessionPrep.hazards ?? [],
      encounterEntries: (this.sessionPrep.encounterEntries ?? []).map((entry, index) => ({ ...entry, number: index + 1, social: entry.type === "social", combat: entry.type === "combat" })),
      sceneEntries: this.sessionPrep.sceneEntries ?? [], clueEntries: this.sessionPrep.clueEntries ?? [],
      rewardItems: this.sessionPrep.rewardItems ?? [], consequenceEntries: this.sessionPrep.consequenceEntries ?? [], changeEntries: this.sessionPrep.changeEntries ?? [],
      lootResults: this.lootResults, lootStatus: this.lootStatus,
      lootMinLevel: this.lootMinLevel, lootMaxLevel: this.lootMaxLevel, lootCount: this.lootCount, lootSources: this.lootSources,
      lootRarities: this.lootRarities, lootMatchMode: this.lootMatchMode, lootFlexible: this.lootFlexible,
      lootMatchModes: [
        { value: "all", label: "Match every required filter", selected: this.lootMatchMode === "all" },
        { value: "any", label: "Match at least one required filter", selected: this.lootMatchMode === "any" },
      ],
      lootFilters: this.lootFilters.map((filter) => {
        const definition = LOOT_MECHANICS[filter.mechanic] ?? LOOT_MECHANICS.resistance;
        return {
          ...filter,
          modes: Object.entries(LOOT_FILTER_MODES).map(([value, label]) => ({ value, label, selected: filter.mode === value })),
          mechanics: Object.entries(LOOT_MECHANICS).map(([value, data]) => ({ value, label: data.label, selected: filter.mechanic === value })),
          hasDetails: Boolean(definition.details?.length), detailLabel: definition.detailLabel ?? "Detail",
          details: (definition.details ?? []).map((value) => ({ value, label: value.replace(/\b\w/g, (letter) => letter.toUpperCase()), selected: filter.detail === value })),
        };
      }),
      campaign: { ...this.campaign, people: campaignPeople },
      campaignSteps,
      campaignActs,
      campaignCurrentAct,
      campaignActValidation,
      campaignAllActsComplete: !mapBuilderActive && campaignActs.length > 0 && campaignActs.every((act) => act.completed),
      campaignStyles: Object.entries(CAMPAIGN_STYLES).map(([value, data]) => ({ value, label: data.label, selected: value === this.campaign.style })),
      campaignLengths: Object.entries(CAMPAIGN_LENGTHS).map(([value, data]) => ({ value, label: data.label, selected: value === this.campaign.length })),
      campaignTones: Object.entries(CAMPAIGN_TONES).map(([value, label]) => ({ value, label, selected: value === this.campaign.tone })),
      campaignLevelingOptions: [
        { value: "milestone", label: "Milestone leveling", selected: this.campaign.progression.leveling === "milestone" },
        { value: "xp", label: "Experience Points", selected: this.campaign.progression.leveling === "xp" },
      ],
      campaignGuidance: { style: campaignStyle.guidance, scope: campaignLength.scope },
      campaignValidation, campaignRecommendations, campaignScope: campaignLength, campaignTargets,
      campaignMap, campaignMapTool: this.campaignMapTool,
      campaignMapMarkerTool: this.campaignMapTool === "marker", campaignMapFocusTool: this.campaignMapTool === "focus",
      campaignMapMarkers: markerViews,
      campaignCenterLocations: markerByBand("center"), campaignNearbyLocations: markerByBand("nearby"), campaignDistantLocations: markerByBand("distant"), campaignOutsideLocations: markerByBand("outside"),
      campaignStartOptions: startOptions, campaignRoutes,
      campaignStructured: this.campaign.length !== "open", campaignSandbox: this.campaign.length === "open", campaignChapters,
      campaignStructure: this.campaign.structure.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignLocations: this.campaign.locations.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignFactions: this.campaign.factions.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignThreats: this.campaign.threats.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignSecrets: this.campaign.secrets.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignRumors: this.campaign.rumors.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignWorldEvents: this.campaign.worldEvents.map((entry, index) => ({ ...entry, number: index + 1 })),
      campaignQuestions: this.campaign.openQuestions.map((entry, index) => ({ ...entry, number: index + 1 })),
      canCampaignBack: this.campaignStep > 0,
      campaignJournalAvailable: Boolean(game.journal.get(this.campaign.journalId)),
      worldMap: this.worldMap,
      worldMapView,
      worldMapRegions: worldRegionViews,
      worldMapSelectedRegion: selectedWorldRegionView,
      worldMapPoints: worldMapPointViews,
      worldMapSameSource,
      worldMapDraftPoints: this.worldMap.draftVertices.map((point) => `${(point.x * 1000).toFixed(2)},${(point.y * 1000).toFixed(2)}`).join(" "),
      worldMapTool: this.worldMapTool,
      worldMapDrawing: this.worldMapTool === "draw",
      worldMapValidation,
      worldMapAtlasAvailable: Boolean(game.journal.get(this.worldMap.indexJournalId)?.getFlag(FLAG_SCOPE, "worldBuilder")
        && game.journal.get(this.worldMap.indexJournalId)?.getFlag(FLAG_SCOPE, "worldId") === this.worldMap.id
        && game.journal.get(this.worldMap.indexJournalId)?.getFlag(FLAG_SCOPE, "worldDocument") === "index"),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element?.classList.toggle("ls-dashboard-fullscreen", this.dashboardFullscreen);
    const fullscreenButton = this.element?.querySelector('[data-action="toggleLoreSmithFullscreen"]');
    if (fullscreenButton && this.dashboardFullscreen) fullscreenButton.innerHTML = '<i class="fa-solid fa-compress"></i> Exit full screen';
    if (this._campaignMapEscape) {
      window.removeEventListener("keydown", this._campaignMapEscape);
      this._campaignMapEscape = null;
    }
    if (this._worldMapKeydown) {
      window.removeEventListener("keydown", this._worldMapKeydown);
      this._worldMapKeydown = null;
    }
    clearTimeout(this._worldMapSelectTimer);
    const main = this.element?.querySelector(".ls-main");
    if (main && this.sessionScrollTop) main.scrollTop = this.sessionScrollTop;
    if (main && ["campaign", "campaignMap"].includes(this.activeTab) && this.campaignScrollTop) main.scrollTop = this.campaignScrollTop;
    if (main && this.activeTab === "worldMap" && this.worldMapScrollTop) main.scrollTop = this.worldMapScrollTop;
    if (this.activeTab === "worldMap") {
      for (const field of this.element?.querySelectorAll(".ls-world-panel input, .ls-world-panel textarea, .ls-world-panel select") ?? []) {
        const eventName = field.matches("select") ? "change" : "input";
        field.addEventListener(eventName, () => {
          clearTimeout(this.worldMapSaveTimer);
          const structural = field.matches('[data-world-region-field="parentId"], [data-world-region-field="type"], [data-world-region-field="development"]');
          if (structural) {
            void this.syncWorldMapForm().then(() => this.renderWorldMapPreservingScroll());
            return;
          }
          void this.syncWorldMapForm({ persist: false });
          this.worldMapSaveTimer = setTimeout(() => void this.syncWorldMapForm(), 300);
        });
        field.addEventListener("blur", () => void this.syncWorldMapForm());
      }
      const worldMap = this.element?.querySelector("[data-world-map]");
      const stage = worldMap?.querySelector("[data-world-map-stage]");
      const image = worldMap?.querySelector("[data-world-map-image]");
      if (!worldMap || !stage || !image) return;
      const view = this.worldMap.map.view;
      let operation = null;
      let pointerPreview = null;
      const inverseScale = () => Math.max(0.15, Math.min(1.15, 1 / (Number(view.zoom) || 1)));
      const clampView = () => {
        const viewport = worldMap.getBoundingClientRect();
        const scaledWidth = stage.offsetWidth * view.zoom;
        const scaledHeight = image.offsetHeight * view.zoom;
        view.panX = Math.max(Math.min(0, viewport.width - scaledWidth), Math.min(0, Number(view.panX) || 0));
        view.panY = Math.max(Math.min(0, viewport.height - scaledHeight), Math.min(0, Number(view.panY) || 0));
      };
      const applyView = () => {
        clampView();
        stage.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
        for (const element of stage.querySelectorAll("[data-world-region-label], [data-world-region-vertex], [data-world-map-point]")) {
          element.style.setProperty("--world-marker-scale", inverseScale());
        }
      };
      const point = (event, clamp = false) => {
        const rect = image.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const raw = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
        if (!clamp && (raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1)) return null;
        return { x: clampWorldCoordinate(raw.x), y: clampWorldCoordinate(raw.y) };
      };
      const regionForElement = (element) => this.worldMap.regions.find((region) => region.id === element?.dataset?.worldRegionId);
      const polygonElement = (id) => stage.querySelector(`polygon[data-world-region-id="${id}"]`);
      const updatePolygonDom = (region) => {
        const points = region.vertices.map((vertex) => `${(vertex.x * 1000).toFixed(2)},${(vertex.y * 1000).toFixed(2)}`).join(" ");
        polygonElement(region.id)?.setAttribute("points", points);
        const centroid = worldPolygonLabelPoint(region.vertices);
        const label = stage.querySelector(`[data-world-region-label="${region.id}"]`);
        if (label) { label.style.left = `${centroid.x * 100}%`; label.style.top = `${centroid.y * 100}%`; }
      };
      const updateDraftDom = (preview = null) => {
        const vertices = preview ? [...this.worldMap.draftVertices, preview] : this.worldMap.draftVertices;
        stage.querySelector("[data-world-region-draft]")?.setAttribute("points", vertices.map((vertex) => `${(vertex.x * 1000).toFixed(2)},${(vertex.y * 1000).toFixed(2)}`).join(" "));
      };
      const selectRegion = (region, { render = true } = {}) => {
        this.worldMap.selectedRegionId = region?.id ?? "";
        for (const polygon of stage.querySelectorAll("[data-world-region-id]")) polygon.classList.toggle("selected", polygon.dataset.worldRegionId === region?.id);
        this.writeWorldMapRecoverySnapshot();
        if (render) void this.renderWorldMapPreservingScroll();
      };
      const finishDraft = async () => {
        const vertices = normalizeWorldVertices(this.worldMap.draftVertices);
        if (vertices.length < 3) return ui.notifications.warn("A region needs at least three corners.");
        if (worldPolygonArea(vertices) < 0.0001) return ui.notifications.warn("This region is too small or has no usable area.");
        if (worldPolygonSelfIntersects(vertices)) return ui.notifications.warn("The region boundary crosses itself. Move or remove a corner before closing it.");
        const region = { ...newWorldRegion(), vertices };
        const possibleParents = this.worldMap.regions.filter((candidate) => worldRegionContainsRegion(candidate, region))
          .sort((left, right) => worldPolygonArea(left.vertices) - worldPolygonArea(right.vertices));
        region.parentId = possibleParents[0]?.id ?? "";
        this.worldMap.regions.push(region);
        this.worldMap.selectedRegionId = region.id;
        this.worldMap.draftVertices = [];
        this.worldMapTool = "";
        await this.saveWorldMapDraft();
        await this.renderWorldMapPreservingScroll();
      };
      applyView();
      if (!image.complete) image.addEventListener("load", applyView, { once: true });
      worldMap.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = worldMap.getBoundingClientRect();
        const cursorX = event.clientX - rect.left; const cursorY = event.clientY - rect.top;
        const oldZoom = view.zoom; const nextZoom = Math.max(1, Math.min(6, oldZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const localX = (cursorX - view.panX) / oldZoom; const localY = (cursorY - view.panY) / oldZoom;
        view.zoom = nextZoom; view.panX = cursorX - localX * nextZoom; view.panY = cursorY - localY * nextZoom;
        applyView(); this.writeWorldMapRecoverySnapshot();
        clearTimeout(this.worldMapSaveTimer); this.worldMapSaveTimer = setTimeout(() => void this.saveWorldMapDraft(), 250);
      }, { passive: false });
      worldMap.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });
      worldMap.addEventListener("pointerdown", (event) => {
        const handle = event.target.closest?.("[data-world-region-vertex]");
        const polygon = event.target.closest?.("[data-world-region-id]");
        if (event.button === 1) {
          event.preventDefault(); operation = { kind: "pan", x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
          worldMap.classList.add("panning"); worldMap.setPointerCapture?.(event.pointerId); return;
        }
        if (event.button !== 0 || this.worldMapTool === "draw") return;
        if (handle) {
          const region = regionForElement(handle); const vertexIndex = Number(handle.dataset.worldRegionVertex);
          if (!region || !Number.isInteger(vertexIndex)) return;
          operation = { kind: "vertex", region, vertexIndex, originalVertices: foundry.utils.deepClone(region.vertices) };
          worldMap.setPointerCapture?.(event.pointerId); event.preventDefault(); return;
        }
        if (polygon) {
          const region = regionForElement(polygon);
          if (!region) return;
          clearTimeout(this._worldMapSelectTimer);
          this._worldMapSelectTimer = setTimeout(() => selectRegion(region), 550);
        }
      });
      worldMap.addEventListener("pointermove", (event) => {
        if (operation?.kind === "pan") {
          view.panX = operation.panX + event.clientX - operation.x; view.panY = operation.panY + event.clientY - operation.y;
          applyView(); return;
        }
        if (operation?.kind === "vertex") {
          const next = point(event, true); if (!next) return;
          operation.region.vertices[operation.vertexIndex] = next;
          const handle = stage.querySelector(`[data-world-region-id="${operation.region.id}"][data-world-region-vertex="${operation.vertexIndex}"]`);
          if (handle) { handle.style.left = `${next.x * 100}%`; handle.style.top = `${next.y * 100}%`; }
          updatePolygonDom(operation.region); return;
        }
        if (this.worldMapTool === "draw") {
          pointerPreview = point(event); updateDraftDom(pointerPreview);
        }
      });
      worldMap.addEventListener("pointerup", async () => {
        if (!operation) return;
        const completed = operation; operation = null; worldMap.classList.remove("panning");
        if (completed.kind === "vertex") {
          const vertices = normalizeWorldVertices(completed.region.vertices);
          if (vertices.length < 3 || worldPolygonArea(vertices) < 0.0001 || worldPolygonSelfIntersects(vertices)) {
            completed.region.vertices = completed.originalVertices;
            ui.notifications.warn("That edit would create an invalid or self-crossing boundary, so it was undone.");
          } else {
            completed.region.vertices = vertices;
            const parent = this.worldMap.regions.find((candidate) => candidate.id === completed.region.parentId);
            if (parent && !worldRegionContainsRegion(parent, completed.region)) {
              completed.region.parentId = "";
              ui.notifications.warn(`${completed.region.name || "The region"} no longer fits inside its parent and was detached.`);
            }
            for (const child of this.worldMap.regions.filter((candidate) => candidate.parentId === completed.region.id)) {
              if (!worldRegionContainsRegion(completed.region, child)) child.parentId = "";
            }
          }
        }
        this.writeWorldMapRecoverySnapshot();
        await this.saveWorldMapDraft();
        if (completed.kind === "vertex") await this.renderWorldMapPreservingScroll();
      });
      const cancelOperation = () => {
        if (operation?.kind === "vertex") {
          operation.region.vertices = operation.originalVertices;
          updatePolygonDom(operation.region);
        }
        if (operation?.kind === "pan") { view.panX = operation.panX; view.panY = operation.panY; }
        operation = null; worldMap.classList.remove("panning"); applyView();
      };
      worldMap.addEventListener("pointercancel", cancelOperation);
      worldMap.addEventListener("lostpointercapture", cancelOperation);
      worldMap.addEventListener("contextmenu", (event) => {
        const region = regionForElement(event.target.closest?.("[data-world-region-id]"));
        if (!region || this.worldMapTool === "draw") return;
        event.preventDefault(); selectRegion(region);
      });
      worldMap.addEventListener("click", (event) => {
        if (this.worldMapTool !== "draw" || event.detail > 1 || event.target.closest?.("button, input, textarea, select")) return;
        const next = point(event); if (!next) return;
        this.worldMap.draftVertices.push(next); pointerPreview = null; updateDraftDom(); this.writeWorldMapRecoverySnapshot();
        clearTimeout(this.worldMapSaveTimer); this.worldMapSaveTimer = setTimeout(() => void this.saveWorldMapDraft(), 220);
      });
      worldMap.addEventListener("dblclick", async (event) => {
        event.preventDefault(); event.stopPropagation(); clearTimeout(this._worldMapSelectTimer);
        if (this.worldMapTool === "draw") { await finishDraft(); return; }
        if (event.target.closest?.("[data-world-region-vertex]")) return;
        const polygon = event.target.closest?.("[data-world-region-id]");
        const region = regionForElement(polygon);
        if (!region) return;
        await this.openOrCreateWorldRegionJournal(region, { sync: !game.journal.get(region.journalId) });
      });
      this._worldMapKeydown = (event) => {
        if (this.activeTab !== "worldMap" || this.worldMapTool !== "draw") return;
        if (event.target?.matches?.("input, textarea, select, [contenteditable='true']")) return;
        if (event.key === "Escape") {
          event.preventDefault(); this.worldMap.draftVertices = []; this.worldMapTool = ""; this.writeWorldMapRecoverySnapshot(); void this.saveWorldMapDraft().then(() => this.renderWorldMapPreservingScroll());
        } else if (event.key === "Backspace") {
          event.preventDefault(); this.worldMap.draftVertices.pop(); updateDraftDom(pointerPreview); this.writeWorldMapRecoverySnapshot();
          clearTimeout(this.worldMapSaveTimer); this.worldMapSaveTimer = setTimeout(() => void this.saveWorldMapDraft(), 150);
        } else if (event.key === "Enter") {
          event.preventDefault(); void finishDraft();
        }
      };
      window.addEventListener("keydown", this._worldMapKeydown);
      return;
    }
    if (["campaign", "campaignMap"].includes(this.activeTab)) {
      const campaignPanel = this.element?.querySelector(".ls-campaign-panel");
      const syncLiveCampaignState = async (event) => {
        if (!event.target?.matches?.("input, textarea, select")) return;
        await this.syncCampaignForm({ persist: false });
        this.refreshCampaignActValidation();
        clearTimeout(this.campaignSaveTimer);
        this.campaignSaveTimer = setTimeout(() => void this.syncCampaignForm(), 300);
      };
      campaignPanel?.addEventListener("input", syncLiveCampaignState);
      campaignPanel?.addEventListener("change", syncLiveCampaignState);
      campaignPanel?.addEventListener("focusout", async (event) => {
        if (!event.target?.matches?.("input, textarea, select")) return;
        clearTimeout(this.campaignSaveTimer);
        await this.syncCampaignForm();
        this.refreshCampaignActValidation();
      });
      for (const select of this.element?.querySelectorAll('[name="campaignLength"], [name="campaignSessionCount"], [name="campaignStartLocation"], [data-campaign-act-field="estimatedSessions"]') ?? []) {
        select.addEventListener("change", async () => {
          await this.syncCampaignForm();
          await this.renderCampaignPreservingScroll();
        });
      }
      if (this.activeTab === "campaign") {
        for (const zone of this.element?.querySelectorAll("[data-campaign-act-drop]") ?? []) {
          zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
          zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
          zone.addEventListener("drop", (event) => void this.handleCampaignActDrop(event, zone));
        }
      }
      const campaignMap = this.activeTab === "campaignMap" ? this.element?.querySelector("[data-campaign-map]") : null;
      if (campaignMap) {
        const stage = campaignMap.querySelector("[data-campaign-map-stage]");
        const image = campaignMap.querySelector("[data-campaign-map-image]");
        if (!stage || !image) return;
        let focusDrawing = false;
        let markerDrag = null;
        let panDrag = null;
        let movedMarker = false;
        const view = this.campaign.map.view;
        const markerScale = () => Math.max(0.55, Math.min(1.35, 1 / (Number(view.zoom) || 1)));
        const applyView = () => {
          stage.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
          for (const marker of stage.querySelectorAll("[data-campaign-marker-id]")) marker.style.setProperty("--marker-scale", markerScale());
        };
        const point = (event) => {
          const rect = image.getBoundingClientRect();
          return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
        };
        const focusAnchor = () => {
          const selected = this.campaign.locations.find((entry) => entry.id === this.campaign.map.startLocationId);
          if (!selected || !Number.isFinite(Number.parseFloat(selected.x)) || !Number.isFinite(Number.parseFloat(selected.y))) return null;
          return { x: Number(selected.x), y: Number(selected.y) };
        };
        const closePointEditor = () => campaignMap.querySelector(".ls-map-point-editor")?.remove();
        const openPointEditor = (location, marker, clientX = null, clientY = null) => {
          closePointEditor();
          const mapRect = campaignMap.getBoundingClientRect();
          const markerRect = marker.getBoundingClientRect();
          const left = Math.max(8, Math.min(mapRect.width - 230, (clientX ?? markerRect.left) - mapRect.left + 10));
          const top = Math.max(8, Math.min(mapRect.height - 250, (clientY ?? markerRect.bottom) - mapRect.top + 8));
          const editor = document.createElement("div");
          editor.className = "ls-map-point-editor";
          editor.style.left = `${left}px`; editor.style.top = `${top}px`;
          for (const eventName of ["pointerdown", "pointerup", "click", "contextmenu"]) {
            editor.addEventListener(eventName, (event) => event.stopPropagation());
          }
          editor.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
          const showNameEditor = () => {
            editor.innerHTML = `<strong>${CAMPAIGN_POINT_TYPES[location.type] ?? "Point"}</strong><label>Name<input type="text" value="${escapeHtml(location.name)}" placeholder="Name this place"></label><div><button type="button" data-save-name><i class="fa-solid fa-check"></i> Save</button><button type="button" data-delete-point class="danger"><i class="fa-solid fa-trash"></i></button></div>`;
            const input = editor.querySelector("input");
            input.addEventListener("input", () => {
              location.name = input.value;
              const label = marker.querySelector("span");
              if (label) label.textContent = location.name.trim() || "Unnamed point";
              this.writeCampaignRecoverySnapshot();
              clearTimeout(this.campaignSaveTimer);
              this.campaignSaveTimer = setTimeout(() => void this.saveCampaignDraft(), 200);
            });
            input.addEventListener("blur", () => void this.saveCampaignDraft());
            const save = async () => {
              location.name = input.value.trim();
              await this.saveCampaignDraft();
              await this.renderCampaignPreservingScroll();
            };
            editor.querySelector("[data-save-name]")?.addEventListener("click", () => void save());
            input.addEventListener("keydown", (event) => {
              if (event.key === "Enter") { event.preventDefault(); void save(); }
              if (event.key === "Escape") closePointEditor();
            });
            const deleteButton = editor.querySelector("[data-delete-point]");
            deleteButton?.addEventListener("pointerdown", (event) => event.preventDefault());
            deleteButton?.addEventListener("click", async () => {
              clearTimeout(this.campaignSaveTimer);
              this.campaignDeletedLocationIds.add(location.id);
              this.campaign.locations = this.campaign.locations.filter((entry) => entry.id !== location.id);
              if (this.mapCampaign !== this.campaign) this.mapCampaign.locations = this.mapCampaign.locations.filter((entry) => entry.id !== location.id);
              this.campaign.routes = this.campaign.routes.filter((entry) => entry.fromId !== location.id && entry.toId !== location.id);
              if (this.campaign.map.startLocationId === location.id) this.campaign.map.startLocationId = "";
              marker.remove();
              closePointEditor();
              this.writeCampaignRecoverySnapshot();
              await this.saveCampaignDraft(); await this.renderCampaignPreservingScroll();
            });
            input.focus(); input.select();
          };
          editor.innerHTML = `<strong>Choose point type</strong><div class="ls-map-point-types">${Object.entries(CAMPAIGN_POINT_TYPES).map(([value, label]) => `<button type="button" data-point-type="${value}"><i class="fa-solid ${CAMPAIGN_POINT_ICONS[value] ?? CAMPAIGN_POINT_ICONS.custom}"></i> ${label}</button>`).join("")}</div><button type="button" data-close-point><i class="fa-solid fa-xmark"></i> Cancel</button>`;
          campaignMap.append(editor);
          editor.querySelector("[data-close-point]")?.addEventListener("click", closePointEditor);
          for (const button of editor.querySelectorAll("[data-point-type]")) button.addEventListener("click", async () => {
            location.type = button.dataset.pointType;
            const icon = marker.querySelector("i");
            if (icon) icon.className = `fa-solid ${CAMPAIGN_POINT_ICONS[location.type] ?? CAMPAIGN_POINT_ICONS.custom}`;
            await this.saveCampaignDraft();
            showNameEditor();
          });
        };
        campaignMap.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.target.closest(".ls-map-point-editor")) return;
          const existingMarker = event.target.closest("[data-campaign-marker-id]");
          if (existingMarker) {
            const location = this.campaign.locations.find((entry) => entry.id === existingMarker.dataset.campaignMarkerId);
            if (location) openPointEditor(location, existingMarker, event.clientX, event.clientY);
            return;
          }
          const position = point(event);
          const location = { ...newCampaignLocation(), x: position.x, y: position.y };
          this.campaign.locations.push(location);
          const marker = document.createElement("button");
          marker.type = "button";
          marker.dataset.action = "selectCampaignMarker";
          marker.dataset.id = location.id;
          marker.dataset.campaignMarkerId = location.id;
          marker.className = "ls-map-marker outside";
          marker.style.left = `${position.x * 100}%`;
          marker.style.top = `${position.y * 100}%`;
          marker.style.setProperty("--marker-scale", markerScale());
          marker.title = "Left-drag to move; right-click to edit";
          marker.innerHTML = `<i class="fa-solid ${CAMPAIGN_POINT_ICONS.custom}"></i><span>Unnamed point</span>`;
          stage.append(marker);
          this.writeCampaignRecoverySnapshot();
          void this.saveCampaignDraft();
          openPointEditor(location, marker, event.clientX, event.clientY);
        });
        campaignMap.addEventListener("auxclick", (event) => {
          if (event.button === 1) event.preventDefault();
        });
        campaignMap.addEventListener("wheel", (event) => {
          if (event.target.closest(".ls-map-point-editor")) return;
          event.preventDefault();
          const rect = campaignMap.getBoundingClientRect();
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          const oldZoom = view.zoom;
          const nextZoom = Math.max(1, Math.min(5, oldZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
          const localX = (cursorX - view.panX) / oldZoom;
          const localY = (cursorY - view.panY) / oldZoom;
          view.zoom = nextZoom;
          view.panX = cursorX - localX * nextZoom;
          view.panY = cursorY - localY * nextZoom;
          if (nextZoom === 1) { view.panX = 0; view.panY = 0; }
          applyView();
          clearTimeout(this.campaignSaveTimer);
          this.campaignSaveTimer = setTimeout(() => void this.saveCampaignDraft(), 250);
        }, { passive: false });
        campaignMap.addEventListener("pointerdown", (event) => {
          const marker = event.target.closest("[data-campaign-marker-id]");
          if (event.button === 1) {
            event.preventDefault();
            closePointEditor();
            panDrag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
            campaignMap.classList.add("panning");
            campaignMap.setPointerCapture?.(event.pointerId);
            return;
          }
          if (event.button !== 0) return;
          if (!event.target.closest(".ls-map-point-editor")) closePointEditor();
          if (marker) {
            const location = this.campaign.locations.find((entry) => entry.id === marker.dataset.campaignMarkerId);
            if (!location) return;
            markerDrag = { location, startX: event.clientX, startY: event.clientY };
            movedMarker = false;
            campaignMap.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
          }
          if (marker || this.campaignMapTool !== "focus") return;
          if (!focusAnchor()) {
            ui.notifications.warn("Choose a starting point before drawing the starting area.");
            return;
          }
          focusDrawing = true;
          campaignMap.setPointerCapture?.(event.pointerId);
        });
        campaignMap.addEventListener("pointermove", (event) => {
          if (panDrag) {
            view.panX = panDrag.panX + event.clientX - panDrag.x;
            view.panY = panDrag.panY + event.clientY - panDrag.y;
            applyView();
            return;
          }
          if (markerDrag) {
            const position = point(event);
            markerDrag.location.x = position.x;
            markerDrag.location.y = position.y;
            movedMarker ||= Math.hypot(event.clientX - markerDrag.startX, event.clientY - markerDrag.startY) > 3;
            const marker = stage.querySelector(`[data-campaign-marker-id="${markerDrag.location.id}"]`);
            if (marker) { marker.style.left = `${position.x * 100}%`; marker.style.top = `${position.y * 100}%`; }
            if (this.campaign.map.startLocationId === markerDrag.location.id) {
              this.campaign.map.focus.x = position.x;
              this.campaign.map.focus.y = position.y;
              const circle = stage.querySelector(".ls-map-focus-circle");
              if (circle) { circle.style.left = `${position.x * 100}%`; circle.style.top = `${position.y * 100}%`; }
            }
            return;
          }
          if (!focusDrawing) return;
          const anchor = focusAnchor();
          if (!anchor) return;
          const current = point(event);
          const rect = image.getBoundingClientRect();
          const aspect = Math.max(0.1, rect.width / rect.height);
          const radius = Math.min(1, Math.hypot(current.x - anchor.x, (current.y - anchor.y) / aspect));
          const circle = stage.querySelector(".ls-map-focus-circle");
          if (circle) {
            circle.style.left = `${anchor.x * 100}%`; circle.style.top = `${anchor.y * 100}%`;
            circle.style.width = `${radius * 200}%`; circle.style.height = `${radius * 200 * aspect}%`;
          }
        });
        campaignMap.addEventListener("pointerup", async (event) => {
          if (event.target.closest(".ls-map-point-editor")) return;
          if (panDrag) {
            panDrag = null;
            campaignMap.classList.remove("panning");
            await this.saveCampaignDraft();
            return;
          }
          if (markerDrag) {
            const location = markerDrag.location;
            markerDrag = null;
            this._campaignMarkerWasDragged = movedMarker;
            if (!movedMarker) {
              this.campaign.map.startLocationId = location.id;
              this.campaign.map.focus.x = Number(location.x);
              this.campaign.map.focus.y = Number(location.y);
            }
            await this.saveCampaignDraft();
            await this.renderCampaignPreservingScroll();
            return;
          }
          if (focusDrawing) {
            const anchor = focusAnchor();
            focusDrawing = false;
            if (!anchor) return;
            const current = point(event);
            const rect = image.getBoundingClientRect();
            const aspect = Math.max(0.1, rect.width / rect.height);
            const radius = Math.max(0.02, Math.min(1, Math.hypot(current.x - anchor.x, (current.y - anchor.y) / aspect)));
            this.campaign.map.focus = { x: anchor.x, y: anchor.y, radius, aspect };
            this.campaignMapTool = "";
            await this.saveCampaignDraft(); await this.renderCampaignPreservingScroll();
            return;
          }
          // Points are created with right-click; an ordinary left-click never creates one.
        });
        campaignMap.addEventListener("pointercancel", () => { focusDrawing = false; markerDrag = null; panDrag = null; campaignMap.classList.remove("panning"); });
        this._campaignMapEscape = (event) => {
          if (event.key !== "Escape" || !this.campaignMapTool) return;
          this.campaignMapTool = "";
          void this.renderCampaignPreservingScroll();
        };
        window.addEventListener("keydown", this._campaignMapEscape);
      }
      return;
    }
    if (this.activeTab === "session") {
      for (const field of this.element?.querySelectorAll(".ls-session-panel input, .ls-session-panel textarea, .ls-session-panel select") ?? []) {
        const eventName = field.matches("select") ? "change" : "input";
        field.addEventListener(eventName, () => {
          clearTimeout(this.sessionSaveTimer);
          this.sessionSaveTimer = setTimeout(() => void this.syncSessionPrepForm(), 350);
        });
      }
      for (const select of this.element?.querySelectorAll('[name="musicPlaylist"], [name="encounterType"]') ?? []) {
        select.addEventListener("change", async () => {
          await this.syncSessionPrepForm();
          if (select.name === "musicPlaylist") {
            const card = select.closest("[data-session-music-id]");
            const cue = this.sessionPrep.musicCues.find((entry) => entry.id === card?.dataset.sessionMusicId);
            if (cue) cue.soundId = "";
          }
          await this.renderSessionPreservingScroll();
        });
      }
      for (const zone of this.element?.querySelectorAll("[data-session-drop-kind]") ?? []) {
        zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("dragover"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
        zone.addEventListener("drop", (event) => void this.handleSessionDrop(event, zone));
      }
      return;
    }
    if (this.activeTab === "loot") {
      for (const select of this.element?.querySelectorAll('[name="lootFilterMechanic"]') ?? []) {
        select.addEventListener("change", async () => {
          this.syncLootForm();
          await this.render();
        });
      }
      return;
    }
    if (this.activeTab !== "notes") return;
    const editor = this.element?.querySelector('[data-role="note-editor"]');
    const title = this.element?.querySelector('[data-role="note-title"]');
    activateWikiLinks(editor);
    const scheduleSave = () => {
      window.clearTimeout(this._noteSaveTimer);
      this._noteSaveTimer = window.setTimeout(() => this.saveActiveNote(), 350);
    };
    editor?.addEventListener("input", () => {
      activateWikiLinks(editor);
      scheduleSave();
    });
    editor?.addEventListener("keydown", (event) => {
      if (event.key === "[" && insertCompletedWikiPair()) {
        event.preventDefault();
        scheduleSave();
      }
    });
    editor?.addEventListener("click", (event) => {
      const link = event.target.closest?.(".ls-wiki-link");
      if (!link) return;
      event.preventDefault();
      if (event.detail > 1) return;
      window.clearTimeout(this._wikiClickTimer);
      this._wikiClickTimer = window.setTimeout(() => this.openOrCreateLinkedNote(link.dataset.noteName), 240);
    });
    editor?.addEventListener("dblclick", (event) => {
      const link = event.target.closest?.(".ls-wiki-link");
      if (!link) return;
      event.preventDefault();
      window.clearTimeout(this._wikiClickTimer);
      const text = document.createTextNode(`[[${link.dataset.noteName}]]`);
      link.replaceWith(text);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      editor.focus();
    });
    title?.addEventListener("input", scheduleSave);
    title?.addEventListener("change", () => this.saveActiveNote());
  }

  async saveActiveNote() {
    const journal = await this.getNotebook(false);
    const page = journal?.pages?.get(this.activeNoteId);
    if (!journal || !page) return;
    const title = this.element?.querySelector('[data-role="note-title"]')?.value.trim() || "Untitled Note";
    const content = this.element?.querySelector('[data-role="note-editor"]')?.innerHTML ?? "";
    if (page.name !== title || page.text?.content !== content) {
      await page.update({ name: title, "text.content": content });
    }
  }

  async openOrCreateLinkedNote(name) {
    const noteName = String(name ?? "").trim();
    if (!noteName) return;
    await this.saveActiveNote();
    const journal = await this.getNotebook(true);
    let page = journal.pages.find((candidate) =>
      candidate.name.localeCompare(noteName, undefined, { sensitivity: "accent" }) === 0);
    if (!page) {
      [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: noteName,
        type: "text",
        text: { content: "" },
        sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
      }]);
      ui.notifications.info(`Created page "${noteName}" inside ${journal.name}.`);
    }
    this.activeNoteId = page.id;
    await this.render();
  }


  async renderSessionPreservingScroll() {
    this.sessionScrollTop = this.element?.querySelector(".ls-main")?.scrollTop ?? this.sessionScrollTop;
    await this.render();
  }

  async handleSessionDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("dragover");
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch { return; }
    const uuid = data.uuid || (data.type && data.id ? `${data.type}.${data.id}` : "");
    const document = uuid ? await fromUuid(uuid) : null;
    if (!document) return ui.notifications.warn("Lore Smith could not read that dropped Foundry document.");
    const kind = zone.dataset.sessionDropKind;
    if (kind === "hazard" && (document.documentName !== "Actor" || document.type !== "hazard")) return ui.notifications.warn("Drop a PF2e Hazard actor here.");
    if (kind === "encounter" && document.documentName !== "Actor") return ui.notifications.warn("Drop a PF2e Actor here.");
    if (kind === "reward" && document.documentName !== "Item") return ui.notifications.warn("Drop a PF2e Item here.");
    const reference = normalizeSessionReference({ uuid: document.uuid, name: document.name, img: document.img, type: document.type });
    if (kind === "hazard") {
      // Each drop is an encounter instance. The same compendium hazard can therefore
      // appear more than once while retaining a unique local id for individual removal.
      this.sessionPrep.hazards.push(reference);
    } else if (kind === "reward") {
      if (!(this.sessionPrep.rewardItems ?? []).some((entry) => entry.uuid === reference.uuid)) this.sessionPrep.rewardItems.push(reference);
    } else {
      const encounter = this.sessionPrep.encounterEntries.find((entry) => entry.id === zone.dataset.parentId);
      // Do not deduplicate by source UUID: two drops of one bestiary actor represent
      // two separate combatants, and their generated reference ids remain distinct.
      if (encounter) encounter.actors.push(reference);
    }
    await this.saveSessionPrepDraft();
    await this.renderSessionPreservingScroll();
  }

  async handleCampaignActDrop(event, zone) {
    event.preventDefault();
    zone.classList.remove("dragover");
    await this.syncCampaignForm();
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch { return; }
    const uuid = data.uuid || (data.type && data.id ? `${data.type}.${data.id}` : "");
    const document = uuid ? await fromUuid(uuid) : null;
    if (!document) return ui.notifications.warn("Lore Smith could not read that dropped Foundry document.");
    const act = this.campaign.acts.find((entry) => entry.id === zone.dataset.campaignActId);
    const kind = zone.dataset.campaignActDrop;
    if (!act) return;
    if (kind === "actors" && document.documentName !== "Actor") return ui.notifications.warn("Drop a PF2e Actor here.");
    if (kind === "items" && document.documentName !== "Item") return ui.notifications.warn("Drop a PF2e Item here.");
    if (kind === "journals" && !["JournalEntry", "JournalEntryPage", "Scene"].includes(document.documentName)) {
      return ui.notifications.warn("Drop a Foundry Journal, Journal page, or Scene here.");
    }
    const property = { actors: "actorRefs", items: "itemRefs", journals: "journalRefs" }[kind];
    if (!property) return;
    act[property].push(normalizeSessionReference({ uuid: document.uuid, name: document.name, img: document.img, type: document.type || document.documentName }));
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  async saveSessionPrepDraft() {
    await game.settings.set(MODULE_ID, "sessionPrepDraft", JSON.stringify({ step: this.sessionStep, prep: this.sessionPrep }));
    await this.syncLinkedCampaignSession();
  }

  async syncLinkedCampaignSession({ journalId = undefined } = {}) {
    const link = this.sessionPrep.campaignLink;
    if (!link) return;
    ensureCampaignActs(this.adventureCampaign);
    const act = this.adventureCampaign.acts.find((entry) => entry.id === link.actId);
    const chapter = act?.chapters.find((entry) => entry.id === link.chapterId);
    const session = chapter?.sessions.find((entry) => entry.id === link.sessionId);
    if (!session) return;
    session.prep = foundry.utils.deepClone(this.sessionPrep);
    if (journalId !== undefined) session.journalId = String(journalId ?? "");
    if (!session.title.trim() && this.sessionPrep.title.trim()) session.title = this.sessionPrep.title.trim();
    if (!session.purpose.trim() && this.sessionPrep.goal.trim()) session.purpose = this.sessionPrep.goal.trim();
    await game.settings.set(MODULE_ID, "campaignBuilderDraft", JSON.stringify({
      step: this.adventureCampaignStep,
      campaign: this.adventureCampaign,
    }));
  }

  async syncSessionPrepForm() {
    const root = this.element;
    if (!root || this.activeTab !== "session") return;
    const visibleFields = {
      title: "sessionTitle", goal: "sessionGoal", opening: "sessionOpening", ending: "sessionEnding",
      reminders: "sessionReminders",
    };
    for (const [property, name] of Object.entries(visibleFields)) {
      const field = root.querySelector(`[name="${name}"]`);
      if (field) this.sessionPrep[property] = field.value.trim();
    }
    const previous = new Map(this.sessionPrep.locations.map((location) => [location.id, location]));
    const cards = [...root.querySelectorAll("[data-location-id]")];
    if (cards.length) this.sessionPrep.locations = cards.map((card) => {
      const id = card.dataset.locationId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previous.get(id), id, name: field("locationName"), image: field("locationImage"), purpose: field("locationPurpose"), sight: field("locationSight"), hearing: field("locationHearing"), smell: field("locationSmell"), touch: field("locationTouch"), taste: field("locationTaste") };
    });
    const previousNpcs = new Map((this.sessionPrep.npcs ?? []).map((npc) => [npc.id, npc]));
    const npcCards = [...root.querySelectorAll("[data-session-npc-id]")];
    if (npcCards.length) this.sessionPrep.npcs = npcCards.map((card) => {
      const id = card.dataset.sessionNpcId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previousNpcs.get(id), id, name: field("npcName"), image: field("npcImage"), role: field("npcRole"), motivation: field("npcMotivation"), secret: field("npcSecret") };
    });
    const previousMusicCues = new Map((this.sessionPrep.musicCues ?? []).map((cue) => [cue.id, cue]));
    const musicCards = [...root.querySelectorAll("[data-session-music-id]")];
    if (musicCards.length) this.sessionPrep.musicCues = musicCards.map((card) => {
      const id = card.dataset.sessionMusicId;
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...previousMusicCues.get(id), id, name: field("musicName"), moment: field("musicMoment"), mood: field("musicMood"), playlistId: field("musicPlaylist"), soundId: field("musicSound"), audio: field("musicAudio"), notes: field("musicNotes") };
    });
    const peopleCards = [...root.querySelectorAll("[data-people-entry-id]")];
    if (peopleCards.length) this.sessionPrep.peopleEntries = peopleCards.map((card) => ({
      id: card.dataset.peopleEntryId,
      name: card.querySelector('[name="peopleName"]')?.value.trim() ?? "",
      description: card.querySelector('[name="peopleDescription"]')?.value.trim() ?? "",
    }));
    const encounterCards = [...root.querySelectorAll("[data-session-encounter-id]")];
    if (encounterCards.length) {
      const existing = new Map(this.sessionPrep.encounterEntries.map((entry) => [entry.id, entry]));
      this.sessionPrep.encounterEntries = encounterCards.map((card) => ({
        ...existing.get(card.dataset.sessionEncounterId), id: card.dataset.sessionEncounterId,
        type: card.querySelector('[name="encounterType"]')?.value ?? "social",
        description: card.querySelector('[name="encounterDescription"]')?.value.trim() ?? "",
      }));
    }
    const textCollections = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" };
    for (const [kind, property] of Object.entries(textCollections)) {
      const entries = [...root.querySelectorAll(`[data-session-text-kind="${kind}"]`)].map((card) => ({
        id: card.dataset.sessionTextId, text: card.querySelector("input, textarea")?.value.trim() ?? "",
      }));
      if (entries.length) this.sessionPrep[property] = entries;
    }
    await this.saveSessionPrepDraft();
  }

  writeWorldMapRecoverySnapshot() {
    const serialized = JSON.stringify({
      worldMap: foundry.utils.deepClone(this.worldMap),
      updatedAt: Date.now(),
      revision: ++this.worldMapSaveRevision,
    });
    writeWorldMapRecovery(serialized);
    return serialized;
  }

  async saveWorldMapDraft() {
    this.worldMap.updatedAt = Date.now();
    // Serialize a normalized snapshot without replacing the live object graph.
    // Map gestures and vertex drags deliberately retain references into that graph.
    const snapshot = normalizeWorldMapBuild(foundry.utils.deepClone(this.worldMap));
    snapshot.updatedAt = this.worldMap.updatedAt;
    const serialized = JSON.stringify({
      worldMap: snapshot,
      updatedAt: this.worldMap.updatedAt,
      revision: ++this.worldMapSaveRevision,
    });
    writeWorldMapRecovery(serialized);
    const persist = async () => {
      try {
        await game.settings.set(MODULE_ID, "worldMapBuilderDraft", serialized);
      } catch (error) {
        console.warn("Lore Smith | The emergency world-map recovery copy was saved, but the browser setting could not be updated.", error);
      }
      if (!game.user?.isGM) return;
      try {
        await game.settings.set(MODULE_ID, "worldMapBuilderWorldDraft", serialized);
      } catch (error) {
        console.warn("Lore Smith | The world map was saved locally, but the shared world copy could not be updated.", error);
      }
    };
    this.worldMapSavePromise = this.worldMapSavePromise.then(persist, persist);
    await this.worldMapSavePromise;
  }

  async renderWorldMapPreservingScroll() {
    this.worldMapScrollTop = this.element?.querySelector(".ls-main")?.scrollTop ?? this.worldMapScrollTop;
    await this.render();
  }

  async syncWorldMapForm({ persist = true } = {}) {
    const root = this.element;
    if (!root || this.activeTab !== "worldMap") return;
    const worldName = root.querySelector('[name="worldMapName"]')?.value;
    if (worldName !== undefined) this.worldMap.name = worldName.trim();
    const editor = root.querySelector("[data-world-region-editor]");
    const region = this.worldMap.regions.find((entry) => entry.id === editor?.dataset?.worldRegionEditor);
    if (region && editor) {
      const value = (field) => editor.querySelector(`[data-world-region-field="${field}"]`)?.value;
      for (const property of ["name", "type", "parentId", "development", "color", "summary", "terrain", "climate", "inhabitants", "authority", "culture", "resources", "factions", "currentSituation", "dangers", "hooks", "travel"]) {
        const next = value(property);
        if (next !== undefined) region[property] = typeof next === "string" ? next.trim() : next;
      }
      const opacity = Number(value("opacity"));
      if (Number.isFinite(opacity)) region.opacity = Math.max(0.08, Math.min(0.72, opacity));
      if (!WORLD_REGION_TYPES[region.type]) region.type = "other";
      if (region.parentId === region.id || !this.worldMap.regions.some((candidate) => candidate.id === region.parentId)) region.parentId = "";
      const label = root.querySelector(`[data-world-region-label="${region.id}"] span`);
      if (label) label.textContent = region.name || "Unnamed region";
      const polygon = root.querySelector(`polygon[data-world-region-id="${region.id}"]`);
      if (polygon) {
        polygon.style.setProperty("--region-color", region.color);
        polygon.style.setProperty("--region-opacity", region.opacity);
      }
    }
    this.writeWorldMapRecoverySnapshot();
    if (persist) await this.saveWorldMapDraft();
  }

  async close(options = {}) {
    clearTimeout(this.campaignSaveTimer);
    clearTimeout(this.worldMapSaveTimer);
    if (["campaign", "campaignMap"].includes(this.activeTab)) await this.syncCampaignForm();
    if (this.activeTab === "worldMap") await this.syncWorldMapForm();
    await this.campaignSavePromise;
    await this.worldMapSavePromise;
    if (this._worldMapKeydown) window.removeEventListener("keydown", this._worldMapKeydown);
    clearTimeout(this._worldMapSelectTimer);
    return super.close(options);
  }

  async saveCampaignDraft() {
    if (this.activeTab === "campaignMap") {
      if (this.campaignDeletedLocationIds.size) {
        this.campaign.locations = this.campaign.locations.filter((entry) => !this.campaignDeletedLocationIds.has(entry.id));
        this.campaign.routes = this.campaign.routes.filter((entry) => !this.campaignDeletedLocationIds.has(entry.fromId) && !this.campaignDeletedLocationIds.has(entry.toId));
      }
      this.mapCampaign = this.campaign; this.mapCampaignStep = this.campaignStep;
      const serialized = JSON.stringify({
        step: this.campaignStep,
        campaign: foundry.utils.deepClone(this.campaign),
        updatedAt: Date.now(),
        revision: ++this.campaignSaveRevision,
      });
      writeCampaignMapRecovery(serialized);
      const persist = async () => {
        await game.settings.set(MODULE_ID, "campaignMapBuilderDraft", serialized);
        if (!game.user?.isGM) return;
        try {
          await game.settings.set(MODULE_ID, "campaignMapBuilderWorldDraft", serialized);
        } catch (error) {
          console.warn("Lore Smith | The map draft was saved locally, but the shared world copy could not be updated.", error);
        }
      };
      this.campaignSavePromise = this.campaignSavePromise.then(persist, persist);
      await this.campaignSavePromise;
    } else {
      this.adventureCampaign = this.campaign; this.adventureCampaignStep = this.campaignStep;
      const serialized = JSON.stringify({ step: this.campaignStep, campaign: foundry.utils.deepClone(this.campaign) });
      const persist = () => game.settings.set(MODULE_ID, "campaignBuilderDraft", serialized);
      this.campaignSavePromise = this.campaignSavePromise.then(persist, persist);
      await this.campaignSavePromise;
    }
  }

  writeCampaignRecoverySnapshot() {
    if (this.activeTab !== "campaignMap") return;
    this.mapCampaign = this.campaign; this.mapCampaignStep = this.campaignStep;
    writeCampaignMapRecovery(JSON.stringify({
      step: this.campaignStep,
      campaign: foundry.utils.deepClone(this.campaign),
      updatedAt: Date.now(),
      revision: ++this.campaignSaveRevision,
    }));
  }

  async renderCampaignPreservingScroll() {
    this.campaignScrollTop = this.element?.querySelector(".ls-main")?.scrollTop ?? this.campaignScrollTop;
    await this.render({ force: true });
  }

  refreshCampaignActValidation() {
    if (this.activeTab !== "campaign") return;
    const container = this.element?.querySelector("[data-campaign-act-validation]");
    const messages = container?.querySelector("[data-campaign-act-validation-messages]");
    if (!container || !messages) return;
    const act = this.campaign.acts?.[this.campaignStep];
    const missing = act ? campaignActMissingRequirements(this.campaign, act) : [];
    messages.replaceChildren(...missing.map((message) => {
      const row = document.createElement("div");
      row.textContent = message;
      return row;
    }));
    container.hidden = missing.length === 0;
  }

  applyCampaignActStatusToDom(status) {
    if (this.activeTab !== "campaign") return;
    for (const section of this.element?.querySelectorAll("[data-campaign-act-state]") ?? []) {
      section.hidden = section.dataset.campaignActState !== status;
    }
    const labels = { draft: "Draft", ready: "Ready to play", completed: "Completed" };
    const icons = { draft: "fa-pen-ruler", ready: "fa-dice-d20", completed: "fa-circle-check" };
    const label = labels[status] ?? labels.draft;
    const badge = this.element?.querySelector("[data-campaign-act-status-badge]");
    if (badge) {
      badge.classList.remove("draft", "ready", "completed");
      badge.classList.add(status);
      badge.innerHTML = `<i class="fa-solid ${icons[status] ?? icons.draft}"></i> ${label}`;
    }
    const heading = this.element?.querySelector("[data-campaign-act-heading-status]");
    if (heading) heading.textContent = `Act ${heading.dataset.actRoman} · ${label}`;
    const rail = this.element?.querySelector(`[data-campaign-act-nav="${this.campaignStep}"]`);
    if (rail) {
      rail.classList.toggle("ready", status === "ready");
      rail.classList.toggle("completed", status === "completed");
      const railStatus = rail.querySelector("em");
      if (railStatus) railStatus.textContent = label;
    }
  }

  async syncCampaignJournalAfterActTransition() {
    try {
      await this.createCampaignJournal({ renderJournal: false });
    } catch (error) {
      console.error("Lore Smith | Campaign Journal update failed after an Act transition", error);
      ui.notifications.warn("The Act was saved, but the campaign Journal could not be updated. You can update it later.");
    }
  }

  async syncCampaignForm({ persist = true } = {}) {
    const root = this.element;
    if (!root || !["campaign", "campaignMap"].includes(this.activeTab)) return;
    const value = (name) => root.querySelector(`[name="${name}"]`)?.value?.trim();
    const assign = (target, property, name, transform = (entry) => entry) => {
      const fieldValue = value(name);
      if (fieldValue !== undefined) target[property] = transform(fieldValue);
    };
    assign(this.campaign, "name", "campaignName");
    assign(this.campaign, "premise", "campaignPremise");
    assign(this.campaign, "startingLevel", "campaignStartingLevel", (entry) => Math.max(1, Math.min(20, Number(entry) || 1)));
    assign(this.campaign, "finalLevel", "campaignFinalLevel", (entry) => Math.max(1, Math.min(20, Number(entry) || 1)));
    assign(this.campaign, "sessionCount", "campaignSessionCount", (entry) => Math.max(1, Math.min(100, Number(entry) || 10)));
    assign(this.campaign, "sessionHours", "campaignSessionHours", (entry) => Math.max(1, Math.min(12, Number(entry) || 4)));
    assign(this.campaign, "length", "campaignLength");
    if (this.activeTab === "campaign") {
      const card = root.querySelector("[data-campaign-act-id]");
      const act = this.campaign.acts.find((entry) => entry.id === card?.dataset.campaignActId);
      if (card && act) {
        const fields = ["name", "objective", "startingSituation", "locations", "people", "developments", "clues", "encounters", "turningPoint", "endingCondition", "gmNotes", "actualOutcome", "carryForward"];
        for (const field of fields) {
          const control = card.querySelector(`[data-campaign-act-field="${field}"]`);
          if (control) act[field] = control.value.trim();
        }
        const sessions = card.querySelector('[data-campaign-act-field="estimatedSessions"]');
        if (sessions) act.estimatedSessions = Math.max(3, Math.min(100, Number(sessions.value) || 3));
        for (const sessionCard of card.querySelectorAll("[data-campaign-act-session-id]")) {
          const session = act.chapters.flatMap((chapter) => chapter.sessions).find((entry) => entry.id === sessionCard.dataset.campaignActSessionId);
          if (!session) continue;
          for (const field of ["title", "purpose"]) {
            const control = sessionCard.querySelector(`[data-campaign-act-session-field="${field}"]`);
            if (control) session[field] = control.value.trim();
          }
        }
        ensureCampaignActChapters(act);
      }
    }
    if (this.activeTab === "campaignMap") {
      const previousStart = this.campaign.map.startLocationId;
      assign(this.campaign.map, "startLocationId", "campaignStartLocation");
      if (this.campaign.map.startLocationId && this.campaign.map.startLocationId !== previousStart) {
        const start = this.campaign.locations.find((entry) => entry.id === this.campaign.map.startLocationId);
        if (start && Number.isFinite(Number.parseFloat(start.x)) && Number.isFinite(Number.parseFloat(start.y))) {
          this.campaign.map.focus.x = Number(start.x);
          this.campaign.map.focus.y = Number(start.y);
        }
      }
    }
    assign(this.campaign, "style", "campaignStyle");
    assign(this.campaign, "tone", "campaignTone");
    assign(this.campaign.identity, "themes", "campaignThemes");
    assign(this.campaign.identity, "playerPromise", "campaignPlayerPromise");
    assign(this.campaign.identity, "boundaries", "campaignBoundaries");
    assign(this.campaign, "background", "campaignBackground");
    assign(this.campaign, "characterHooks", "campaignCharacterHooks");
    assign(this.campaign.problem, "wrong", "campaignProblemWrong");
    assign(this.campaign.problem, "cause", "campaignProblemCause");
    assign(this.campaign.problem, "stakes", "campaignProblemStakes");
    assign(this.campaign.problem, "involvement", "campaignProblemInvolvement");
    assign(this.campaign.problem, "distinction", "campaignProblemDistinction");
    assign(this.campaign.problem, "resolution", "campaignProblemResolution");
    assign(this.campaign.setting, "history", "campaignSettingHistory");
    assign(this.campaign.setting, "cultures", "campaignSettingCultures");
    assign(this.campaign.setting, "magic", "campaignSettingMagic");
    assign(this.campaign.setting, "politics", "campaignSettingPolitics");
    assign(this.campaign.progression, "leveling", "campaignLeveling");
    assign(this.campaign.progression, "treasure", "campaignProgressionTreasure");
    assign(this.campaign.progression, "narrative", "campaignProgressionNarrative");
    assign(this.campaign.progression, "reputation", "campaignProgressionReputation");
    assign(this.campaign.progression, "options", "campaignProgressionOptions");
    assign(this.campaign.consistency, "imagery", "campaignConsistencyImagery");
    assign(this.campaign.consistency, "naming", "campaignConsistencyNaming");
    assign(this.campaign.consistency, "rules", "campaignConsistencyRules");
    assign(this.campaign.consistency, "timeline", "campaignConsistencyTimeline");
    assign(this.campaign.consistency, "travel", "campaignConsistencyTravel");
    const collectionFields = {
      structure: ["name", "summary", "outcome"], locations: ["name", "type", "image", "description", "importance", "secret", "currentSituation", "people", "services", "reasonToLeave", "ignored", "relationship", "reasonToVisit", "opportunity", "danger", "lead", "travel", "knownFor", "rumor", "futureUse"],
      factions: ["name", "goal", "methods", "resources", "relationship", "ignored"], threats: ["name", "goal", "escalation", "consequences"],
      openQuestions: ["text"], secrets: ["secret", "clues", "knownBy"], rumors: ["text", "truth"],
      worldEvents: ["trigger", "event", "consequence"],
      chapters: ["title", "purpose", "opening", "information", "locations", "npcs", "scenes", "revelations", "encounters", "rewards", "choices", "consequences", "transition"],
      routes: ["fromId", "toId", "type", "travel", "feature", "complication"],
    };
    for (const [property, fields] of Object.entries(collectionFields)) {
      if (this.activeTab === "campaignMap" && this.campaignStep === 0 && property === "locations") continue;
      const cards = [...root.querySelectorAll(`[data-campaign-entry-kind="${property}"]`)];
      if (!cards.length) continue;
      const existing = new Map(this.campaign[property].map((entry) => [entry.id, entry]));
      const updates = cards.map((card) => {
        const id = card.dataset.campaignEntryId;
        const entry = { ...(existing.get(id) ?? {}), id };
        for (const field of fields) {
          const control = card.querySelector(`[data-campaign-field="${field}"]`);
          if (control) entry[field] = control.value.trim();
        }
        return entry;
      });
      if (this.activeTab === "campaignMap" && property === "locations") {
        const byId = new Map(updates.map((entry) => [entry.id, entry]));
        this.campaign.locations = this.campaign.locations.map((entry) => byId.get(entry.id) ?? entry);
      } else {
        this.campaign[property] = updates;
      }
    }
    const existingPeople = new Map(this.campaign.people.map((person) => [person.id, person]));
    const personCards = [...root.querySelectorAll("[data-campaign-person-id]")];
    if (personCards.length) this.campaign.people = personCards.map((card) => {
      const person = existingPeople.get(card.dataset.campaignPersonId) ?? newCampaignPerson("person", "Important person");
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...person, name: field("campaignPersonName"), description: field("campaignPersonDescription"), wants: field("campaignPersonWants"), knows: field("campaignPersonKnows"), secret: field("campaignPersonSecret") };
    });
    const existingCharacters = new Map(this.campaign.characters.map((character) => [character.id, character]));
    const characterCards = [...root.querySelectorAll("[data-campaign-character-id]")];
    if (characterCards.length) this.campaign.characters = characterCards.map((card) => {
      const character = existingCharacters.get(card.dataset.campaignCharacterId) ?? newCampaignCharacter();
      const field = (name) => card.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
      return { ...character, name: field("campaignCharacterName"), involvement: field("campaignCharacterInvolvement"), npcConnection: field("campaignCharacterNpc"), desire: field("campaignCharacterDesire"), bond: field("campaignCharacterBond"), complication: field("campaignCharacterComplication"), growth: field("campaignCharacterGrowth") };
    });
    if (this.activeTab === "campaignMap" && this.campaignDeletedLocationIds.size) {
      this.campaign.locations = this.campaign.locations.filter((entry) => !this.campaignDeletedLocationIds.has(entry.id));
      this.campaign.routes = this.campaign.routes.filter((entry) => !this.campaignDeletedLocationIds.has(entry.fromId) && !this.campaignDeletedLocationIds.has(entry.toId));
    }
    if (this.activeTab === "campaignMap") ensureCampaignMapScope(this.campaign); else ensureCampaignActs(this.campaign);
    if (this.activeTab === "campaignMap" && !persist) {
      this.writeCampaignRecoverySnapshot();
    }
    if (persist) await this.saveCampaignDraft();
  }

  static async newCampaignBuild() {
    await this.syncCampaignForm();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Start a new campaign?" },
      content: "<p>This clears the current Campaign Builder draft. Existing Foundry Journals are not deleted.</p>",
      yes: { label: "Start new campaign", icon: "fa-solid fa-rotate-left" },
      no: { label: "Cancel" },
    });
    if (!confirmed) return;
    this.campaign = this.activeTab === "campaignMap" ? newCampaignMapBuild() : newCampaignBuild();
    this.campaignStep = 0;
    await this.saveCampaignDraft();
    await this.render();
  }

  static async previousCampaignStep() {
    await this.syncCampaignForm();
    this.campaignStep = Math.max(0, this.campaignStep - 1);
    await this.saveCampaignDraft();
    await this.render();
  }

  static async nextCampaignStep() {
    await this.syncCampaignForm();
    this.campaignStep = Math.min(7, this.campaignStep + 1);
    await this.saveCampaignDraft();
    await this.render();
  }

  static async goToCampaignStep(_event, target) {
    await this.syncCampaignForm();
    const requested = Math.max(0, Number(target.dataset.step) || 0);
    if (this.activeTab === "campaign") {
      ensureCampaignActs(this.campaign);
      const locked = requested > 0 && this.campaign.acts[requested - 1]?.status !== "completed";
      if (locked || !this.campaign.acts[requested]) return ui.notifications.warn("Complete the previous act before preparing this one.");
      this.campaignStep = requested;
    } else this.campaignStep = Math.min(7, requested);
    await this.saveCampaignDraft();
    await this.render();
  }

  static async browseCampaignLocationImage(_event, target) {
    await this.syncCampaignForm();
    const entry = this.campaign.locations.find((location) => location.id === target.dataset.id);
    if (!entry) return;
    new FilePicker({ type: "imagevideo", current: entry.image, callback: async (path) => {
      entry.image = path;
      await this.saveCampaignDraft();
      await this.renderCampaignPreservingScroll();
    } }).browse();
  }

  static async browseCampaignMap() {
    await this.syncCampaignForm();
    new FilePicker({ type: "imagevideo", current: this.campaign.map.image, callback: async (path) => {
      this.campaign.map.image = path;
      await this.saveCampaignDraft();
      await this.renderCampaignPreservingScroll();
    } }).browse();
  }

  static async activateCampaignMapTool(_event, target) {
    await this.syncCampaignForm();
    this.campaignMapTool = target.dataset.tool === this.campaignMapTool ? "" : target.dataset.tool;
    await this.renderCampaignPreservingScroll();
  }

  static async cancelCampaignMapTool() {
    this.campaignMapTool = "";
    await this.renderCampaignPreservingScroll();
  }

  static async resetCampaignMapView() {
    ensureCampaignMapScope(this.campaign);
    this.campaign.map.view = { zoom: 1, panX: 0, panY: 0 };
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static toggleLoreSmithFullscreen() {
    this.dashboardFullscreen = !this.dashboardFullscreen;
    this.element?.classList.toggle("ls-dashboard-fullscreen", this.dashboardFullscreen);
    const button = this.element?.querySelector('[data-action="toggleLoreSmithFullscreen"]');
    if (button) button.innerHTML = this.dashboardFullscreen
      ? '<i class="fa-solid fa-compress"></i> Exit full screen'
      : '<i class="fa-solid fa-expand"></i> Full screen';
  }

  static async selectCampaignMarker(_event, target) {
    if (this._campaignMarkerWasDragged) {
      this._campaignMarkerWasDragged = false;
      return;
    }
    await this.syncCampaignForm();
    const location = this.campaign.locations.find((entry) => entry.id === target.dataset.id);
    if (!location) return;
    this.campaign.map.startLocationId = location.id;
    this.campaign.map.focus.x = Number(location.x) || 0.5;
    this.campaign.map.focus.y = Number(location.y) || 0.5;
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignMarker(_event, target) {
    const id = target.dataset.id;
    clearTimeout(this.campaignSaveTimer);
    await this.syncCampaignForm({ persist: false });
    this.campaignDeletedLocationIds.add(id);
    this.campaign.locations = this.campaign.locations.filter((entry) => entry.id !== id);
    if (this.mapCampaign !== this.campaign) this.mapCampaign.locations = this.mapCampaign.locations.filter((entry) => entry.id !== id);
    this.campaign.routes = this.campaign.routes.filter((entry) => entry.fromId !== id && entry.toId !== id);
    if (this.campaign.map.startLocationId === id) this.campaign.map.startLocationId = "";
    this.writeCampaignRecoverySnapshot();
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async addCampaignEntry(_event, target) {
    await this.syncCampaignForm();
    const kind = target.dataset.kind;
    const factories = {
      structure: newCampaignStructure, locations: newCampaignLocation, factions: newCampaignFaction,
      threats: newCampaignThreat, openQuestions: newCampaignQuestion, secrets: newCampaignSecret,
      rumors: newCampaignRumor, worldEvents: newCampaignWorldEvent, routes: newCampaignRoute,
      people: () => newCampaignPerson("person", `Important person ${this.campaign.people.length + 1}`),
    };
    if (!factories[kind] || !Array.isArray(this.campaign[kind])) return;
    this.campaign[kind].push(factories[kind]());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignEntry(_event, target) {
    await this.syncCampaignForm();
    const kind = target.dataset.kind;
    if (!Array.isArray(this.campaign[kind])) return;
    this.campaign[kind] = this.campaign[kind].filter((entry) => entry.id !== target.dataset.id);
    if (this.activeTab === "campaignMap") ensureCampaignMapScope(this.campaign); else ensureCampaignActs(this.campaign);
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async addCampaignCharacter() {
    await this.syncCampaignForm();
    this.campaign.characters.push(newCampaignCharacter());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async removeCampaignCharacter(_event, target) {
    await this.syncCampaignForm();
    this.campaign.characters = this.campaign.characters.filter((character) => character.id !== target.dataset.id);
    if (!this.campaign.characters.length) this.campaign.characters.push(newCampaignCharacter());
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async addCampaignAct() {
    await this.syncCampaignForm();
    this.campaign.acts.push(newCampaignAct(this.campaign.acts.length + 1));
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async prepareCampaignSession(_event, target) {
    await this.syncCampaignForm();
    const act = this.adventureCampaign.acts.find((entry) => entry.id === target.dataset.actId);
    const chapter = act?.chapters.find((entry) => entry.id === target.dataset.chapterId);
    const session = chapter?.sessions.find((entry) => entry.id === target.dataset.sessionId);
    if (!act || !chapter || !session) return ui.notifications.warn("Lore Smith could not find that campaign session.");
    const link = { actId: act.id, chapterId: chapter.id, sessionId: session.id };
    const prep = session.prep ? normalizeSessionPrep(session.prep) : newSessionPrep(link);
    prep.campaignLink = link;
    if (!prep.title.trim()) prep.title = session.title.trim() || `${this.adventureCampaign.name || "Campaign"} — Act ${act.number}, Session ${session.number}`;
    if (!prep.goal.trim()) prep.goal = session.purpose.trim();
    this.sessionPrep = prep;
    this.sessionStep = 0;
    this.lastSessionJournalId = game.journal.get(session.journalId)?.id ?? null;
    this.activeTab = "session";
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async openCampaignSessionJournal(_event, target) {
    const journal = game.journal.get(target.dataset.journalId);
    if (!journal) return ui.notifications.warn("This session Journal no longer exists.");
    journal.sheet.render(true);
  }

  static async backToCampaignAct() {
    await this.syncSessionPrepForm();
    const actId = this.sessionPrep.campaignLink?.actId;
    const index = this.adventureCampaign.acts.findIndex((act) => act.id === actId);
    this.activeTab = "campaign";
    this.campaign = this.adventureCampaign;
    this.campaignStep = index >= 0 ? index : this.adventureCampaignStep;
    this.adventureCampaignStep = this.campaignStep;
    await this.saveCampaignDraft();
    await this.render();
  }

  static async markCampaignActReady() {
    clearTimeout(this.campaignSaveTimer);
    await this.syncCampaignForm({ persist: false });
    const act = this.campaign.acts[this.campaignStep];
    if (!act) return;
    const missing = campaignActMissingRequirements(this.campaign, act);
    if (missing.length) return ui.notifications.warn(`Before calling this act ready: ${missing.join(" ")}`);
    act.status = "ready";
    act.readyAt = new Date().toISOString();
    this.applyCampaignActStatusToDom("ready");
    await this.saveCampaignDraft();
    ui.notifications.info(`Act ${act.number} is ready to play.`);
    await this.renderCampaignPreservingScroll();
    await this.syncCampaignJournalAfterActTransition();
  }

  static async reopenCampaignAct() {
    clearTimeout(this.campaignSaveTimer);
    await this.syncCampaignForm({ persist: false });
    const act = this.campaign.acts[this.campaignStep];
    if (!act || act.status === "completed") return;
    act.status = "draft";
    act.readyAt = "";
    this.applyCampaignActStatusToDom("draft");
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async completeCampaignAct() {
    clearTimeout(this.campaignSaveTimer);
    await this.syncCampaignForm({ persist: false });
    const act = this.campaign.acts[this.campaignStep];
    if (!act || act.status !== "ready") return ui.notifications.warn("Call the act ready before completing it.");
    if (!act.actualOutcome.trim()) return ui.notifications.warn("Write what actually happened before completing the act.");
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Complete Act ${act.number}?` },
      content: `<p>This records the act as played and unlocks Act ${act.number + 1}. You can still return to read it later.</p>`,
      yes: { label: "Complete act", icon: "fa-solid fa-flag-checkered" }, no: { label: "Keep editing" },
    });
    if (!confirmed) return;
    act.status = "completed";
    act.completedAt = new Date().toISOString();
    this.applyCampaignActStatusToDom("completed");
    if (this.campaign.acts[this.campaignStep + 1]) this.campaignStep += 1;
    await this.saveCampaignDraft();
    ui.notifications.info(`Act ${act.number} completed. The next act is unlocked.`);
    await this.renderCampaignPreservingScroll();
    await this.syncCampaignJournalAfterActTransition();
  }

  static async removeCampaignActReference(_event, target) {
    await this.syncCampaignForm();
    const act = this.campaign.acts.find((entry) => entry.id === target.dataset.actId);
    const property = { actors: "actorRefs", items: "itemRefs", journals: "journalRefs" }[target.dataset.kind];
    if (!act || !property) return;
    act[property] = act[property].filter((entry) => entry.id !== target.dataset.id);
    await this.saveCampaignDraft();
    await this.renderCampaignPreservingScroll();
  }

  static async createCampaignJournal({ renderJournal = true } = {}) {
    await this.syncCampaignForm();
    const mapBuilder = this.activeTab === "campaignMap";
    const invalid = mapBuilder
      ? !this.campaign.name.trim() || !this.campaign.map.image || !this.campaign.map.startLocationId || !this.campaign.problem.wrong.trim()
      : !this.campaign.name.trim() || !this.campaign.acts?.length;
    if (invalid) {
      if (mapBuilder) this.campaignStep = 7;
      await this.saveCampaignDraft();
      await this.render();
      return ui.notifications.warn("Complete the required Campaign Builder fields before creating the Journal.");
    }
    let journal = game.journal.get(this.campaign.journalId);
    if (!journal) {
      journal = await JournalEntry.create({
        name: this.campaign.name.trim(),
        flags: { [FLAG_SCOPE]: { campaignBuilder: true, createdAt: new Date().toISOString() } },
        pages: [],
      });
      this.campaign.journalId = journal.id;
    } else {
      await journal.update({ name: this.campaign.name.trim() });
    }
    const generated = mapBuilder ? campaignJournalPages(this.campaign) : adventureCampaignJournalPages(this.campaign);
    const generatedKeys = new Set(generated.map((page) => page.key));
    const obsoletePages = journal.pages.filter((page) => {
      const key = page.getFlag(FLAG_SCOPE, "campaignSection");
      return key && !generatedKeys.has(key);
    });
    if (mapBuilder && obsoletePages.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", obsoletePages.map((page) => page.id));
    for (const [index, pageData] of generated.entries()) {
      const existing = journal.pages.find((page) => page.getFlag(FLAG_SCOPE, "campaignSection") === pageData.key);
      if (existing) {
        await existing.update({
          name: pageData.name,
          "text.content": pageData.content,
          "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
          sort: (index + 1) * 100000,
        });
      } else {
        await journal.createEmbeddedDocuments("JournalEntryPage", [{
          name: pageData.name, type: "text",
          text: { content: pageData.content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
          sort: (index + 1) * 100000,
          flags: { [FLAG_SCOPE]: { campaignSection: pageData.key } },
        }]);
      }
    }
    const campaignConfig = {
      length: this.campaign.length, style: this.campaign.style, tone: this.campaign.tone,
      startingLevel: this.campaign.startingLevel, finalLevel: this.campaign.finalLevel,
      sessionCount: this.campaign.sessionCount, sessionHours: this.campaign.sessionHours,
    };
    if (mapBuilder) campaignConfig.map = foundry.utils.deepClone(this.campaign.map);
    else campaignConfig.acts = this.campaign.acts.map((act) => ({
      id: act.id, number: act.number, name: act.name, status: act.status,
      readyAt: act.readyAt, completedAt: act.completedAt,
    }));
    await journal.setFlag(FLAG_SCOPE, "campaignConfig", campaignConfig);
    await this.saveCampaignDraft();
    if (renderJournal) {
      ui.notifications.info(`${journal.name} is ready in Foundry Journals.`);
      journal.sheet.render(true);
      await this.render();
    }
  }

  static async openCampaignJournal() {
    const journal = game.journal.get(this.campaign.journalId);
    if (!journal) return ui.notifications.warn("Create the campaign Journal first.");
    journal.sheet.render(true);
  }

  async ensureWorldJournalFolder(worldId = this.worldMap.id) {
    if (this._worldFolderPromise?.worldId === worldId) return this._worldFolderPromise.promise;
    const worldName = this.worldMap.name.trim() || "Lore Smith World";
    const storedFolderId = this.worldMap.journalFolderId;
    const promise = (async () => {
      let folder = game.folders.get(storedFolderId);
      if (folder?.type !== "JournalEntry" || !folder.getFlag(FLAG_SCOPE, "worldBuilderFolder")
        || folder.getFlag(FLAG_SCOPE, "worldId") !== worldId) folder = null;
      folder ??= game.folders.find((entry) => entry.type === "JournalEntry"
        && entry.getFlag(FLAG_SCOPE, "worldBuilderFolder")
        && entry.getFlag(FLAG_SCOPE, "worldId") === worldId);
      if (!folder) {
        folder = await Folder.create({
          name: worldName, type: "JournalEntry", sorting: "a",
          flags: { [FLAG_SCOPE]: { worldBuilderFolder: true, worldId, schemaVersion: 1 } },
        });
      } else if (folder.name !== worldName) await folder.update({ name: worldName });
      if (this.worldMap.id === worldId) this.worldMap.journalFolderId = folder.id;
      return folder;
    })();
    this._worldFolderPromise = { worldId, promise };
    try { return await promise; } finally {
      if (this._worldFolderPromise?.promise === promise) this._worldFolderPromise = null;
    }
  }

  async syncGeneratedWorldPage(journal, { key, name, content, regionId = "", worldId = this.worldMap.id }) {
    const fingerprint = worldContentFingerprint(content);
    const existing = journal.pages.find((page) => page.getFlag(FLAG_SCOPE, "worldSection") === key
      && (page.getFlag(FLAG_SCOPE, "worldRegionId") ?? "") === regionId);
    if (!existing) {
      const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name, type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
        flags: { [FLAG_SCOPE]: { worldId, worldRegionId: regionId, worldSection: key, generatedFingerprint: fingerprint, schemaVersion: 1 } },
      }]);
      const persistedFingerprint = worldContentFingerprint(created.text?.content ?? "");
      if (persistedFingerprint !== fingerprint) await created.setFlag(FLAG_SCOPE, "generatedFingerprint", persistedFingerprint);
      return { page: created, conflict: false };
    }
    const priorFingerprint = existing.getFlag(FLAG_SCOPE, "generatedFingerprint");
    const currentFingerprint = worldContentFingerprint(existing.text?.content ?? "");
    if ((!priorFingerprint && String(existing.text?.content ?? "").trim()) || (priorFingerprint && currentFingerprint !== priorFingerprint)) {
      return { page: existing, conflict: true };
    }
    await existing.update({
      name, "text.content": content, "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
      [`flags.${FLAG_SCOPE}.worldId`]: worldId,
      [`flags.${FLAG_SCOPE}.worldRegionId`]: regionId,
      [`flags.${FLAG_SCOPE}.worldSection`]: key,
      [`flags.${FLAG_SCOPE}.generatedFingerprint`]: fingerprint,
      [`flags.${FLAG_SCOPE}.schemaVersion`]: 1,
    });
    const persistedFingerprint = worldContentFingerprint(existing.text?.content ?? "");
    if (persistedFingerprint !== fingerprint) await existing.setFlag(FLAG_SCOPE, "generatedFingerprint", persistedFingerprint);
    return { page: existing, conflict: false };
  }

  worldRegionJournalContent(region) {
    const parent = this.worldMap.regions.find((entry) => entry.id === region.parentId);
    const children = this.worldMap.regions.filter((entry) => entry.parentId === region.id);
    const parentJournal = parent ? game.journal.get(parent.journalId) : null;
    const childLinks = children.map((child) => {
      const journal = game.journal.get(child.journalId);
      return journal ? `@UUID[${journal.uuid}]{${escapeHtml(child.name || "Unnamed region")}}` : escapeHtml(child.name || "Unnamed region");
    });
    const locations = this.worldMap.map.image === this.mapCampaign.map.image
      ? this.mapCampaign.locations.filter((location) => Number.isFinite(Number.parseFloat(location.x)) && Number.isFinite(Number.parseFloat(location.y))
        && worldPointInPolygon({ x: Number.parseFloat(location.x), y: Number.parseFloat(location.y) }, region.vertices))
      : [];
    const type = WORLD_REGION_TYPES[region.type]?.label ?? WORLD_REGION_TYPES.other.label;
    return `<article class="ls-world-region-journal"><header><h1>${escapeHtml(region.name || "Unnamed region")}</h1><p><strong>${escapeHtml(type)}</strong> · ${escapeHtml(WORLD_REGION_DEVELOPMENT[region.development] ?? WORLD_REGION_DEVELOPMENT.named)}</p></header>
      ${parent ? `<p><strong>Part of</strong> ${parentJournal ? `@UUID[${parentJournal.uuid}]{${escapeHtml(parent.name || "Unnamed region")}}` : escapeHtml(parent.name || "Unnamed region")}</p>` : ""}
      ${sessionBlock("Regional identity", region.summary)}
      <h2>Land and travel</h2>${sessionBlock("Terrain", region.terrain)}${sessionBlock("Climate", region.climate)}${sessionBlock("Travel and connections", region.travel)}
      <h2>People and power</h2>${sessionBlock("Inhabitants", region.inhabitants)}${sessionBlock("Authority and law", region.authority)}${sessionBlock("Culture and identity", region.culture)}${sessionBlock("Resources and trade", region.resources)}${sessionBlock("Factions", region.factions)}
      <h2>What matters in play</h2>${sessionBlock("Current situation", region.currentSituation)}${sessionBlock("Dangers and pressures", region.dangers)}${sessionBlock("Adventure hooks", region.hooks)}
      ${locations.length ? campaignList("Places inside this region", locations.map((location) => `${location.name || "Unnamed point"} (${CAMPAIGN_POINT_TYPES[location.type] ?? "location"})`)) : ""}
      ${childLinks.length ? `<h2>Subregions</h2><ul>${childLinks.map((link) => `<li>${link}</li>`).join("")}</ul>` : ""}</article>`;
  }

  async ensureWorldRegionJournal(region, { sync = false } = {}) {
    const worldId = this.worldMap.id; const regionId = region.id; const regionName = region.name.trim() || "Unnamed Region";
    let pending = this._worldJournalPromises.get(regionId);
    if (!pending) pending = (async () => {
      let journal = game.journal.get(region.journalId);
      if (journal && (!journal.getFlag(FLAG_SCOPE, "worldBuilder")
        || journal.getFlag(FLAG_SCOPE, "worldDocument") !== "region"
        || journal.getFlag(FLAG_SCOPE, "worldId") !== worldId
        || journal.getFlag(FLAG_SCOPE, "worldRegionId") !== regionId)) journal = null;
      journal ??= game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "worldBuilder")
        && entry.getFlag(FLAG_SCOPE, "worldDocument") === "region"
        && entry.getFlag(FLAG_SCOPE, "worldId") === worldId
        && entry.getFlag(FLAG_SCOPE, "worldRegionId") === regionId);
      const folder = await this.ensureWorldJournalFolder(worldId);
      if (!journal) {
        journal = await JournalEntry.create({
          name: regionName, folder: folder.id, pages: [],
          flags: { [FLAG_SCOPE]: { worldBuilder: true, worldId, worldDocument: "region", worldRegionId: regionId, schemaVersion: 1 } },
        });
      } else {
        const update = {};
        if (journal.name !== regionName) update.name = regionName;
        if (journal.folder?.id !== folder.id) update.folder = folder.id;
        if (Object.keys(update).length) await journal.update(update);
      }
      return journal;
    })().finally(() => this._worldJournalPromises.delete(regionId));
    this._worldJournalPromises.set(regionId, pending);
    const journal = await pending;
    if (this.worldMap.id !== worldId) throw new Error("The World Map Builder changed while its Journal was being created.");
    const liveRegion = this.worldMap.regions.find((entry) => entry.id === regionId);
    if (!liveRegion) throw new Error("The region was removed while its Journal was being created.");
    liveRegion.journalId = journal.id;
    let page = journal.pages.find((entry) => entry.getFlag(FLAG_SCOPE, "worldSection") === "overview");
    let conflict = false;
    if (sync || !page) {
      let syncPromise = this._worldJournalSyncPromises.get(regionId);
      if (!syncPromise) {
        syncPromise = this.syncGeneratedWorldPage(journal, {
          key: "overview", name: "Regional Overview", content: this.worldRegionJournalContent(liveRegion), regionId, worldId,
        }).finally(() => this._worldJournalSyncPromises.delete(regionId));
        this._worldJournalSyncPromises.set(regionId, syncPromise);
      }
      ({ page, conflict } = await syncPromise);
    }
    return { journal, page, conflict };
  }

  async openOrCreateWorldRegionJournal(region, { sync = false } = {}) {
    const { journal, page, conflict } = await this.ensureWorldRegionJournal(region, { sync });
    await this.saveWorldMapDraft();
    if (conflict) ui.notifications.warn(`${journal.name}'s generated overview was edited manually, so Lore Smith preserved it.`);
    const sheet = journal.sheet;
    await sheet.render(true);
    if (page && typeof sheet.goToPage === "function") await sheet.goToPage(page.id);
    return journal;
  }

  static async newWorldMapBuild() {
    await this.syncWorldMapForm();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Start a new world map?" },
      content: "<p>This clears the current World Map Builder draft. Existing Foundry region Journals are preserved.</p>",
      yes: { label: "Start new world", icon: "fa-solid fa-rotate-left" }, no: { label: "Cancel" },
    });
    if (!confirmed) return;
    this.worldMap = newWorldMapBuild(); this.worldMapTool = "";
    await this.saveWorldMapDraft(); await this.render();
  }

  static async browseWorldMap() {
    await this.syncWorldMapForm();
    new FilePicker({ type: "image", current: this.worldMap.map.image, callback: async (path) => {
      if (this.worldMap.regions.length && this.worldMap.map.image && path !== this.worldMap.map.image) {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Replace the world map?" },
          content: "<p>The existing regions will remain at the same proportional coordinates. If the new map has different dimensions or geography, their outlines may no longer align.</p>",
          yes: { label: "Replace map" }, no: { label: "Cancel" },
        });
        if (!confirmed) return;
      }
      this.worldMap.map.image = path; this.worldMap.map.view = { zoom: 1, panX: 0, panY: 0 };
      await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
    } }).browse();
  }

  static async activateWorldRegionTool() {
    await this.syncWorldMapForm();
    if (!this.worldMap.map.image) return ui.notifications.warn("Choose a world map before drawing regions.");
    if (this.worldMapTool === "draw") return;
    this.worldMapTool = "draw";
    await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
  }

  static async cancelWorldRegionTool() {
    this.worldMapTool = ""; this.worldMap.draftVertices = [];
    await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
  }

  static async resetWorldMapView() {
    this.worldMap.map.view = { zoom: 1, panX: 0, panY: 0 };
    await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
  }

  static async selectWorldRegion(_event, target) {
    await this.syncWorldMapForm();
    if (!this.worldMap.regions.some((region) => region.id === target.dataset.id)) return;
    this.worldMap.selectedRegionId = target.dataset.id;
    await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
  }

  static async deleteWorldRegion(_event, target) {
    await this.syncWorldMapForm();
    const region = this.worldMap.regions.find((entry) => entry.id === (target.dataset.id || this.worldMap.selectedRegionId));
    if (!region) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Delete ${region.name || "this region"}?` },
      content: "<p>The polygon and builder data will be removed. Its Foundry Journal will be preserved.</p>",
      yes: { label: "Delete region", icon: "fa-solid fa-trash" }, no: { label: "Cancel" },
    });
    if (!confirmed) return;
    this.worldMap.regions = this.worldMap.regions.filter((entry) => entry.id !== region.id);
    for (const child of this.worldMap.regions) if (child.parentId === region.id) child.parentId = "";
    this.worldMap.selectedRegionId = "";
    await this.saveWorldMapDraft(); await this.renderWorldMapPreservingScroll();
  }

  static async openWorldRegionJournal(_event, target) {
    await this.syncWorldMapForm();
    const region = this.worldMap.regions.find((entry) => entry.id === (target.dataset.id || this.worldMap.selectedRegionId));
    if (!region) return ui.notifications.warn("Select a region first.");
    await this.openOrCreateWorldRegionJournal(region, { sync: true });
  }

  static async createWorldAtlas() {
    if (this._worldAtlasPromise) return this._worldAtlasPromise;
    const pending = (async () => {
    await this.syncWorldMapForm();
    const worldId = this.worldMap.id;
    if (!this.worldMap.name.trim() || !this.worldMap.map.image || !this.worldMap.regions.length || this.worldMap.regions.some((region) => !region.name.trim())) {
      return ui.notifications.warn("Name the world, choose its map, draw at least one region, and name every region first.");
    }
    if (this.worldMap.regions.some((region) => region.vertices.length < 3 || worldPolygonArea(region.vertices) < 0.0001 || worldPolygonSelfIntersects(region.vertices))) {
      return ui.notifications.warn("Repair invalid or self-crossing region boundaries before creating the atlas.");
    }
    const folder = await this.ensureWorldJournalFolder(worldId);
    const regionJournals = [];
    let conflicts = 0;
    for (const region of this.worldMap.regions) {
      const result = await this.ensureWorldRegionJournal(region, { sync: false });
      regionJournals.push({ region, journal: result.journal });
      if (result.conflict) conflicts += 1;
    }
    // A second pass runs only after every regional Journal shell exists, so parent and child links are complete.
    for (const region of this.worldMap.regions) {
      const result = await this.ensureWorldRegionJournal(region, { sync: true });
      if (result.conflict) conflicts += 1;
    }
    if (this.worldMap.id !== worldId) throw new Error("The World Map Builder changed while the atlas was being created.");
    let index = game.journal.get(this.worldMap.indexJournalId);
    if (index && (!index.getFlag(FLAG_SCOPE, "worldBuilder") || index.getFlag(FLAG_SCOPE, "worldId") !== worldId
      || index.getFlag(FLAG_SCOPE, "worldDocument") !== "index")) index = null;
    index ??= game.journal.find((entry) => entry.getFlag(FLAG_SCOPE, "worldBuilder")
      && entry.getFlag(FLAG_SCOPE, "worldId") === worldId && entry.getFlag(FLAG_SCOPE, "worldDocument") === "index");
    if (!index) index = await JournalEntry.create({
      name: `${this.worldMap.name} - World Atlas`, folder: folder.id, pages: [],
      flags: { [FLAG_SCOPE]: { worldBuilder: true, worldId, worldDocument: "index", schemaVersion: 1 } },
    });
    else await index.update({ name: `${this.worldMap.name} - World Atlas`, folder: folder.id });
    this.worldMap.indexJournalId = index.id;
    const mapContent = `<h1>${escapeHtml(this.worldMap.name)}</h1><figure><img src="${escapeHtml(this.worldMap.map.image)}" alt="${escapeHtml(this.worldMap.name)}"></figure><p>Double-click a region in Lore Smith's World Map Builder to open its native Foundry Journal.</p>`;
    const directory = regionJournals.sort((left, right) => left.region.name.localeCompare(right.region.name)).map(({ region, journal }) => {
      const parent = this.worldMap.regions.find((candidate) => candidate.id === region.parentId);
      return `<li>@UUID[${journal.uuid}]{${escapeHtml(region.name)}} — ${escapeHtml(WORLD_REGION_TYPES[region.type]?.label ?? "Region")}${parent ? `, part of ${escapeHtml(parent.name)}` : ""}</li>`;
    }).join("");
    const mapPage = await this.syncGeneratedWorldPage(index, { key: "world-map", name: "1. World Map", content: mapContent, worldId });
    const directoryPage = await this.syncGeneratedWorldPage(index, { key: "region-directory", name: "2. Region Directory", content: `<h1>Region Directory</h1><ul>${directory}</ul>`, worldId });
    if (mapPage.conflict) conflicts += 1; if (directoryPage.conflict) conflicts += 1;
    await this.saveWorldMapDraft();
    if (conflicts) ui.notifications.warn(`${conflicts} generated page${conflicts === 1 ? " was" : "s were"} edited manually and preserved.`);
    else ui.notifications.info(`${this.worldMap.name} is ready in Foundry Journals.`);
    await index.sheet.render(true);
    if (mapPage.page && typeof index.sheet.goToPage === "function") await index.sheet.goToPage(mapPage.page.id);
    await this.renderWorldMapPreservingScroll();
    })();
    this._worldAtlasPromise = pending;
    try { return await pending; } finally {
      if (this._worldAtlasPromise === pending) this._worldAtlasPromise = null;
    }
  }

  static async changeTab(event, target) {
    const tab = target?.dataset?.tab || event?.currentTarget?.dataset?.tab;
    if (!tab) return;
    await this.syncSessionPrepForm();
    await this.syncCampaignForm();
    await this.syncWorldMapForm();
    this.activeTab = tab;
    if (tab === "campaignMap") {
      this.campaign = this.mapCampaign; this.campaignStep = this.mapCampaignStep;
    } else if (tab === "campaign") {
      this.campaign = this.adventureCampaign; this.campaignStep = this.adventureCampaignStep;
    }
    await this.render();
  }

  static async newSessionPrep() {
    const campaignLink = this.sessionPrep.campaignLink ? { ...this.sessionPrep.campaignLink } : null;
    this.sessionStep = 0;
    this.sessionPrep = newSessionPrep(campaignLink);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async previousSessionStep() {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, this.sessionStep - 1);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async nextSessionStep() {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.min(5, this.sessionStep + 1);
    if (this.sessionStep === 3) await ensureSessionPlaylistAvailable(this.sessionPrep);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async goToSessionStep(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionStep = Math.max(0, Math.min(5, Number(target.dataset.step) || 0));
    if (this.sessionStep === 3) await ensureSessionPlaylistAvailable(this.sessionPrep);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async addLocation() {
    await this.syncSessionPrepForm();
    this.sessionPrep.locations.push(newSessionLocation());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeLocation(_event, target) {
    await this.syncSessionPrepForm();
    if (this.sessionPrep.locations.length <= 2) return;
    this.sessionPrep.locations = this.sessionPrep.locations.filter((location) => location.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseLocationImage(_event, target) {
    await this.syncSessionPrepForm();
    const location = this.sessionPrep.locations.find((entry) => entry.id === target.dataset.id);
    if (!location) return;
    new FilePicker({ type: "imagevideo", current: location.image, callback: async (path) => {
      location.image = path;
      await this.saveSessionPrepDraft();
      const input = this.element?.querySelector(`[data-location-id="${location.id}"] [name="locationImage"]`);
      if (input) input.value = path;
    } }).browse();
  }

  static async addSessionNpc() {
    await this.syncSessionPrepForm();
    this.sessionPrep.npcs ??= [];
    this.sessionPrep.npcs.push(newSessionNpc());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeSessionNpc(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.npcs = (this.sessionPrep.npcs ?? []).filter((npc) => npc.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseSessionNpcImage(_event, target) {
    await this.syncSessionPrepForm();
    const npc = (this.sessionPrep.npcs ?? []).find((entry) => entry.id === target.dataset.id);
    if (!npc) return;
    new FilePicker({ type: "imagevideo", current: npc.image, callback: async (path) => {
      npc.image = path;
      await this.saveSessionPrepDraft();
      const card = this.element?.querySelector(`[data-session-npc-id="${npc.id}"]`);
      const input = card?.querySelector('[name="npcImage"]');
      if (input) input.value = path;
      const portrait = card?.querySelector(".ls-session-npc-portrait");
      if (portrait) {
        portrait.replaceChildren();
        const image = document.createElement("img"); image.src = path; image.alt = npc.name || "NPC"; portrait.append(image);
      }
    } }).browse();
  }

  static async addMusicCue() {
    await this.syncSessionPrepForm();
    this.sessionPrep.musicCues ??= [];
    this.sessionPrep.musicCues.push(newSessionMusicCue());
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async removeMusicCue(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.musicCues = (this.sessionPrep.musicCues ?? []).filter((cue) => cue.id !== target.dataset.id);
    await this.saveSessionPrepDraft();
    await this.render();
  }

  static async browseMusicAudio(_event, target) {
    await this.syncSessionPrepForm();
    const cue = (this.sessionPrep.musicCues ?? []).find((entry) => entry.id === target.dataset.id);
    if (!cue) return;
    new FilePicker({ type: "audio", current: cue.audio, callback: async (path) => {
      cue.audio = path;
      await this.saveSessionPrepDraft();
      const input = this.element?.querySelector(`[data-session-music-id="${cue.id}"] [name="musicAudio"]`);
      if (input) input.value = path;
    } }).browse();
  }

  static async addPeopleEntry() {
    await this.syncSessionPrepForm(); this.sessionPrep.peopleEntries.push(newSessionPeopleEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removePeopleEntry(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.peopleEntries = this.sessionPrep.peopleEntries.filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep.peopleEntries.length) this.sessionPrep.peopleEntries.push(newSessionPeopleEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async addSessionEncounter() {
    await this.syncSessionPrepForm(); this.sessionPrep.encounterEntries.push(newSessionEncounter());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionEncounter(_event, target) {
    await this.syncSessionPrepForm();
    this.sessionPrep.encounterEntries = this.sessionPrep.encounterEntries.filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep.encounterEntries.length) this.sessionPrep.encounterEntries.push(newSessionEncounter());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async addSessionTextEntry(_event, target) {
    await this.syncSessionPrepForm();
    const property = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" }[target.dataset.kind];
    if (!property) return;
    this.sessionPrep[property].push(newSessionTextEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionTextEntry(_event, target) {
    await this.syncSessionPrepForm();
    const property = { scene: "sceneEntries", clue: "clueEntries", consequence: "consequenceEntries", change: "changeEntries" }[target.dataset.kind];
    if (!property) return;
    this.sessionPrep[property] = this.sessionPrep[property].filter((entry) => entry.id !== target.dataset.id);
    if (!this.sessionPrep[property].length) this.sessionPrep[property].push(newSessionTextEntry());
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async removeSessionReference(_event, target) {
    const { kind, parentId, id } = target.dataset;
    if (kind === "hazard") this.sessionPrep.hazards = this.sessionPrep.hazards.filter((entry) => entry.id !== id);
    if (kind === "reward") this.sessionPrep.rewardItems = this.sessionPrep.rewardItems.filter((entry) => entry.id !== id);
    if (kind === "encounter") {
      const encounter = this.sessionPrep.encounterEntries.find((entry) => entry.id === parentId);
      if (encounter) encounter.actors = encounter.actors.filter((entry) => entry.id !== id);
    }
    await this.saveSessionPrepDraft(); await this.renderSessionPreservingScroll();
  }

  static async createSessionJournal() {
    await this.syncSessionPrepForm();
    const linkedActId = this.sessionPrep.campaignLink?.actId ?? "";
    const invalid = !this.sessionPrep.title.trim() || !this.sessionPrep.goal.trim()
      || this.sessionPrep.locations.length < 2 || this.sessionPrep.locations.some((location) => !location.name.trim() || !location.image.trim());
    if (invalid) {
      this.sessionStep = 5;
      await this.render();
      return ui.notifications.warn("Complete the title, goal, and both important places before creating the Journal.");
    }
    try {
      await materializeSessionMusic(this.sessionPrep);
    } catch (error) {
      console.error("Lore Smith | Could not create the session Playlist.", error);
      return ui.notifications.error("Lore Smith could not add the session music to Foundry. Check the selected audio files and try again.");
    }
    const journal = await JournalEntry.create({
      name: this.sessionPrep.title.trim(),
      flags: { [FLAG_SCOPE]: { sessionPrep: true, sessionPrepVersion: 3, createdAt: new Date().toISOString(), sessionGoal: this.sessionPrep.goal.trim(), campaignLink: this.sessionPrep.campaignLink ?? null } },
      pages: [],
    });
    const pages = sessionJournalPages(this.sessionPrep).map((page, index) => ({ name: page.name, type: "text", text: { content: page.content }, sort: (index + 1) * 100000 }));
    await journal.createEmbeddedDocuments("JournalEntryPage", pages);
    this.lastSessionJournalId = journal.id;
    this.activeNoteId = null;
    await this.syncLinkedCampaignSession({ journalId: journal.id });
    this.sessionPrep = newSessionPrep();
    this.sessionStep = 0;
    await this.saveSessionPrepDraft();
    if (linkedActId) {
      this.activeTab = "campaign";
      this.campaign = this.adventureCampaign;
      const actIndex = this.adventureCampaign.acts.findIndex((act) => act.id === linkedActId);
      if (actIndex >= 0) this.campaignStep = this.adventureCampaignStep = actIndex;
      await this.saveCampaignDraft();
    }
    ui.notifications.info(`Created session Journal: ${journal.name}.`);
    journal.sheet.render(true);
    await this.render();
  }

  static async openLastSessionJournal() {
    const journal = game.journal.get(this.lastSessionJournalId);
    if (journal) journal.sheet.render(true);
  }

  static async createNote() {
    await this.saveActiveNote();
    const journal = await this.getNotebook(true);
    const existing = new Set(journal.pages.map((page) => page.name.toLowerCase()));
    let noteName = "New Note";
    let suffix = 2;
    while (existing.has(noteName.toLowerCase())) noteName = `New Note ${suffix++}`;
    const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: noteName,
      type: "text",
      text: { content: "" },
      sort: Math.max(0, ...journal.pages.map((candidate) => candidate.sort ?? 0)) + 100000,
    }]);
    this.activeNoteId = page.id;
    await this.render();
  }

  static async openNote(_event, target) {
    await this.saveActiveNote();
    this.activeNoteId = target.dataset.id;
    await this.render();
  }

  static async openNotebook() {
    const journal = await this.getNotebook(true);
    journal.sheet.render(true);
  }

  static async searchCreatures() {
    this.creatureSearch = this.element.querySelector('[name="creatureSearch"]')?.value.trim() ?? "";
    if (this.creatureSearch.length < 2) {
      ui.notifications.warn("Enter at least two letters to search creatures.");
      return;
    }
    const query = this.creatureSearch.toLowerCase();
    const results = [];
    for (const pack of game.packs.filter((candidate) => candidate.documentName === "Actor")) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", "system.details.level.value"] });
      for (const entry of index) {
        if (entry.type !== "npc" || !entry.name.toLowerCase().includes(query)) continue;
        results.push({
          name: entry.name,
          img: entry.img,
          level: numeric(entry.system?.details?.level, 0),
          packLabel: pack.metadata.label,
          uuid: entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`,
        });
        if (results.length >= 80) break;
      }
      if (results.length >= 80) break;
    }
    this.creatureResults = results.sort((left, right) => left.name.localeCompare(right.name));
    await this.render();
  }

  static async cloneCreature(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e creature.");
    const data = source.toObject();
    delete data._id;
    data.name = `${data.name} (Lore Smith)`;
    data.folder = null;
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [FLAG_SCOPE]: { created: true, sourceUuid: source.uuid } });
    const actor = await Actor.create(data);
    actor.sheet.render(true);
    ui.notifications.info(`Created editable PF2e actor: ${actor.name}.`);
  }

  static async blankCreature() {
    const actor = await Actor.create({
      name: "New Creature",
      type: "npc",
      flags: { [FLAG_SCOPE]: { created: true } },
      system: {
        details: { level: { value: 0 }, publication: { license: "ORC", remaster: true, title: "Lore Smith" } },
        traits: { rarity: "common", size: { value: "med" }, value: [] },
      },
    });
    actor.sheet.render(true);
  }

  static async searchItems() {
    this.itemSearch = this.element.querySelector('[name="itemSearch"]')?.value.trim() ?? "";
    this.itemType = this.element.querySelector('[name="itemType"]')?.value ?? "";
    if (this.itemSearch.length < 2) {
      ui.notifications.warn("Enter at least two letters to search items.");
      return;
    }
    const query = this.itemSearch.toLowerCase();
    const results = [];
    for (const pack of game.packs.filter((candidate) => candidate.documentName === "Item")) {
      const index = await pack.getIndex({ fields: ["name", "img", "type", "system.level.value"] });
      for (const entry of index) {
        if (this.itemType && entry.type !== this.itemType) continue;
        if (!entry.name.toLowerCase().includes(query)) continue;
        results.push({
          name: entry.name,
          img: entry.img,
          type: ITEM_TYPE_LABELS[entry.type] ?? entry.type,
          level: numeric(entry.system?.level, 0),
          packLabel: pack.metadata.label,
          uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`,
        });
        if (results.length >= 100) break;
      }
      if (results.length >= 100) break;
    }
    this.itemResults = results.sort((left, right) => left.name.localeCompare(right.name));
    await this.render();
  }

  static async cloneItem(_event, target) {
    const source = await fromUuid(target.dataset.uuid);
    if (!source) return ui.notifications.error("Could not load that PF2e item.");
    const data = source.toObject();
    delete data._id;
    data.name = `${data.name} (Lore Smith)`;
    data.folder = null;
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [FLAG_SCOPE]: { created: true, sourceUuid: source.uuid } });
    const item = await Item.create(data);
    if (game.loreSmith?.openItemBuilder && ["ammo", "armor", "backpack", "book", "consumable", "equipment", "kit", "shield", "treasure", "weapon"].includes(item.type)) game.loreSmith.openItemBuilder(item);
    else item.sheet.render(true);
    ui.notifications.info(`Created editable PF2e item: ${item.name}.`);
  }

  static async blankItem() {
    const response = await foundry.applications.api.DialogV2.input({
      window: { title: "Create Blank PF2e Item" },
      content: `<label>Item type <select name="type">${["equipment", "consumable", "ammo", "weapon", "armor", "shield", "backpack", "kit", "book", "treasure"].map((type) => `<option value="${type}">${ITEM_TYPE_LABELS[type] ?? game.i18n.localize(`TYPES.Item.${type}`)}</option>`).join("")}</select></label>`,
      ok: { label: "Create item" },
      rejectClose: false,
    });
    if (!response?.type) return;
    const item = await Item.create({
      name: "New Item",
      type: response.type,
      flags: { [FLAG_SCOPE]: { created: true } },
      system: {
        level: { value: 0 },
        publication: { license: "ORC", remaster: true, title: "Lore Smith" },
        traits: { rarity: "common", value: [] },
      },
    });
    if (game.loreSmith?.openItemBuilder) game.loreSmith.openItemBuilder(item);
    else item.sheet.render(true);
  }

  syncLootForm() {
    const root = this.element;
    if (!root) return;
    const enteredMin = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMinLevel"]')?.value) || 0));
    const enteredMax = Math.max(0, Math.min(30, Number(root.querySelector('[name="lootMaxLevel"]')?.value) || 0));
    this.lootMinLevel = Math.min(enteredMin, enteredMax);
    this.lootMaxLevel = Math.max(enteredMin, enteredMax);
    this.lootCount = Math.max(1, Math.min(100, Number(root.querySelector('[name="lootCount"]')?.value) || 6));
    this.lootSources = {
      permanent: Boolean(root.querySelector('[name="lootPermanent"]')?.checked), consumable: Boolean(root.querySelector('[name="lootConsumable"]')?.checked),
      gems: Boolean(root.querySelector('[name="lootGems"]')?.checked), art: Boolean(root.querySelector('[name="lootArt"]')?.checked),
    };
    this.lootRarities = {
      common: Boolean(root.querySelector('[name="lootRarityCommon"]')?.checked), uncommon: Boolean(root.querySelector('[name="lootRarityUncommon"]')?.checked),
      rare: Boolean(root.querySelector('[name="lootRarityRare"]')?.checked), unique: Boolean(root.querySelector('[name="lootRarityUnique"]')?.checked),
    };
    this.lootMatchMode = root.querySelector('[name="lootMatchMode"]')?.value === "any" ? "any" : "all";
    this.lootFlexible = Boolean(root.querySelector('[name="lootFlexible"]')?.checked);
    this.lootFilters = [...root.querySelectorAll("[data-loot-filter-id]")].map((row) => ({
      id: row.dataset.lootFilterId, mode: row.querySelector('[name="lootFilterMode"]')?.value ?? "required",
      mechanic: row.querySelector('[name="lootFilterMechanic"]')?.value ?? "resistance", detail: row.querySelector('[name="lootFilterDetail"]')?.value ?? "",
    }));
  }

  static async addLootFilter() { this.syncLootForm(); this.lootFilters.push(newLootFilter()); await this.render(); }

  static async removeLootFilter(_event, target) {
    this.syncLootForm();
    const row = target.closest("[data-loot-filter-id]");
    this.lootFilters = this.lootFilters.filter((filter) => filter.id !== row?.dataset.lootFilterId);
    await this.render();
  }

  static async generateLoot() {
    this.syncLootForm();
    const { lootMinLevel: minLevel, lootMaxLevel: maxLevel, lootCount: count } = this;
    const { permanent, consumable, gems, art } = this.lootSources;
    if (!permanent && !consumable && !gems && !art) return ui.notifications.warn("Choose at least one treasure source.");
    if ((permanent || consumable) && !Object.values(this.lootRarities).some(Boolean)) return ui.notifications.warn("Choose at least one item rarity.");
    const results = [];
    const candidates = await collectFilteredLoot(minLevel, maxLevel, {
      includePermanent: permanent, includeConsumable: consumable, rarities: this.lootRarities,
      filters: this.lootFilters, matchMode: this.lootMatchMode, flexible: this.lootFlexible,
    });
    const usedFamilies = new Set();
    const tableKinds = [...(gems ? ["gems"] : []), ...(art ? ["art"] : [])];
    const itemTarget = Math.max(0, count - Math.min(count, tableKinds.length));
    for (const candidate of candidates) {
      if (results.length >= itemTarget) break;
      const family = lootFamilyKey(candidate.name);
      if (!results.some((entry) => entry.uuid === candidate.uuid) && !usedFamilies.has(family)) {
        results.push(candidate); usedFamilies.add(family);
      }
    }
    let tablesUsed = 0;
    const maxTableAttempts = Math.max(tableKinds.length, count * 4);
    for (let attempt = 0; tableKinds.length && results.length < count && attempt < maxTableAttempts; attempt += 1) {
      const kind = tableKinds[attempt % tableKinds.length];
      const tableLevel = minLevel + Math.floor(Math.random() * (maxLevel - minLevel + 1));
      const rolled = await rollTreasureTable(kind, tableLevel);
      if (!rolled) continue;
      tablesUsed += 1;
      const tableResult = rolled.document
        ? { name: rolled.document.name, img: rolled.document.img, type: ITEM_TYPE_LABELS[rolled.document.type] ?? rolled.document.type, documentType: rolled.document.type, level: numeric(rolled.document.system?.level, tableLevel), uuid: rolled.document.uuid, source: rolled.table, matchReasons: ["Treasure table result"] }
        : { name: rolled.text, img: rolled.img, type: kind === "gems" ? "Precious stone" : "Art object", level: tableLevel, uuid: "", source: rolled.table, matchReasons: ["Treasure table result"] };
      const family = lootFamilyKey(tableResult.name);
      if (family && usedFamilies.has(family)) continue;
      if (family) usedFamilies.add(family);
      results.push(tableResult);
    }
    const uniqueResults = [];
    const finalFamilies = new Set();
    for (const entry of results) {
      const family = lootFamilyKey(entry.name);
      if (family && finalFamilies.has(family)) continue;
      if (family) finalFamilies.add(family);
      uniqueResults.push(entry);
    }
    this.lootResults = uniqueResults.slice(0, count).map((entry) => ({
      ...entry, id: foundry.utils.randomID(),
      reason: entry.matchReasons?.length ? entry.matchReasons.join(" · ") : "Matches selected level, rarity, and source",
    }));
    const itemCount = this.lootResults.filter((entry) => entry.uuid).length;
    const shortfall = this.lootResults.length < count ? ` Requested ${count}; found ${this.lootResults.length} unique matches.` : "";
    this.lootStatus = `Found ${itemCount} installed PF2e item${itemCount === 1 ? "" : "s"} matching the selected source, rarity, level, and mechanical filters${tablesUsed ? `, plus results from ${tablesUsed} treasure table${tablesUsed === 1 ? "" : "s"}` : ""}.${shortfall}`;
    await this.render();
  }

  static async clearLoot() { this.lootResults = []; this.lootStatus = ""; await this.render(); }

  static async openLootDocument(_event, target) {
    const document = await fromUuid(target.dataset.uuid);
    document?.sheet?.render(true);
  }

  static async addLootToRewards(_event, target) {
    const result = this.lootResults.find((entry) => entry.id === target.dataset.id);
    if (!result?.uuid) return;
    this.sessionPrep.rewardItems ??= [];
    if (!this.sessionPrep.rewardItems.some((entry) => entry.uuid === result.uuid)) {
      this.sessionPrep.rewardItems.push(normalizeSessionReference(result));
      await this.saveSessionPrepDraft();
    }
    ui.notifications.info(`${result.name} was added to Session Prep rewards.`);
  }

}

let dashboard;

function openLoreSmith() {
  dashboard ??= new LoreSmithDashboard();
  dashboard.render(true);
}

// Publish the workspace opener as soon as this module evaluates. The permanent
// launcher may be rendered after Foundry's ready hook has already fired.
Object.assign(game.loreSmith ??= {}, { open: openLoreSmith });

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "sessionPrepDraft", {
    name: "Session Prep Draft",
    hint: "Automatically stores the current guided session-preparation draft.",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "campaignBuilderDraft", {
    name: "Campaign Builder Draft",
    hint: "Automatically stores the current guided campaign-building draft.",
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "campaignMapBuilderDraft", {
    name: "Campaign Map Builder Draft", hint: "Automatically stores the progressive regional map preparation wizard.",
    scope: "client", config: false, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "campaignMapBuilderWorldDraft", {
    name: "Campaign Map Builder World Draft",
    hint: "Stores the regional campaign map for this Foundry world so it survives browser and device changes.",
    scope: "world", config: false, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "worldMapBuilderDraft", {
    name: "World Map Builder Draft",
    hint: "Automatically stores the current polygon-based worldbuilding atlas in this browser.",
    scope: "client", config: false, type: String, default: "",
  });
  game.settings.register(MODULE_ID, "worldMapBuilderWorldDraft", {
    name: "World Map Builder Shared Draft",
    hint: "Stores the polygon-based worldbuilding atlas for this Foundry world.",
    scope: "world", config: false, type: String, default: "",
  });
  game.settings.registerMenu(MODULE_ID, "openDashboard", {
    name: "Open Lore Smith",
    label: "Open Lore Smith",
    hint: "Open the Lore Smith PF2e Game Master workspace.",
    icon: "fa-solid fa-book-sparkles",
    type: LoreSmithDashboard,
    restricted: true,
  });
});

Hooks.once("ready", async () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error("Lore Smith requires the Pathfinder Second Edition system.");
    return;
  }
  Object.assign(game.loreSmith ??= {}, { open: openLoreSmith });
  try {
    await migrateSessionPrepJournals();
  } catch (error) {
    console.warn("Lore Smith | Could not clean older Session Prep Journal headings.", error);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM || game.system.id !== "pf2e") return;
  const tokenControls = controls.tokens ?? controls.find?.((control) => control.name === "token");
  const tools = tokenControls?.tools;
  if (!tools) return;
  const tool = {
    name: "lore-smith",
    title: "Lore Smith",
    icon: "fa-solid fa-book-sparkles",
    order: Object.keys(tools).length,
    button: true,
    visible: true,
    onChange: () => openLoreSmith(),
  };
  if (Array.isArray(tools)) tools.push(tool);
  else tools["lore-smith"] = tool;
});

Hooks.on("renderSceneControls", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  root?.querySelector('[data-tool="lore-smith"]')?.classList.add("lore-smith-scene-control");
});

Hooks.on("renderJournalSheet", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  if (!root || root.dataset.loreSmithSessionAudio === "true") return;
  root.dataset.loreSmithSessionAudio = "true";
  root.addEventListener("click", async (event) => {
    const button = event.target.closest?.(".ls-play-session-track");
    if (!button) return;
    event.preventDefault();
    const playlist = game.playlists.get(button.dataset.playlistId);
    const sound = playlist?.sounds?.get(button.dataset.soundId);
    if (!playlist || !sound) return ui.notifications.warn("That session song no longer exists in its Playlist.");
    if (sound.playing) await playlist.stopSound(sound);
    else await playlist.playSound(sound);
  });
});
