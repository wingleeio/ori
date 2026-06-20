import type { EditorController } from "@wingleeio/ori-core";
import { isCollapsed } from "@wingleeio/ori-core";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AtomRenderer, BlockRenderer } from "../renderers";
import { ORI_MIME, deserializeOri, htmlToBlocks, serializeSelection, textToBlocks, type ClipBlock } from "./clipboard";
import { blockElOf, buildRun, domToModel, esc, modelToDom } from "./dom";

const PLACEHOLDER = "￼";

export interface ViewOptions {
  readOnly?: boolean;
  renderAtom: (type: string) => AtomRenderer | undefined;
  renderBlock: (type: string) => BlockRenderer | undefined;
}

/**
 * Imperative contentEditable view over an {@link EditorController}. The browser
 * owns caret / selection / trackpad / menus / IME on the live text; we intercept
 * structural + cross-block edits (beforeinput) and route them through the
 * controller, let smooth in-block typing flow natively and read it back, and
 * keep the DOM selection and the controller selection in lock-step.
 */
export class EditorView {
  private roots = new Map<HTMLElement, Root>();
  private composing = false;
  private applyingModel = false;
  private detachers: Array<() => void> = [];
  /** The model revision the DOM currently reflects (so external changes — remote
   *  edits, app commands — re-render, but our own edits don't clobber the caret). */
  private lastRevision = -1;

  constructor(
    private root: HTMLElement,
    private editor: EditorController,
    private opts: ViewOptions,
  ) {
    root.setAttribute("contenteditable", opts.readOnly ? "false" : "true");
    root.setAttribute("spellcheck", opts.readOnly ? "false" : "true");
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");
    this.renderBlocks();
    this.lastRevision = this.rev();

    const on = <K extends keyof HTMLElementEventMap>(
      t: K,
      h: (e: HTMLElementEventMap[K]) => void,
      o?: AddEventListenerOptions,
    ) => {
      root.addEventListener(t, h as EventListener, o);
      this.detachers.push(() => root.removeEventListener(t, h as EventListener, o));
    };
    on("beforeinput", (e) => this.onBeforeInput(e as InputEvent));
    on("input", () => this.onInput());
    on("keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    on("blur", () => {
      // Clicking outside the editor drops the selection (so a selection toolbar
      // hides). Defer so we can ignore a window/tab blur and focus-preserving
      // clicks (e.g. toolbar buttons that re-focus the editor).
      setTimeout(() => {
        if (document.activeElement === this.root || !document.hasFocus()) return;
        const sel = this.editor.getSelection();
        if (sel && !isCollapsed(sel)) {
          this.editor.collapse(sel.focus);
          this.lastRevision = this.rev();
        }
      }, 0);
    });
    on("compositionstart", () => (this.composing = true));
    on("compositionend", () => {
      this.composing = false;
      this.onInput();
    });
    on("copy", (e) => this.onClipboard(e as ClipboardEvent, false));
    on("cut", (e) => this.onClipboard(e as ClipboardEvent, true));
    on("paste", (e) => this.onPaste(e as ClipboardEvent));

