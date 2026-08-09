const LS_VOICE_MODULE_ID = "lore-smith";
const LS_VOICE_FLAG = "npcVoice";
const {
  ApplicationV2: LSVoiceApplicationV2,
  HandlebarsApplicationMixin: LSVoiceHandlebarsMixin,
  DialogV2: LSVoiceDialogV2,
} = foundry.applications.api;

function lsVoiceRoot(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
}

function lsVoiceData(actor) {
  const stored = actor.getFlag(LS_VOICE_MODULE_ID, LS_VOICE_FLAG) ?? {};
  return {
    primaryId: String(stored.primaryId ?? ""),
    samples: Array.isArray(stored.samples) ? foundry.utils.deepClone(stored.samples) : [],
  };
}

function lsVoiceDuration(milliseconds = 0) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function lsVoiceSafeName(value = "npc") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "npc";
}

function lsVoiceMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) ?? "";
}

function lsVoiceExtension(mimeType = "") {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

async function lsEnsureVoiceDirectory(actor) {
  const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!Picker?.createDirectory || !Picker?.upload) throw new Error("Foundry's file storage API is unavailable.");
  const paths = ["lore-smith", "lore-smith/npc-voices", `lore-smith/npc-voices/${actor.id}`];
  for (const path of paths) {
    try {
      await Picker.createDirectory("data", path);
    } catch (error) {
      const message = String(error?.message ?? error).toLowerCase();
      if (!message.includes("exist")) console.debug(`Lore Smith | Voice directory ${path} was not created`, error);
    }
  }
  return { Picker, path: paths.at(-1) };
}

