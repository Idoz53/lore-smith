import { basicSetup } from "codemirror";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, keymap, placeholder } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import MarkdownIt from "markdown-it";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const MODULE_ID = "lore-smith";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const markdownRenderer = new MarkdownIt({ html: true, linkify: true, breaks: false });
const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
turndown.use(gfm);
turndown.addRule("foundryContentLink", {
  filter: (node) => node.nodeName === "A" && node.classList?.contains("content-link") && Boolean(node.dataset?.uuid),
  replacement: (_content, node) => `@UUID[${node.dataset.uuid}]{${node.textContent ?? "Link"}}`,
});

function pageMarkdown(page) {
  const saved = page.getFlag?.(MODULE_ID, "markdown");
  if (typeof saved === "string") return saved;
  const html = page.text?.content ?? "";
  return html.trim() ? turndown.turndown(html) : "";
}

function wikiAtPosition(state, position) {
  const line = state.doc.lineAt(position);
  const expression = /\[\[([^\]\n]{1,160})\]\]/g;
  for (const match of line.text.matchAll(expression)) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position >= from && position <= to) return { from, to, name: match[1].trim() };
  }
  return null;
}

function wikiDecorations(view) {
  const decorations = [];
  const head = view.state.selection.main.head;
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    const expression = /\[\[([^\]\n]{1,160})\]\]/g;
    for (const match of text.matchAll(expression)) {
      const from = range.from + match.index;
      const to = from + match[0].length;
      const active = head >= from && head <= to;
      if (active) {
        decorations.push(Decoration.mark({ class: "ls-cm-wiki-source" }).range(from, to));
      } else {
        decorations.push(Decoration.replace({}).range(from, from + 2));
        decorations.push(Decoration.mark({ class: "ls-cm-wiki-link" }).range(from + 2, to - 2));
        decorations.push(Decoration.replace({}).range(to - 2, to));
      }
    }
  }
  decorations.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(decorations, true);
}

const wikiPreview = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = wikiDecorations(view);
  }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = wikiDecorations(update.view);
    }
  }
}, {
  decorations: (value) => value.decorations,
  eventHandlers: {
    mousedown(event, view) {
      if (event.ctrlKey || event.metaKey) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position == null) return false;
      const wiki = wikiAtPosition(view.state, position);
      if (!wiki?.name) return false;
      event.preventDefault();
      void view.dom.closest(".ls-markdown-journal-editor")?.loreSmithApp?.followWikiLink(wiki.name);
      return true;
    },
  },
});

function wrapSelection(view, before, after = before, fallback = "text") {
  const changes = [];
  const ranges = [];
  for (const range of view.state.selection.ranges) {
    const selected = view.state.sliceDoc(range.from, range.to) || fallback;
    const insert = `${before}${selected}${after}`;
    changes.push({ from: range.from, to: range.to, insert });
    ranges.push(EditorState.selection.range(
      range.from + before.length,
      range.from + before.length + selected.length,
    ));
  }
  view.dispatch({ changes, selection: EditorState.selection.create(ranges), scrollIntoView: true });
  view.focus();
}

