const LS_JOURNAL_MODULE_ID = "lore-smith";
const {
  ApplicationV2: LSJournalApplicationV2,
  HandlebarsApplicationMixin: LSJournalHandlebarsMixin,
  DialogV2: LSJournalDialogV2,
} = foundry.applications.api;

const lsOpenJournalEditors = new Map();

class LoreSmithRichJournalEditor extends LSJournalHandlebarsMixin(LSJournalApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-journal-editor-{id}",
    classes: ["ls-rich-journal-editor"],
    position: { width: 880, height: 740 },
    window: {
      title: "Lore Smith Journal Editor",
      icon: "fa-solid fa-book-open",
      resizable: true,
    },
    actions: {
      save: LoreSmithRichJournalEditor.saveAction,
      cancel: LoreSmithRichJournalEditor.cancelAction,
    },
  };

  static PARTS = {
    editor: { template: `modules/${LS_JOURNAL_MODULE_ID}/templates/journal-editor.hbs` },
  };

  constructor(page, journalSheet, options = {}) {
    super({ ...options, id: `lore-smith-journal-editor-${page.id}` });
    this.page = page;
    this.journalSheet = journalSheet ?? page.parent?.sheet;
    this.originalContent = page.text?.content ?? "";
    this.originalName = page.name;
    this.saving = false;
    lsOpenJournalEditors.set(page.uuid, this);
  }

  async _prepareContext(options) {
    return {
      ...await super._prepareContext(options),
      pageName: this.page.name,
      journalName: this.page.parent?.name ?? "Journal",
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const mount = this.element?.querySelector("[data-role='editor']");
    if (!mount || this.editor) return;

    const ProseMirrorElement = foundry.applications.elements.HTMLProseMirrorElement;
    this.editor = ProseMirrorElement.create({
      name: "text.content",
      value: this.originalContent,
      documentUUID: this.page.uuid,
      collaborate: false,
      toggled: false,
      height: 560,
      autofocus: true,
      classes: "ls-rich-journal-input",
    });
    mount.replaceChildren(this.editor);

    const markDirty = () => this.updateStatus();
    this.editor.addEventListener("input", markDirty);
    this.editor.addEventListener("change", markDirty);
    this.element.querySelector("[name='pageName']")?.addEventListener("input", markDirty);

    const enableWikiLinks = () => {
      if (this.wikiController || !this.editor?.isConnected) return;
      const bridge = globalThis.LoreSmithJournalWikiBridge;
      if (!bridge?.enableNativeWikiLinks) return;
      this.wikiController = bridge.enableNativeWikiLinks(
        this.journalSheet,
        this.page,
        this.editor,
        this.element,
        { persistOnChoose: false, interactiveLinks: false },
      );
    };
    this.editor.addEventListener("open", enableWikiLinks, { once: true });
    queueMicrotask(enableWikiLinks);
    setTimeout(enableWikiLinks, 100);
    this.updateStatus();
  }

  get content() {
    const value = this.editor?.value ?? this.editor?._getValue?.();
    return typeof value === "string" ? value : this.originalContent;
  }

  get pageName() {
    return this.element?.querySelector("[name='pageName']")?.value.trim() || this.page.name;
  }

  get isDirty() {
    return this.pageName !== this.originalName
      || this.content !== this.originalContent
      || Boolean(this.editor?.isDirty?.());
  }

  updateStatus(message = "") {
    const status = this.element?.querySelector("[data-role='status']");
    const wordCount = this.element?.querySelector("[data-role='word-count']");
    if (status) status.textContent = message || (this.isDirty ? "Unsaved changes" : "Saved");
    if (wordCount) {
      const scratch = document.createElement("div");
      scratch.innerHTML = this.content;
      const text = scratch.textContent?.trim() ?? "";
      wordCount.textContent = `${text ? text.split(/\s+/).length : 0} words`;
    }
  }

  async save({ close = true } = {}) {
    if (this.saving) return;
    this.saving = true;
    this.updateStatus("Saving…");
    try {
      const content = this.content;
      const name = this.pageName;
      await this.page.update({ name, "text.content": content });
      if (this.page.getFlag(LS_JOURNAL_MODULE_ID, "markdown") !== undefined) {
        await this.page.unsetFlag(LS_JOURNAL_MODULE_ID, "markdown");
      }
      this.originalContent = content;
      this.originalName = name;
      this.updateStatus("Saved");
      await this.journalSheet?.render?.(true);
      if (close) await this.close({ force: true });
    } catch (error) {
      console.error(`${LS_JOURNAL_MODULE_ID} | Could not save Journal page`, error);
      ui.notifications.error(`Could not save ${this.page.name}. See the console for details.`);
      this.updateStatus("Save failed");
    } finally {
      this.saving = false;
    }
  }

  async close(options = {}) {
    if (this.isDirty && !options.force) {
      const discard = await LSJournalDialogV2.confirm({
        window: { title: "Discard unsaved changes?" },
        content: "<p>This Journal page has unsaved changes.</p>",
        yes: { label: "Discard" },
        no: { label: "Keep editing" },
      });
      if (!discard) return this;
    }
    this.wikiController?.disconnect?.();
    this.wikiController = null;
    lsOpenJournalEditors.delete(this.page.uuid);
    return super.close(options);
  }

  static async saveAction() {
    await this.save();
  }

  static async cancelAction() {
    await this.close();
  }
}

async function lsOpenRichJournalEditor(page, journalSheet) {
  if (!page || page.type !== "text") return page?.sheet?.render(true);
  const existing = lsOpenJournalEditors.get(page.uuid);
  if (existing) {
    existing.bringToTop?.();
    return existing;
  }
  const editor = new LoreSmithRichJournalEditor(page, journalSheet);
  await editor.render(true);
  return editor;
}

globalThis.LoreSmithJournalEditor = {
  open: lsOpenRichJournalEditor,
};

Hooks.once("ready", () => {
  Object.assign(game.loreSmith ??= {}, { openJournalEditor: lsOpenRichJournalEditor });
});
