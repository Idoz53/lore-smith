const MODULE_ID = "lore-smith";
const BUTTON_ID = "lore-smith-launcher";

let playerListObserver;
let bodyObserver;

function positionLauncher(button) {
  const playerList = document.querySelector("#players");
  const playerBounds = playerList
    ? [playerList, ...playerList.querySelectorAll("*")].map((element) => element.getBoundingClientRect?.()).filter(Boolean)
    : [];
  const playerRect = playerList?.getBoundingClientRect?.();
  const contentRight = playerRect ? playerRect.left + Math.max(160, playerList.scrollWidth) : 0;
  const playerListRight = Math.max(contentRight, playerBounds.reduce((right, rect) => Math.max(right, rect.right), 0));
  const left = Math.min(window.innerWidth - 60, Math.max(16, Math.ceil(playerListRight) + 16));
  button.style.left = `${left}px`;
}

function openLoreSmith() {
  const open = game.loreSmith?.open;
  if (typeof open === "function") {
    open();
    return;
  }
  console.error(`${MODULE_ID} | The permanent launcher loaded, but game.loreSmith.open is unavailable.`);
}

function mountLoreSmithLauncher() {
  if (!game.user?.isGM || game.system?.id !== "pf2e" || !document.body) return;

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.title = "Open Lore Smith";
    button.setAttribute("aria-label", "Open Lore Smith");
    button.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i><span>Lore Smith</span>';

    // Critical placement is inline so the launcher remains visible even if Foundry has stale CSS cached.
    Object.assign(button.style, {
      position: "fixed",
      zIndex: "100000",
      width: "44px",
      height: "44px",
      minWidth: "44px",
      bottom: "18px",
      display: "grid",
      placeItems: "center",
      padding: "0",
      color: "#ffe3a3",
      background: "linear-gradient(145deg, #7d281f, #401714)",
      border: "2px solid #d19a3d",
      borderRadius: "7px",
      boxShadow: "0 3px 10px #000b, inset 0 0 0 1px #2b100e",
      cursor: "pointer",
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLoreSmith();
    });
    document.body.append(button);
  }

  positionLauncher(button);
  requestAnimationFrame(() => positionLauncher(button));

  playerListObserver?.disconnect();
  const playerList = document.querySelector("#players");
  if (playerList && typeof ResizeObserver !== "undefined") {
    playerListObserver = new ResizeObserver(() => positionLauncher(button));
    playerListObserver.observe(playerList);
  }

  if (button.dataset.loreSmithResizeBound !== "true") {
    button.dataset.loreSmithResizeBound = "true";
    window.addEventListener("resize", () => positionLauncher(button));
  }
}

Hooks.once("ready", () => {
  mountLoreSmithLauncher();
  bodyObserver?.disconnect();
  bodyObserver = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) mountLoreSmithLauncher();
  });
  bodyObserver.observe(document.body, { childList: true });
});

if (game.ready) queueMicrotask(mountLoreSmithLauncher);

Hooks.on("canvasReady", mountLoreSmithLauncher);
Hooks.on("renderSceneControls", mountLoreSmithLauncher);