    const onSelChange = () => {
      if (this.applyingModel || this.composing) return;
      const sel = this.readSelection();
      if (!sel) return;
      this.editor.setSelection(sel);
      // DOM is already the source of truth here — record the revision so the
      // resulting React sync() doesn't write the selection back and collapse it.
      this.lastRevision = this.rev();
    };
    document.addEventListener("selectionchange", onSelChange);
    this.detachers.push(() => document.removeEventListener("selectionchange", onSelChange));
  }

  destroy() {
    this.detachers.forEach((d) => d());
    this.roots.forEach((r) => r.unmount());
    this.roots.clear();
  }

  focus() {
    this.root.focus();
    // Focusing an editable with no live range drops the caret to the start;
    // restore the model selection so a programmatic focus() (e.g. after a menu
    // command) can't strand the caret at the top of the block.
    this.writeSelection();
  }

  // --- rendering ---------------------------------------------------------

  private rev(): number {
    return this.editor.getSnapshot().revision;
  }

  /**
   * Called by React on every model change. Only re-renders when the model moved
   * ahead of what we last drew (an *external* change — app command, undo, remote);
   * our own edits already updated the DOM and must not be clobbered.
   */
  sync() {
    const rev = this.rev();
    if (rev === this.lastRevision) return;
    const changed = this.renderBlocks();
    // Restore the selection only when the re-render actually removed the live
    // selection's nodes. Otherwise we'd clobber a selection the user just made
    // (e.g. an async re-render landing mid drag-select) — collapsing it, so a
    // following Backspace would move the caret instead of deleting the range.
    if (changed && this.selectionDetached()) this.writeSelection();
    this.lastRevision = rev;
  }

  /** True when the current DOM selection's endpoints are no longer in the editor
   *  (a re-render replaced their nodes), so it must be restored from the model. */
  private selectionDetached(): boolean {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0) return true;
    return !this.root.contains(s.anchorNode) || !this.root.contains(s.focusNode);
  }

  /** After a controlled (preventDefault'd) edit: re-render + restore the caret. */
  private commit() {
    this.renderBlocks();
    this.writeSelection();
    this.lastRevision = this.rev();
  }

  /** A content signature for a block, so unchanged blocks aren't re-rendered. */
  private sig(id: string): string {
    return this.editor.getBlockType(id) + "|" + JSON.stringify(this.editor.getInline(id));
  }

  /**
   * Reconcile the DOM to the *visible window* of blocks (virtualization): only the
   * windowed blocks are rendered, and the off-screen height is represented as
   * padding on the editable (heights from the controller's offscreen measurement).
   * On-screen blocks are reused by id so a caret inside one survives a scroll.
   * Returns true if the DOM was mutated.
   */
  private renderBlocks(): boolean {
    let changed = false;
    const snap = this.editor.getSnapshot();
    const vis = snap.visible;
    const topH = vis.length ? vis[0].top : 0;
    const botH = vis.length
      ? Math.max(0, snap.totalHeight - (vis[vis.length - 1].top + vis[vis.length - 1].height))
      : Math.max(0, snap.totalHeight);

    // Virtual scroll height via padding on the editable — NOT spacer elements:
    // the caret can navigate into a contentEditable=false spacer, after which the
    // browser jumps the selection (and scroll) back to the top of the document.
    if (this.root.style.paddingTop !== `${topH}px`) this.root.style.paddingTop = `${topH}px`;
    if (this.root.style.paddingBottom !== `${botH}px`) this.root.style.paddingBottom = `${botH}px`;

    const have = new Map<string, HTMLElement>();
    for (const c of Array.from(this.root.children)) {
      const e = c as HTMLElement;
      if (e.dataset.blockId) have.set(e.dataset.blockId, e);
    }

    let prev: HTMLElement | null = null;
    for (const id of vis.map((v) => v.id)) {
      let el = have.get(id);
      if (el) {
        have.delete(id);
      } else {
        el = this.makeBlock(id);
        changed = true;
      }
      const anchor: ChildNode | null = prev ? prev.nextSibling : this.root.firstChild;
      if (anchor !== el) {
        this.root.insertBefore(el, anchor);
        changed = true;
      }
      prev = el;
    }
    for (const el of have.values()) {
      this.unmountRootsIn(el);
      el.remove();
      changed = true;
    }

    for (const vb of vis) {
      const el = this.root.querySelector(`[data-block-id="${esc(vb.id)}"]`) as HTMLElement | null;
      if (!el) continue;
      const sig = this.sig(vb.id);
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        this.renderBlockInner(el, vb.id);
        changed = true;
      }
    }
    return changed;
  }

  private makeBlock(id: string): HTMLElement {
    const el = document.createElement("div");
    el.dataset.blockId = id;
    return el;
  }


  private renderBlockInner(el: HTMLElement, id: string) {
    this.unmountRootsIn(el);
    const type = this.editor.getBlockType(id);
    el.className = `ori-block ori-block-${type}`;

    const blockRenderer = this.opts.renderBlock(type);
    if (blockRenderer) {
      el.contentEditable = "false";
      el.textContent = "";
      const root = createRoot(el);
      root.render(blockRenderer({ editor: this.editor, block: { id, type, index: 0, top: 0, height: 0 }, layout: this.editor.getLayout(id)! }) as ReactNode);
      this.roots.set(el, root);
      return;
    }
    el.contentEditable = "inherit";
    el.textContent = "";
    const items = this.editor.getInline(id);
    if (items.length === 0) {
      el.appendChild(document.createElement("br")); // keep an empty block selectable
      return;
    }
    for (const item of items) {
      if (item.atom) {
        const span = document.createElement("span");
        span.className = "ori-atom";
        span.contentEditable = "false";
        span.dataset.atom = "true";
        span.dataset.off = String(item.start);
        span.dataset.len = "1";
        el.appendChild(span);
        const renderer = this.opts.renderAtom(item.atom.type);
        if (renderer) {
          const r = createRoot(span);
          r.render(renderer({ editor: this.editor, atom: item.atom }) as ReactNode);
          this.roots.set(span, r);
        }
      } else if (item.text.includes("\n")) {
        // Render hard breaks as <br> (not raw \n in a text node, which the
        // browser won't give a caret on the new line — the Shift+Enter bug).
        let off = item.start;
        const parts = item.text.split("\n");
        parts.forEach((part, i) => {
          if (i > 0) {
            el.appendChild(this.makeBreak(off));
            off += 1;
          }
          if (part) {
            el.appendChild(buildRun({ text: part, start: off, marks: item.marks }));
            off += part.length;
          }
        });
      } else {
        el.appendChild(buildRun(item));
      }
    }
  }

  private makeBreak(off: number): HTMLElement {
    const br = document.createElement("br");
    br.dataset.off = String(off);
    br.dataset.len = "1";
    br.dataset.break = "true";
    return br;
  }

  private unmountRootsIn(el: HTMLElement) {
    for (const [node, root] of this.roots) {
      if (el === node || el.contains(node)) {
        root.unmount();
        this.roots.delete(node);
      }
    }
  }

  // --- selection ---------------------------------------------------------

  private readSelection() {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0 || !this.root.contains(s.anchorNode)) return null;
    const a = domToModel(this.root, s.anchorNode, s.anchorOffset);
    const f = domToModel(this.root, s.focusNode, s.focusOffset);
    if (!a || !f) return null;
    return { anchor: { blockId: a.blockId, offset: a.offset }, focus: { blockId: f.blockId, offset: f.offset } };
  }

  /** Push the controller's selection back into the DOM (after a model op). */
  private writeSelection() {
    const sel = this.editor.getSelection();
    if (!sel) return;
    const a = modelToDom(this.root, sel.anchor.blockId, sel.anchor.offset);
    const f = modelToDom(this.root, sel.focus.blockId, sel.focus.offset);
    if (!a || !f) return;
    const r = document.createRange();
    const s = window.getSelection();
    if (!s) return;
    this.applyingModel = true;
    try {
      r.setStart(a.node, a.offset);
      s.removeAllRanges();
      s.addRange(r);
      s.extend(f.node, f.offset);
    } catch {
      /* node detached mid-reconcile */
    } finally {
      this.applyingModel = false;
    }
  }

  /** The block text as the model sees it (atoms collapse to one placeholder). */
  private domBlockText(el: HTMLElement): string {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      if (child instanceof HTMLElement && child.dataset.atom != null) {
        out += PLACEHOLDER;
      } else if (child instanceof HTMLElement && child.dataset.break != null) {
        out += "\n";
      } else {
        out += child.textContent ?? "";
      }
    }
    return out;
  }

  // --- input -------------------------------------------------------------

  /** Formatting + history shortcuts (the browser fires these as keydown). */
  private onKeyDown(e: KeyboardEvent) {
    if (this.opts.readOnly) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const mark = ({ b: "bold", i: "italic", u: "underline", e: "code" } as const)[k];
    if (mark) {
      e.preventDefault();
      const sel = this.readSelection();
      if (sel) this.editor.setSelection(sel);
      this.editor.toggleMark(mark);
      this.commit();
    } else if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.editor.redo();
      else this.editor.undo();
      this.commit();
    } else if (k === "y") {
      e.preventDefault();
      this.editor.redo();
      this.commit();
    }
  }

  private onBeforeInput(e: InputEvent) {
    if (this.opts.readOnly) {
      e.preventDefault();
      return;
    }
    const sel = this.readSelection();
    if (!sel) return;
    this.editor.setSelection(sel);
    const collapsed = isCollapsed(sel);
    const startOffset = this.editor.orderedSelection()?.start.offset ?? sel.focus.offset;
    const t = e.inputType;

    // Native fast path: collapsed in-block typing / deletion. The browser mutates
    // a single text node; onInput reads it back. Keeps autocorrect/IME native.
    // It must NOT cover deletion of an adjacent inline atom — the browser won't
    // remove a contentEditable=false node, so it would silently no-op and jolt
    // the caret; route those through the controller instead.
    const atomAt = (off: number) =>
      this.editor.getInline(sel.focus.blockId).some((it) => it.atom != null && it.start === off);
    const blockLen = this.editor.getBlockText(sel.focus.blockId).length;
    if (collapsed && (t === "insertText" || t === "insertCompositionText" || t === "insertReplacementText")) return;
    // Forward delete is native only mid-block; at the block end it must merge the
    // next block through the controller (a native cross-block merge corrupts the
    // virtualized DOM). Backward delete is native only past offset 0 (offset 0
    // merges the previous block). Neither may consume an adjacent inline atom.
    if (collapsed && t === "deleteContentForward" && startOffset < blockLen && !atomAt(startOffset)) return;
    if (collapsed && t === "deleteContentBackward" && startOffset > 0 && !atomAt(startOffset - 1)) return;

    // Everything else (structural + cross-block) is handled through the controller.
    const ed = this.editor;
    if (t === "insertParagraph") {
      e.preventDefault();
      ed.insertParagraphBreak();
    } else if (t.startsWith("delete")) {
      e.preventDefault();
      if (t === "deleteContentForward") ed.deleteForward();
      else ed.deleteBackward();
    } else if (t === "insertText" || t === "insertReplacementText") {
      // Non-collapsed (e.g. autocorrect replacement, or typing over a selection):
      // replace the range. Paste has its own handler (onPaste).
      e.preventDefault();
      if (!collapsed) ed.deleteBackward();
      const text = e.data ?? "";
      if (text) ed.insertText(text);
    } else if (t === "insertLineBreak") {
      // Shift+Enter. A soft break ("\n" in a block) is unreliable in
      // contentEditable (the browser types before/after a trailing <br>
      // inconsistently), so in this block model it starts a new block — a clean
      // new line with a correctly-placed caret.
      e.preventDefault();
      ed.insertParagraphBreak();
    } else {
      return; // let the browser handle anything we don't model
    }
      this.commit();
  }

  private onInput() {
    if (this.composing || this.opts.readOnly) return;
    const blockEl = blockElOf(window.getSelection()?.anchorNode ?? null, this.root);
    if (!blockEl) {
      // structure changed under us (browser merged blocks) → full resync
      this.renderBlocks();
      this.lastRevision = this.rev();
      return;
    }
    const id = blockEl.dataset.blockId as string;
    const next = this.domBlockText(blockEl);
    const cur = this.editor.getBlockText(id);
    if (next === cur) return;

    // diff → splice through the controller (which infers marks at the caret)
    const max = Math.min(cur.length, next.length);
    let p = 0;
    while (p < max && cur[p] === next[p]) p++;
    let s = 0;
    while (s < max - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
    const from = p;
    const to = cur.length - s;
    const insert = next.slice(p, next.length - s);
    this.editor.setSelection({ anchor: { blockId: id, offset: from }, focus: { blockId: id, offset: to } });
    if (to > from) this.editor.deleteBackward();
    if (insert) this.editor.insertText(insert);
    // The browser already painted the text; just realign the run offsets.
    this.reindex(blockEl);
    this.lastRevision = this.rev();
  }

  /** Re-derive data-off / data-len after a native edit (no node replacement). */
  private reindex(el: HTMLElement) {
    let off = 0;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.dataset.off == null) continue;
      child.dataset.off = String(off);
      const len =
        child.dataset.atom != null || child.dataset.break != null ? 1 : (child.textContent ?? "").length;
      child.dataset.len = String(len);
      off += len;
    }
  }

  // --- clipboard ---------------------------------------------------------

  /** Copy/cut: put plain, HTML and a private (mark+type-preserving) payload on the clipboard. */
  private onClipboard(e: ClipboardEvent, isCut: boolean) {
    const blocks = this.editor.getSelectionBlocks();
    if (!blocks.length || !e.clipboardData) return;
    e.preventDefault();
    const { text, html, json } = serializeSelection(blocks);
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData(ORI_MIME, json);
    if (isCut && !this.opts.readOnly) {
      this.editor.deleteBackward();
      this.commit();
    }
  }

  /** Paste: restore marks from our payload, else parse external HTML, else plain text. */
  private onPaste(e: ClipboardEvent) {
    if (this.opts.readOnly || !e.clipboardData) return;
    e.preventDefault();
    const sel = this.readSelection();
    if (sel) {
      this.editor.setSelection(sel);
      if (!isCollapsed(sel)) this.editor.deleteBackward();
    }
    const cd = e.clipboardData;
    const ori = cd.getData(ORI_MIME);
    const html = cd.getData("text/html");
    let blocks = ori ? deserializeOri(ori) : null;
    if (!blocks?.length && html) blocks = htmlToBlocks(html);
    if (!blocks?.length) blocks = textToBlocks(cd.getData("text/plain"));
    this.pasteBlocks(blocks);
    this.commit();
  }

  private pasteBlocks(blocks: ClipBlock[]) {
    blocks.forEach((blk, i) => {
      if (i > 0) this.editor.insertParagraphBreak();
      // Adopt the pasted block type when we're filling a fresh block (a new block
      // from the break above, or an empty target) — so a pasted heading stays a
      // heading — but keep the existing type when merging into a block with text.
      const sel = this.editor.getSelection();
      const targetEmpty = sel ? this.editor.getBlockText(sel.focus.blockId).length === 0 : true;
      if (blk.items.length) this.editor.insertInline(blk.items);
      if (i > 0 || targetEmpty) this.editor.setBlockTypeAtSelection(blk.type);
    });
  }
}
