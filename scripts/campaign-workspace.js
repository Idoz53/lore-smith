// The public workspace API stays stable for the dashboard and older linked Session Prep drafts.
import { ensureCampaignWorkspace as ensureLegacyWorkspace } from "./campaign-workspace-legacy.js";
import { ensureEntryPlanner, renderEntryPlanner, syncEntryPlanner, bindEntryPlanner, entryPlannerPages } from "./campaign-planner.js";
export * from "./campaign-workspace-legacy.js";
export function ensureCampaignWorkspace(campaign) {
  const workspace = ensureLegacyWorkspace(campaign);
  return ensureEntryPlanner(campaign, workspace);
}
export function renderCampaignWorkspace(campaign, state = {}) {
  ensureCampaignWorkspace(campaign);
  return renderEntryPlanner(campaign, state);
}
export function syncCampaignWorkspace(campaign, root) {
  ensureCampaignWorkspace(campaign);
  return syncEntryPlanner(campaign, root);
}
export function bindCampaignWorkspace(app) { bindEntryPlanner(app); }
export function campaignWorkspaceJournalPages(campaign) {
  ensureCampaignWorkspace(campaign);
  return entryPlannerPages(campaign);
}