class LoreSmithNpcVoiceRecorder extends LSVoiceHandlebarsMixin(LSVoiceApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-npc-voice-{id}",
    classes: ["lore-smith-voice-recorder"],
    position: { width: 720, height: 720 },
    window: { title: "Lore Smith NPC Voice", icon: "fa-solid fa-microphone-lines", resizable: true },
    actions: {
      requestMicrophone: LoreSmithNpcVoiceRecorder.requestMicrophone,
      startRecording: LoreSmithNpcVoiceRecorder.startRecording,
      pauseRecording: LoreSmithNpcVoiceRecorder.pauseRecording,
      resumeRecording: LoreSmithNpcVoiceRecorder.resumeRecording,
      stopRecording: LoreSmithNpcVoiceRecorder.stopRecording,
      discardDraft: LoreSmithNpcVoiceRecorder.discardDraft,
      saveRecording: LoreSmithNpcVoiceRecorder.saveRecording,
      saveSample: LoreSmithNpcVoiceRecorder.saveSample,
      makePrimary: LoreSmithNpcVoiceRecorder.makePrimary,
      downloadSample: LoreSmithNpcVoiceRecorder.downloadSample,
      deleteSample: LoreSmithNpcVoiceRecorder.deleteSample,
    },
  };

  static PARTS = {
    recorder: { template: `modules/${LS_VOICE_MODULE_ID}/templates/npc-voice-recorder.hbs` },
  };

  constructor(actor, options = {}) {
    super({ ...options, id: `lore-smith-npc-voice-${actor.id}` });
    this.actor = actor;
  }

  recordingState = "idle";
  recorder = null;
  stream = null;
  chunks = [];
  draftBlob = null;
  draftUrl = "";
  elapsedMs = 0;
  activeSince = 0;
  timer = null;
  devices = [];
  microphoneError = "";

  async _prepareContext(options) {
    const data = lsVoiceData(this.actor);
    const samples = data.samples.map((sample, index) => ({
      ...sample,
      number: index + 1,
      isPrimary: sample.id === data.primaryId,
      durationLabel: lsVoiceDuration(sample.durationMs),
    }));
    return {
      ...await super._prepareContext(options),
      actor: { name: this.actor.name, img: this.actor.img },
      samples,
      hasSamples: samples.length > 0,
      devices: this.devices,
      microphoneError: this.microphoneError,
      isIdle: this.recordingState === "idle",
      isRecording: this.recordingState === "recording",
      isPaused: this.recordingState === "paused",
      hasDraft: Boolean(this.draftBlob),
      draftUrl: this.draftUrl,
      elapsedLabel: lsVoiceDuration(this.currentElapsedMs),
      suggestedName: `Voice sample ${samples.length + 1}`,
    };
  }

  get currentElapsedMs() {
    return this.elapsedMs + (this.recordingState === "recording" ? performance.now() - this.activeSince : 0);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.refreshDevices().catch(() => {});
    this.syncRecordingUi();
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const current = this.element?.querySelector("[name='microphone']")?.value ?? "";
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
    this.devices = devices.map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
    const select = this.element?.querySelector("[name='microphone']");
    if (!select || !this.devices.length) return;
    select.replaceChildren(...this.devices.map((device) => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.label;
      option.selected = device.id === current;
      return option;
    }));
  }

  syncRecordingUi() {
    const root = this.element;
    if (!root) return;
    const recording = this.recordingState === "recording";
    const paused = this.recordingState === "paused";
    root.querySelector("[data-role='recording-status']")?.classList.toggle("active", recording);
    const status = root.querySelector("[data-role='recording-status-text']");
    if (status) status.textContent = recording ? "Recording" : paused ? "Paused" : this.draftBlob ? "Take ready" : "Ready";
    const clock = root.querySelector("[data-role='recording-time']");
    if (clock) clock.textContent = lsVoiceDuration(this.currentElapsedMs);
    for (const button of root.querySelectorAll("[data-action='startRecording']")) button.disabled = recording || paused;
    for (const button of root.querySelectorAll("[data-action='pauseRecording']")) button.disabled = !recording;
    for (const button of root.querySelectorAll("[data-action='resumeRecording']")) button.disabled = !paused;
    for (const button of root.querySelectorAll("[data-action='stopRecording']")) button.disabled = !(recording || paused);
  }

  startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.syncRecordingUi(), 250);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  cleanupStream() {
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.stream = null;
  }

  clearDraft() {
    if (this.draftUrl) URL.revokeObjectURL(this.draftUrl);
    this.draftUrl = "";
    this.draftBlob = null;
    this.elapsedMs = 0;
    this.recordingState = "idle";
  }

  async acquireMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("This browser does not provide microphone recording support.");
    const deviceId = this.element?.querySelector("[name='microphone']")?.value;
    const audio = deviceId ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false } : true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.microphoneError = "";
    await this.refreshDevices();
    return this.stream;
  }

  static async requestMicrophone() {
    try {
      await this.acquireMicrophone();
      this.cleanupStream();
      await this.refreshDevices();
      ui.notifications.info("Microphone access granted.");
    } catch (error) {
      this.microphoneError = error?.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access for Foundry, then try again." : String(error?.message ?? error);
      await this.render();
    }
  }

  static async startRecording() {
    if (["recording", "paused"].includes(this.recordingState)) return;
    this.clearDraft();
    try {
      const stream = await this.acquireMicrophone();
      const mimeType = lsVoiceMimeType();
      this.chunks = [];
      this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) this.chunks.push(event.data);
      });
      this.recorder.start(250);
      this.elapsedMs = 0;
      this.activeSince = performance.now();
      this.recordingState = "recording";
      this.startTimer();
      this.syncRecordingUi();
    } catch (error) {
      this.cleanupStream();
      this.recordingState = "idle";
      this.microphoneError = error?.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access for Foundry, then try again." : String(error?.message ?? error);
      console.error("Lore Smith | Could not start NPC voice recording", error);
      await this.render();
    }
  }

  static pauseRecording() {
    if (this.recordingState !== "recording" || this.recorder?.state !== "recording") return;
    this.elapsedMs += performance.now() - this.activeSince;
    this.recorder.pause();
    this.recordingState = "paused";
    this.syncRecordingUi();
  }

  static resumeRecording() {
    if (this.recordingState !== "paused" || this.recorder?.state !== "paused") return;
    this.recorder.resume();
    this.activeSince = performance.now();
    this.recordingState = "recording";
    this.syncRecordingUi();
  }

  static async stopRecording() {
    if (!this.recorder || !["recording", "paused"].includes(this.recordingState)) return;
    if (this.recordingState === "recording") this.elapsedMs += performance.now() - this.activeSince;
    const recorder = this.recorder;
    await new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.stop();
    });
    this.stopTimer();
    this.cleanupStream();
    this.draftBlob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || "audio/webm" });
    this.draftUrl = URL.createObjectURL(this.draftBlob);
    this.recordingState = "ready";
    this.recorder = null;
    this.chunks = [];
    await this.render();
  }

  static async discardDraft() {
    this.clearDraft();
    await this.render();
  }

  static async saveRecording() {
    if (!this.draftBlob) return;
    const name = this.element?.querySelector("[name='draftName']")?.value.trim() || "Voice sample";
    const note = this.element?.querySelector("[name='draftNote']")?.value.trim() || "";
    const saveButton = this.element?.querySelector("[data-action='saveRecording']");
    if (saveButton) saveButton.disabled = true;
    try {
      const { Picker, path } = await lsEnsureVoiceDirectory(this.actor);
      const extension = lsVoiceExtension(this.draftBlob.type);
      const filename = `${lsVoiceSafeName(this.actor.name)}-${Date.now()}.${extension}`;
      const file = new File([this.draftBlob], filename, { type: this.draftBlob.type });
      const uploaded = await Picker.upload("data", path, file, {}, { notify: true });
      if (!uploaded?.path) throw new Error("Foundry did not return a saved audio path.");
      const voice = lsVoiceData(this.actor);
      const id = foundry.utils.randomID();
      voice.samples.push({ id, name, note, path: uploaded.path, mimeType: this.draftBlob.type, durationMs: Math.round(this.elapsedMs), createdAt: Date.now() });
      if (!voice.primaryId) voice.primaryId = id;
      await this.actor.setFlag(LS_VOICE_MODULE_ID, LS_VOICE_FLAG, voice);
      this.clearDraft();
      ui.notifications.info(`${name} was saved to ${this.actor.name}.`);
      await this.render();
    } catch (error) {
      console.error("Lore Smith | Could not save NPC voice recording", error);
      ui.notifications.error(`Could not save the voice recording: ${error?.message ?? error}`);
      if (saveButton) saveButton.disabled = false;
    }
  }

  static async saveSample(_event, target) {
    const row = target.closest("[data-sample-id]");
    if (!row) return;
    const voice = lsVoiceData(this.actor);
    const sample = voice.samples.find((entry) => entry.id === row.dataset.sampleId);
    if (!sample) return;
    sample.name = row.querySelector("[name='sampleName']")?.value.trim() || sample.name;
    sample.note = row.querySelector("[name='sampleNote']")?.value.trim() || "";
    await this.actor.setFlag(LS_VOICE_MODULE_ID, LS_VOICE_FLAG, voice);
    ui.notifications.info("Voice reference updated.");
    await this.render();
  }

  static async makePrimary(_event, target) {
    const id = target.closest("[data-sample-id]")?.dataset.sampleId;
    if (!id) return;
    const voice = lsVoiceData(this.actor);
    if (!voice.samples.some((sample) => sample.id === id)) return;
    voice.primaryId = id;
    await this.actor.setFlag(LS_VOICE_MODULE_ID, LS_VOICE_FLAG, voice);
    await this.render();
  }

  static downloadSample(_event, target) {
    const row = target.closest("[data-sample-id]");
    const voice = lsVoiceData(this.actor);
    const sample = voice.samples.find((entry) => entry.id === row?.dataset.sampleId);
    if (!sample?.path) return;
    const link = document.createElement("a");
    link.href = sample.path;
    link.download = `${lsVoiceSafeName(sample.name)}.${lsVoiceExtension(sample.mimeType)}`;
    link.target = "_blank";
    link.click();
  }

  static async deleteSample(_event, target) {
    const id = target.closest("[data-sample-id]")?.dataset.sampleId;
    const voice = lsVoiceData(this.actor);
    const sample = voice.samples.find((entry) => entry.id === id);
    if (!sample) return;
    const confirmed = await LSVoiceDialogV2.confirm({
      window: { title: "Remove voice reference?" },
      content: `<p>Remove <strong>${foundry.utils.escapeHTML(sample.name)}</strong> from ${foundry.utils.escapeHTML(this.actor.name)}?</p><p>The audio file will remain in Foundry Data storage so it is not destroyed accidentally.</p>`,
      yes: { label: "Remove reference" }, no: { label: "Cancel" },
    });
    if (!confirmed) return;
    voice.samples = voice.samples.filter((entry) => entry.id !== id);
    if (voice.primaryId === id) voice.primaryId = voice.samples[0]?.id ?? "";
    await this.actor.setFlag(LS_VOICE_MODULE_ID, LS_VOICE_FLAG, voice);
    await this.render();
  }

  async close(options = {}) {
    if (["recording", "paused"].includes(this.recordingState) && !options.force) {
      const confirmed = await LSVoiceDialogV2.confirm({
        window: { title: "Discard current recording?" }, content: "<p>The current recording has not been saved.</p>",
        yes: { label: "Discard and close" }, no: { label: "Keep recording" },
      });
      if (!confirmed) return this;
    }
    this.stopTimer();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.cleanupStream();
    if (this.draftUrl) URL.revokeObjectURL(this.draftUrl);
    return super.close(options);
  }
}