function prefixLines(view, prefix) {
  const range = view.state.selection.main;
  const first = view.state.doc.lineAt(range.from);
  const last = view.state.doc.lineAt(range.to);
  const changes = [];
  for (let number = first.number; number <= last.number; number += 1) {
    changes.push({ from: view.state.doc.line(number).from, insert: prefix });
  }
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

class LoreSmithMarkdownJournalEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lore-smith-journal-editor-{id}",
    classes: ["ls-markdown-journal-editor"],
    position: { width: 860, height: 720 },
    window: { title: "Lore Smith Journal Editor", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      save: LoreSmithMarkdownJournalEditor.saveAction,
      cancel: LoreSmithMarkdownJournalEditor.cancelAction,
    },
  };

  static PARTS = {
    editor: { template: `modules/${MODULE_ID}/templates/journal-editor.hbs` },
  };

  constructor(page, journalSheet, options = {}) {
    super({ ...options, id: `lore-smith-journal-editor-${page.id}` });
    this.page = page;
    this.journalSheet = journalSheet ?? page.parent?.sheet;
    this.source = pageMarkdown(page);
    this.originalSource = this.source;
    this.dirty = false;
    this.saving = false;
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
    if (!mount || this.view) return;
    this.element.loreSmithApp = this;
    const wikiCompletion = (completionContext) => {
      const before = completionContext.state.doc.sliceString(
        completionContext.state.doc.lineAt(completionContext.pos).from,
        completionContext.pos,
      );
      const match = before.match(/\[\[([^\]\n]*)$/);
      if (!match) return null;
      const query = match[1].trim().toLocaleLowerCase();
      const names = this.page.parent.pages
        .filter((candidate) => candidate.type === "text" && candidate.id !== this.page.id)
        .map((candidate) => candidate.name)
        .sort((left, right) => {
          const leftStarts = left.toLocaleLowerCase().startsWith(query) ? 0 : 1;
          const rightStarts = right.toLocaleLowerCase().startsWith(query) ? 0 : 1;
          return leftStarts - rightStarts || left.localeCompare(right);
        });
      const exact = names.some((name) => name.localeCompare(match[1].trim(), undefined, { sensitivity: "accent" }) === 0);
      const options = names.map((name) => ({ label: name, type: "text", detail: "Journal page", apply: `${name}]]` }));
      if (match[1].trim() && !exact) {
        options.unshift({ label: match[1].trim(), type: "keyword", detail: "Create page", apply: `${match[1].trim()}]]` });
      }
      return { from: completionContext.pos - match[1].length, options, validFor: /^[^\]\n]*$/ };
    };
    const shortcuts = keymap.of([
      { key: "Ctrl-s", mac: "Cmd-s", preventDefault: true, run: () => { void this.save(); return true; } },
      { key: "Ctrl-b", mac: "Cmd-b", preventDefault: true, run: (view) => { wrapSelection(view, "**", "**", "bold text"); return true; } },
      { key: "Ctrl-i", mac: "Cmd-i", preventDefault: true, run: (view) => { wrapSelection(view, "*", "*", "italic text"); return true; } },
      { key: "Ctrl-u", mac: "Cmd-u", preventDefault: true, run: (view) => { wrapSelection(view, "<u>", "</u>", "underlined text"); return true; } },
      { key: "[", run: (view) => {
        const range = view.state.selection.main;
        if (!range.empty || view.state.sliceDoc(Math.max(0, range.head - 1), range.head) !== "[") return false;
        view.dispatch({ changes: { from: range.head, insert: "[]]" }, selection: { anchor: range.head + 1 } });
        queueMicrotask(() => startCompletion(view));
        return true;
      } },
      indentWithTab,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]);
    this.view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: this.source,
        extensions: [
          basicSetup,
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          placeholder("Write your chronicle… Type [[ to link another page."),
          autocompletion({ override: [wikiCompletion], activateOnTyping: true }),
          wikiPreview,
          Prec.high(shortcuts),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.source = update.state.doc.toString();
            this.dirty = this.source !== this.originalSource;
            this.updateStatus();
          }),
        ],
      }),
    });
    this.bindToolbar();
    this.updateStatus();
    queueMicrotask(() => this.view?.focus());
  }

  updateStatus(message = "") {
    const status = this.element?.querySelector("[data-role='status']");
    const count = this.element?.querySelector("[data-role='word-count']");
    if (status) status.textContent = message || (this.dirty ? "Unsaved changes" : "Saved");
    if (count) count.textContent = `${this.source.trim() ? this.source.trim().split(/\s+/).length : 0} words`;
  }

  bindToolbar() {
    this.element?.querySelector("[name='pageName']")?.addEventListener("input", () => {
      this.dirty = true;
      this.updateStatus();
    });
    this.element?.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => {
      const command = button.dataset.format;
      const view = this.view;
      if (!view) return;
      if (command === "bold") wrapSelection(view, "**", "**", "bold text");
      else if (command === "italic") wrapSelection(view, "*", "*", "italic text");
      else if (command === "underline") wrapSelection(view, "<u>", "</u>", "underlined text");
      else if (command === "strike") wrapSelection(view, "~~", "~~", "struck text");
      else if (command === "code") wrapSelection(view, "`", "`", "code");
      else if (command === "link") wrapSelection(view, "[", "](https://)", "link text");
      else if (command === "wiki") { wrapSelection(view, "[[", "]]", "Page name"); startCompletion(view); }
      else if (command === "h1") prefixLines(view, "# ");
      else if (command === "h2") prefixLines(view, "## ");
      else if (command === "h3") prefixLines(view, "### ");
      else if (command === "bullet") prefixLines(view, "- ");
      else if (command === "number") prefixLines(view, "1. ");
      else if (command === "quote") prefixLines(view, "> ");
      else if (command === "divider") view.dispatch({ changes: { from: view.state.selection.main.head, insert: "\n\n---\n\n" } });
      else if (command === "table") view.dispatch({ changes: { from: view.state.selection.main.head, insert: "\n| Column | Column |\n| --- | --- |\n| Value | Value |\n" } });
    }));
    this.element?.querySelector("[data-format='image']")?.addEventListener("click", () => this.insertImage());
  }

  insertImage() {
    const callback = (path) => {
      if (!path || !this.view) return;
      const position = this.view.state.selection.main.head;
      this.view.dispatch({ changes: { from: position, insert: `![Image](${path})` }, selection: { anchor: position + path.length + 10 } });
      this.view.focus();
    };
    try {
      const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker?.implementation ?? globalThis.FilePicker;
      if (!Picker) throw new Error("File picker is unavailable");
      new Picker({ type: "image", callback }).browse();
    } catch (error) {
      console.error(`${MODULE_ID} | Could not open image picker`, error);
      ui.notifications.warn("Foundry's image picker could not be opened in this version.");
    }
  }

  async save({ close = true } = {}) {
    if (this.saving) return;
    this.saving = true;
    this.updateStatus("Saving…");
    try {
      const name = this.element?.querySelector("[name='pageName']")?.value.trim() || this.page.name;
      const html = markdownRenderer.render(this.source);
      await this.page.update({
        name,
        "text.content": html,
        [`flags.${MODULE_ID}.markdown`]: this.source,
      });
      this.originalSource = this.source;
      this.dirty = false;
      this.updateStatus("Saved");
      await this.journalSheet?.render?.(true);
      if (close) await this.close();
    } finally {
      this.saving = false;
    }
  }

  async followWikiLink(name) {
    if (this.dirty) await this.save({ close: false });
    let target = this.page.parent.pages.find((candidate) => candidate.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (!target) {
      [target] = await this.page.parent.createEmbeddedDocuments("JournalEntryPage", [{ name, type: "text", text: { content: "" } }]);
      ui.notifications.info(`Created page "${name}" inside ${this.page.parent.name}.`);
    }
    await this.close();
    await this.journalSheet?.render?.(true);
    await this.journalSheet?.goToPage?.(target.id);
  }

  async close(options = {}) {
    if (this.dirty && !options?.force) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Discard unsaved changes?" },
        content: "<p>This Journal page has unsaved changes.</p>",
        yes: { label: "Discard" },
        no: { label: "Keep editing" },
      });
      if (!confirmed) return;
    }
    this.view?.destroy();
    this.view = null;
    return super.close(options);
  }

  static async saveAction() { await this.save(); }
  static async cancelAction() { await this.close(); }
}

async function openJournalMarkdownEditor(page, journalSheet) {
  if (!page || page.type !== "text") return page?.sheet?.render(true);
  const id = `lore-smith-journal-editor-${page.id}`;
  const existing = foundry.applications.instances?.get?.(id) ?? Object.values(ui.windows ?? {}).find((app) => app.id === id);
  if (existing) return existing.bringToTop?.();
  return new LoreSmithMarkdownJournalEditor(page, journalSheet).render(true);
}

globalThis.LoreSmithJournalEditor = Object.freeze({
  open: openJournalMarkdownEditor,
  markdownToHtml: (source) => markdownRenderer.render(source),
  htmlToMarkdown: (html) => turndown.turndown(html),
});

Hooks.once("ready", () => {
  Object.assign(game.loreSmith ??= {}, { openJournalEditor: openJournalMarkdownEditor });
});