function lsAddNpcVoiceButton(app, html) {
  if (!game.user.isGM || game.system.id !== "pf2e") return;
  const actor = app.actor ?? app.document ?? app.object;
  if (actor?.documentName !== "Actor" || actor.type !== "npc") return;
  const root = lsVoiceRoot(html);
  if (!root) return;
  const header = root.closest(".app")?.querySelector(".window-header") ?? root.querySelector(".window-header");
  if (!header || header.querySelector("[data-lore-smith-voice]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon lore-smith-sheet-voice";
  button.dataset.loreSmithVoice = actor.id;
  button.dataset.tooltip = "Record or play this NPC's voice";
  button.setAttribute("aria-label", "Open NPC voice recorder");
  button.innerHTML = '<i class="fa-solid fa-microphone-lines"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    new LoreSmithNpcVoiceRecorder(actor).render(true);
  });
  const close = header.querySelector('[data-action="close"], .close');
  header.insertBefore(button, close ?? null);
}

Hooks.on("renderActorSheet", lsAddNpcVoiceButton);
Hooks.on("renderApplicationV2", lsAddNpcVoiceButton);

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") return;
  Object.assign(game.loreSmith ??= {}, { openNpcVoiceRecorder: (actor) => new LoreSmithNpcVoiceRecorder(actor).render(true) });
});
