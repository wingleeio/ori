import type { EditorController, VisibleBlock } from "@wingleeio/ori-core";
import { isCollapsed } from "@wingleeio/ori-core";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AtomRenderer, BlockRenderer } from "../renderers";
import { ORI_MIME, deserializeOri, htmlToBlocks, serializeSelection, textToBlocks, type ClipBlock } from "./clipboard";
import { BLOCK_SEL, blockElOf, buildRun, domToModel, esc, modelToDom } from "./dom";

const PLACEHOLDER = "￼";

/** A model position in the view layer (mirrors the controller's Position). */
type Pos = { blockId: string; offset: number };

/** Floating UI that "belongs" to the editor: a tap/focus into one of these must
 *  not drop the editor's selection (toolbar, slash/mention menu, a popover they
 *  open). Role-based so portaled popovers (e.g. Radix role="menu") match too. */
const OVERLAY_SELECTOR =
  '[data-ori-overlay],[role="menu"],[role="menuitem"],[role="listbox"],[role="dialog"]';

function inOverlay(node: EventTarget | Node | null): boolean {
  // `Element` (not `HTMLElement`) so an SVG icon inside a button still matches —
  // tapping a toolbar icon's <path> reports an SVGElement target.
  return node instanceof Element && node.closest(OVERLAY_SELECTOR) != null;
}

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
  /** The block being composed in, and its model text when composition began —
   *  so a concurrent edit to that same block can be detected at compositionend. */
  private composeBlockId: string | null = null;
  private composeBaseText: string | null = null;
  /** A non-collapsed range dragged from within this editor (for move-drops). */
  private dragSource: { anchor: Pos; focus: Pos } | null = null;
  /** The most recent pointer-down target (to detect taps into editor overlays
   *  even when the tap didn't move focus there — common on iOS Safari). */
  private lastPointerTarget: EventTarget | null = null;
  private applyingModel = false;
  private detachers: Array<() => void> = [];
  /** The model revision the DOM currently reflects (so external changes — remote
   *  edits, app commands — re-render, but our own edits don't clobber the caret). */
  private lastRevision = -1;
  /** True after Cmd+A: the *model* selection is the whole document (only the
   *  rendered window can be highlighted in the DOM), so selectionchange must not
   *  clobber it back to the visible range. Cleared when the user re-selects. */
  private allSelected = false;

  constructor(
    private root: HTMLElement,
    private editor: EditorController,
    private opts: ViewOptions,
  ) {
    root.setAttribute("contenteditable", opts.readOnly ? "false" : "true");
    root.setAttribute("spellcheck", opts.readOnly ? "false" : "true");
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");
    // A read-only (contenteditable=false) surface isn't focusable by default, so
    // it would never receive the Cmd+A keydown — and the native fallback copies
    // only the rendered window. Make it focusable so select-all/copy work whole.
    if (opts.readOnly) root.tabIndex = 0;
    else root.removeAttribute("tabindex");
    this.renderBlocks();
    this.lastRevision = this.rev();
    // If this view is replacing a previous one on the *same* focused element (a
    // readOnly/editor prop change), the previous destroy() cleared the DOM and
    // collapsed the browser selection onto the empty root. Restore the caret from
    // the controller so the next keystroke isn't read from offset 0.
    if (document.activeElement === root) this.writeSelection();

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
      // hides). Capture the pointer-overlay state *now*, synchronously: this blur
      // fires during the pointer-down that caused it, before the matching
      // pointerup clears lastPointerTarget — so it still reflects the element the
      // user pressed. (A focus-preserving overlay click fires no blur at all, so
      // its pointer target can't leak into a later keyboard/programmatic blur.)
      const pointerInOverlay = inOverlay(this.lastPointerTarget);
      // Defer the rest so we can ignore a window/tab blur and focus-preserving
      // clicks (toolbar buttons that re-focus the editor), and read the settled
      // activeElement.
      setTimeout(() => {
        if (document.activeElement === this.root || !document.hasFocus()) return;
        // A tap/focus into an editor-owned overlay (selection toolbar, slash /
        // mention menu) or a floating menu/dialog it opens must NOT collapse the
        // selection — otherwise opening the toolbar's block-type dropdown (whose
        // content is portaled *outside* the toolbar) instantly hides it. Check
        // both the settled focus and the press target: on iOS a tap often doesn't
        // move focus, so activeElement is still <body>.
        if (pointerInOverlay || inOverlay(document.activeElement)) return;
        const sel = this.editor.getSelection();
        if (sel && !isCollapsed(sel)) {
          this.editor.collapse(sel.focus);
          this.lastRevision = this.rev();
        }
      }, 0);
    });
    on("compositionstart", () => {
      // Composing after Cmd+A replaces the whole document: delete it first so the
      // IME composes into a single empty block (the DOM range only covers the
      // window, so the browser alone would leave off-screen blocks behind).
      if (this.allSelected) {
        this.allSelected = false;
        this.editor.selectAll();
        this.editor.deleteBackward();
        this.editor.demoteEmptyBlock();
        this.commit();
      }
      this.composing = true;
      const el = blockElOf(window.getSelection()?.anchorNode ?? null, this.root);
      this.composeBlockId = el?.dataset.blockId ?? null;
      this.composeBaseText = this.composeBlockId ? this.editor.getBlockText(this.composeBlockId) : null;
    });
    on("compositionend", () => {
      this.composing = false;
      const id = this.composeBlockId;
      // Did a concurrent edit (remote / app command) touch the block we were
      // composing in? Its model text would have moved out from under the IME.
      const sameBlockChanged =
        id != null && this.composeBaseText != null && this.editor.getBlockText(id) !== this.composeBaseText;
      this.composeBlockId = null;
      this.composeBaseText = null;
      if (sameBlockChanged) {
        // The composing DOM can't be safely diffed against the moved model
        // (onInput would mistake the external edit for text to delete). Re-render
        // from the model: the committed edit wins; the half-typed IME text is
        // dropped rather than silently reverting someone else's change.
        this.commit();
        return;
      }
      this.onInput();
      // Reconcile from the model now that composition is over: renderBlocks is
      // sig-based, so it repaints the just-composed block (applying any marks the
      // browser didn't draw) plus any *other* block changed during composition
      // (deferred so it wouldn't disrupt the IME). Correct even if React never
      // drove sync() before now. writeSelection restores the caret after the
      // composing block's nodes are replaced.
      const rendered = this.renderBlocks();
      const sel = this.editor.getSelection();
      if (sel && (rendered.has(sel.anchor.blockId) || rendered.has(sel.focus.blockId))) this.writeSelection();
      this.lastRevision = this.rev();
    });
    on("copy", (e) => this.onClipboard(e as ClipboardEvent, false));
    on("cut", (e) => this.onClipboard(e as ClipboardEvent, true));
    on("paste", (e) => this.onPaste(e as ClipboardEvent));
    on("dragstart", (e) => {
      // Remember a range dragged from within the editor so a move-drop can
      // delete the source (otherwise an internal drag would duplicate text).
      const sel = this.editor.getSelection();
      if (!sel || isCollapsed(sel)) {
        this.dragSource = null;
        return;
      }
      this.dragSource = { anchor: sel.anchor, focus: sel.focus };
      // Write the same rich payload copy does, so dropping (here or in another
      // editor) restores marks + atoms instead of the browser's plain DOM text.
      const dt = (e as DragEvent).dataTransfer;
      const blocks = this.editor.getSelectionBlocks();
      if (dt && blocks.length) {
        const { text, html, json } = serializeSelection(blocks);
        dt.setData("text/plain", text);
        dt.setData("text/html", html);
        dt.setData(ORI_MIME, json);
      }
    });
    on("dragend", () => (this.dragSource = null));
    on("dragover", (e) => {
      // Allow dropping text onto the editor (so `drop` fires for us to handle).
      if (!this.opts.readOnly) e.preventDefault();
    });
    on("drop", (e) => this.onDrop(e as DragEvent));

    const onSelChange = () => {
      if (this.applyingModel || this.composing) return;
      const sel = this.readSelection();
      if (!sel) return;
      // After Cmd+A the model holds the whole-document selection; the DOM can
      // only show the rendered window. Keep it while the DOM still spans that
      // whole window (the select-all feedback range). A collapse or a narrowing
      // (shift-click / drag) means the user re-selected → resume DOM→model sync.
      if (this.allSelected) {
        if (this.domSelectionSpansWindow(sel)) return;
        this.allSelected = false;
      }
      this.editor.setSelection(sel);
      // DOM is already the source of truth here — record the revision so the
      // resulting React sync() doesn't write the selection back and collapse it.
      this.lastRevision = this.rev();
    };
    document.addEventListener("selectionchange", onSelChange);
    this.detachers.push(() => document.removeEventListener("selectionchange", onSelChange));

    // Record where the last pointer went down so the blur handler can tell a tap
    // into an editor overlay from a tap that should drop the selection — iOS
    // taps frequently don't move focus, so activeElement alone is unreliable.
    // Cleared on pointerup so the target can never outlive its own gesture and
    // wrongly exempt a later keyboard/programmatic blur.
    const onPointerDown = (e: Event) => {
      this.lastPointerTarget = e.target;
      // Dismiss a live selection (hiding the selection toolbar) when a press
      // lands outside the editor AND outside any overlay *while the editor is
      // already unfocused* — e.g. dismissing the block-type dropdown by clicking
      // away. No editor blur fires in that case (focus already left into the
      // overlay), so the blur handler alone would leave the toolbar stuck.
      if (document.activeElement === this.root) return; // focused → blur handles it
      const t = e.target;
      if ((t instanceof Node && this.root.contains(t)) || inOverlay(t)) return;
      const sel = this.editor.getSelection();
      if (sel && !isCollapsed(sel)) {
        this.editor.collapse(sel.focus);
        this.lastRevision = this.rev();
      }
    };
    const onPointerUp = () => (this.lastPointerTarget = null);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    this.detachers.push(() => document.removeEventListener("pointerdown", onPointerDown, true));
    this.detachers.push(() => document.removeEventListener("pointerup", onPointerUp, true));
  }

  destroy() {
    this.detachers.forEach((d) => d());
    this.roots.forEach((r) => this.scheduleUnmount(r));
    this.roots.clear();
    // Drop the rendered blocks so a view re-created on this same element (a
    // readOnly toggle, an `editor` swap, or a StrictMode remount) starts clean
    // instead of reusing nodes whose React roots are being torn down — which
    // would blank out inline atoms and custom block renderers.
    this.root.replaceChildren();
    this.root.style.paddingTop = "";
    this.root.style.paddingBottom = "";
  }

  /**
   * Unmount a React root off the current task. Calling `root.unmount()`
   * synchronously can land inside a React render/commit (e.g. an enclosing
   * re-render drove this reconcile), which logs "Attempted to synchronously
   * unmount a root while React was already rendering" and risks a torn tree.
   */
  private scheduleUnmount(root: Root) {
    queueMicrotask(() => {
      try {
        root.unmount();
      } catch {
        /* already unmounted */
      }
    });
  }

  focus() {
    this.root.focus();
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
    // Never reconcile the DOM mid-composition: replacing the composing text's
    // nodes corrupts the IME (notably iOS autocorrect/predictive text, which
    // then deletes or duplicates characters). compositionend reconciles instead.
    if (this.composing) return;
    const rev = this.rev();
    if (rev === this.lastRevision) return;
    const rendered = this.renderBlocks();
    // Compensate the scroll for any height change above the viewport (lazy
    // measurement resolving an estimate), so the content being read doesn't jump.
    this.applyScrollAdjust();
    // Restore the DOM selection from the model only when the re-render actually
    // re-rendered the *selection's own block* — its nodes were replaced, so the
    // model is authoritative (e.g. an app command edited that block). When some
    // other block re-rendered, the live selection is untouched and must be left
    // alone, or we'd collapse a selection the user just made (then a Backspace
    // would move the caret instead of deleting the range).
    const sel = this.editor.getSelection();
    if (sel && (rendered.has(sel.anchor.blockId) || rendered.has(sel.focus.blockId))) this.writeSelection();
    this.lastRevision = rev;
  }

  /** The scrolling ancestor (the editable lives inside it). */
  private scroller(): HTMLElement | null {
    return this.root.closest(".ori-scroller") as HTMLElement | null;
  }

  /**
   * Apply the controller's accumulated scroll compensation: measurement that
   * changed block heights above the viewport shifts the content, and the
   * controller reports the net shift (model-based, so it's correct even when the
   * anchor block isn't mounted). Adding it to scrollTop keeps the reading
   * position fixed. Re-firing onScroll converges (heights are now stable).
   */
  private applyScrollAdjust(): void {
    const adj = this.editor.takeScrollAdjust();
    if (!adj) return;
    const sc = this.scroller();
    if (sc) sc.scrollTop += adj;
  }

  /** After a controlled (preventDefault'd) edit: re-render + restore the caret. */
  private commit() {
    this.renderBlocks();
    this.writeSelection();
    this.lastRevision = this.rev();
  }

  /** A content signature for a block, so unchanged blocks aren't re-rendered. */
  private sig(id: string): string {
    const type = this.editor.getBlockType(id);
    let s = type + "|" + JSON.stringify(this.editor.getInline(id));
    if (this.opts.renderBlock(type)) {
      // Atomic blocks carry no inline text, so a resize (height change) or an
      // attrs edit wouldn't change the signature and the block would be skipped.
      // Fold its measured height + attrs in so those re-render and re-pin height.
      s += "|" + (this.editor.getLayout(id)?.height ?? 0) + "|" + JSON.stringify(this.editor.getBlockAttrs(id));
    }
    return s;
  }

  /**
   * Reconcile the DOM to the *visible window* of blocks (virtualization): only the
   * windowed blocks are rendered, and the off-screen height is represented as
   * padding on the editable (heights from the controller's offscreen measurement).
   * On-screen blocks are reused by id so a caret inside one survives a scroll.
   * Returns the set of block ids whose *content* was (re-)rendered this pass.
   */
  private renderBlocks(): Set<string> {
    const rendered = new Set<string>();
    const snap = this.editor.getSnapshot();
    const vis = snap.visible;
    const topH = vis.length ? vis[0].top : 0;
    // A block's slot is its spacing (top margin) + content height. The last
    // visible block's content bottom sits at top + spacing + height, so the
    // bottom spacer is the remaining height below that — anything else would
    // double-count the gap the block already draws as its own top margin.
    const last = vis[vis.length - 1];
    const botH = vis.length
      ? Math.max(0, snap.totalHeight - (last.top + last.height + last.spacing))
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
      }
      const anchor: ChildNode | null = prev ? prev.nextSibling : this.root.firstChild;
      if (anchor !== el) this.root.insertBefore(el, anchor);
      prev = el;
    }
    for (const el of have.values()) {
      this.unmountRootsIn(el);
      el.remove();
    }

    for (const vb of vis) {
      const el = this.root.querySelector(`[data-block-id="${esc(vb.id)}"]`) as HTMLElement | null;
      if (!el) continue;
      // Inter-block spacing is the block's top margin (the gap *above* it), so a
      // heading owns its section break. It rides virtualization and matches the
      // slot height the controller reserved (content + spacing) — the first
      // block reports spacing 0, so there's no leading gap to collapse. Margin
      // (not padding) keeps the block's own text flush with its top-left, which
      // Pretext's caret/selection geometry assumes.
      const gap = `${vb.spacing}px`;
      if (el.style.marginTop !== gap) el.style.marginTop = gap;
      const sig = this.sig(vb.id);
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        this.renderBlockInner(el, vb);
        rendered.add(vb.id);
      }
    }
    return rendered;
  }

  private makeBlock(id: string): HTMLElement {
    const el = document.createElement("div");
    el.dataset.blockId = id;
    return el;
  }


  private renderBlockInner(el: HTMLElement, vb: VisibleBlock) {
    const id = vb.id;
    this.unmountRootsIn(el);
    const type = this.editor.getBlockType(id);
    el.className = `ori-block ori-block-${type}`;

    const blockRenderer = this.opts.renderBlock(type);
    if (blockRenderer) {
      el.contentEditable = "false";
      el.textContent = "";
      const layout = this.editor.getLayout(id)!;
      // Pin the block to its measured height so the DOM matches the height the
      // virtualizer reserved — a renderer that lays out to its container (e.g. a
      // divider using h-full) then fills exactly that, with no scroll drift.
      el.style.height = `${layout.height}px`;
      // Mount into a fresh child host, never the reused block element: a
      // deferred unmount of the previous root must not collide with createRoot
      // on the same container ("container already passed to createRoot"). The
      // host fills the pinned block so a renderer using height:100% (e.g. a
      // vertically-centered divider) resolves against the reserved height.
      const host = document.createElement("div");
      host.style.height = "100%";
      el.appendChild(host);
      const root = createRoot(host);
      // Pass the block's real geometry (height especially): an atomic renderer
      // like the image sizes itself from block.height, so a zeroed height would
      // collapse it even though the virtualizer reserves the measured space.
      root.render(blockRenderer({ editor: this.editor, block: vb, layout }) as ReactNode);
      this.roots.set(host, root);
      return;
    }
    el.contentEditable = "inherit";
    el.style.height = "";
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
    // A block ending in a hard break needs a filler <br> after the break, or the
    // browser puts no caret on the empty last line (the contentEditable
    // trailing-<br> quirk). The filler carries no data-* so domBlockText and
    // domToModel ignore it — it's purely so the caret can land on the new line.
    if (this.editor.getBlockText(id).endsWith("\n")) {
      el.appendChild(document.createElement("br"));
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
        this.roots.delete(node);
        this.scheduleUnmount(root);
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
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    // Select-all works even read-only (so a long document can be copied whole):
    // set the whole-document model selection (copy/cut serialize from it) and
    // highlight the rendered window. The native selection would cover only the
    // mounted blocks, silently dropping off-screen content from a copy.
    if (k === "a") {
      e.preventDefault();
      this.editor.selectAll();
      this.allSelected = true;
      this.selectRenderedRangeInDom();
      this.lastRevision = this.rev();
      return;
    }
    if (this.opts.readOnly) return;
    const mark = ({ b: "bold", i: "italic", u: "underline", e: "code" } as const)[k];
    if (mark) {
      e.preventDefault();
      // After Cmd+A the model already holds the whole-document selection; don't
      // re-read the (clipped) DOM range, which would shrink it to the window.
      if (!this.allSelected) {
        const sel = this.readSelection();
        if (sel) this.editor.setSelection(sel);
      }
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

  /** Whether a DOM selection spans the whole rendered window — i.e. it's the
   *  select-all feedback range (first rendered block start → last block end),
   *  not a user-narrowed selection within it. */
  private domSelectionSpansWindow(sel: { anchor: Pos; focus: Pos }): boolean {
    const blocks = Array.from(this.root.querySelectorAll(BLOCK_SEL)) as HTMLElement[];
    if (blocks.length === 0) return false;
    const firstId = blocks[0].dataset.blockId;
    const lastId = blocks[blocks.length - 1].dataset.blockId;
    if (!lastId) return false;
    const lastLen = this.editor.getBlockText(lastId).length;
    const ends = [sel.anchor, sel.focus];
    return (
      ends.some((p) => p.blockId === firstId && p.offset === 0) &&
      ends.some((p) => p.blockId === lastId && p.offset === lastLen)
    );
  }

  /** Visually select all currently-rendered blocks (feedback for select-all);
   *  the authoritative whole-document selection lives in the model. */
  private selectRenderedRangeInDom(): void {
    const blocks = Array.from(this.root.querySelectorAll(BLOCK_SEL)) as HTMLElement[];
    const s = window.getSelection();
    if (!blocks.length || !s) return;
    const first = blocks[0];
    const last = blocks[blocks.length - 1];
    const r = document.createRange();
    this.applyingModel = true;
    try {
      r.setStart(first, 0);
      r.setEnd(last, last.childNodes.length);
      s.removeAllRanges();
      s.addRange(r);
    } catch {
      /* nodes detached mid-reconcile */
    } finally {
      this.applyingModel = false;
    }
  }

  /**
   * The range the browser intends to modify. For IME, autocorrect and
   * spellcheck replacements this comes from `getTargetRanges()` and differs from
   * the (often collapsed) DOM selection — e.g. iOS autocorrect replaces a whole
   * word while the caret sits at its end. Falling back to the live selection
   * covers ordinary typing (and browsers/jsdom without target-range support).
   */
  private targetRange(e: InputEvent): { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null {
    const ranges = e.getTargetRanges?.();
    if (!ranges || ranges.length === 0) return this.readSelection();
    const r = ranges[0];
    const a = domToModel(this.root, r.startContainer, r.startOffset);
    const f = domToModel(this.root, r.endContainer, r.endOffset);
    if (!a || !f) return this.readSelection();
    return { anchor: { blockId: a.blockId, offset: a.offset }, focus: { blockId: f.blockId, offset: f.offset } };
  }

  private onBeforeInput(e: InputEvent) {
    if (this.opts.readOnly) {
      e.preventDefault();
      return;
    }
    const t = e.inputType;

    // Active IME composition: never intercept ANY input — the browser owns the
    // composing text (including deletes/replacements of candidate characters) and
    // we reconcile on compositionend. Intercepting here, and the re-render that
    // follows, is exactly what corrupts IME candidates / iOS predictive text.
    if (this.composing || t === "insertCompositionText") return;

    // An edit after Cmd+A acts on the whole document (the model selection), not
    // the rendered window the DOM target range would report.
    let range = this.targetRange(e);
    if (this.allSelected) {
      this.allSelected = false;
      this.editor.selectAll();
      range = this.editor.getSelection();
    }
    if (!range) return;
    this.editor.setSelection(range);
    const collapsed = isCollapsed(range);
    const ordered = this.editor.orderedSelection();
    const start = ordered?.start ?? range.focus;
    const blockId = start.blockId;
    const ed = this.editor;

    // Native fast path: collapsed in-block typing / deletion. The browser mutates
    // a single text node; onInput reads it back. Keeps autocorrect/IME native.
    // It must NOT cover deletion of an adjacent inline atom — the browser won't
    // remove a contentEditable=false node, so it would silently no-op and jolt
    // the caret; route those through the controller instead.
    const atomAt = (off: number) =>
      this.editor.getInline(blockId).some((it) => it.atom != null && it.start === off);
    const blockStr = this.editor.getBlockText(blockId);
    const blockLen = blockStr.length;
    // A block containing a hard break (multi-line code) is rendered with <br>s;
    // native typing/deletion at a break boundary produces an unwrapped text node
    // with no data-off, desyncing the offset map. Route those through the
    // controller so each edit re-renders into proper run spans.
    const multiline = blockStr.includes("\n");
    // Typing immediately beside an inline atom lands the browser at an element
    // boundary, producing a bare text node with no data-off (reindex only tracks
    // element children), which desyncs the atom's and following spans' offsets.
    // Route those through the controller so the block re-renders into proper runs.
    const nearAtom = (off: number) => atomAt(off) || atomAt(off - 1);
    // An atomic/custom block (divider, image) is contentEditable=false and has no
    // editable text node, so the browser can't type into it. Route through the
    // controller, which redirects the insertion into a real paragraph instead of
    // the block's hidden Y.Text.
    const atomicBlock = !!this.opts.renderBlock(this.editor.getBlockType(blockId));
    // A collapsed replacement with no real (non-collapsed) target range ALWAYS
    // stays native: the browser auto-corrects the word in place and onInput reads
    // it back. Routing it through the controller would only insert (no range to
    // delete) and duplicate the word, e.g. "teh" -> "tehthe" — even when a pending
    // mark is staged, so this must come before the pending-mark exception below.
    if (collapsed && t === "insertReplacementText" && !atomicBlock) return;
    // Collapsed typing stays native too — UNLESS a mark is staged at the caret
    // (Bold toggled with no selection), which the browser would type unstyled;
    // route that through the controller so the inserted text is painted bold.
    if (
      collapsed &&
      t === "insertText" &&
      !this.editor.hasPendingMarks() &&
      !multiline &&
      !atomicBlock &&
      !nearAtom(start.offset)
    )
      return;
    // Forward delete is native only mid-block; at the block end it must merge the
    // next block through the controller (a native cross-block merge corrupts the
    // virtualized DOM). Backward delete is native only past offset 0 (offset 0
    // merges the previous block). Neither may consume an adjacent inline atom or
    // edit a multi-line block (break boundaries break the offset map).
    if (collapsed && t === "deleteContentForward" && start.offset < blockLen && !atomAt(start.offset) && !multiline) return;
    if (collapsed && t === "deleteContentBackward" && start.offset > 0 && !atomAt(start.offset - 1) && !multiline) return;

    // Everything else (structural + cross-block) is handled through the controller.
    if (t === "insertParagraph") {
      e.preventDefault();
      // Enter inside a code block adds a line to the block (real multi-line code)
      // rather than splitting into a new block.
      if (this.editor.getBlockType(blockId) === "code") ed.insertSoftBreak();
      else ed.insertParagraphBreak();
    } else if (t === "historyUndo") {
      // Trackpad/menu undo (no keydown) would otherwise run the browser's native
      // contentEditable undo, which knows nothing about our model.
      e.preventDefault();
      ed.undo();
    } else if (t === "historyRedo") {
      e.preventDefault();
      ed.redo();
    } else if (t.startsWith("delete")) {
      e.preventDefault();
      if (t === "deleteContentForward") ed.deleteForward();
      else ed.deleteBackward();
      // Clearing all of a heading/quote/code's text drops it back to a paragraph.
      ed.demoteEmptyBlock();
    } else if (t === "insertText" || t === "insertReplacementText") {
      // Collapsed insertReplacementText, or ranged insert (autocorrect/spellcheck
      // replacement, typing over a selection): replace the target range with the
      // event's data. Paste has its own handler (onPaste).
      e.preventDefault();
      // Capture the replaced range's marks *before* deleting so the replacement
      // inherits them — matching the browser's native replace-in-place (e.g. iOS
      // autocorrecting a bold word keeps it bold).
      const marks = ed.getActiveMarks();
      if (!collapsed) ed.deleteBackward();
      const text = e.data ?? this.dataTransferText(e);
      if (text) ed.insertInline([{ text, start: 0, marks }]);
    } else if (t === "insertLineBreak") {
      // Shift+Enter. A soft break ("\n" in a block) is unreliable in
      // contentEditable: the caret after a trailing <br> lands before it, so the
      // next characters type onto the wrong line. In this block model Shift+Enter
      // starts a new block instead — a clean new line with a correct caret (the
      // same choice Notion-style block editors make).
      e.preventDefault();
      ed.insertParagraphBreak();
    } else if (t.startsWith("format")) {
      // Native formatting (the browser/mobile B/I/U buttons, or OS shortcuts that
      // surface as beforeinput rather than keydown) would otherwise mutate the DOM
      // without touching the model, and the next render would drop the styling.
      // Route the ones we model through the controller; ignore the rest.
      const fmt = (
        {
          formatBold: "bold",
          formatItalic: "italic",
          formatUnderline: "underline",
          formatStrikeThrough: "strike",
        } as const
      )[t];
      e.preventDefault();
      if (!fmt) return; // unmodeled (e.g. formatFontColor): drop it rather than desync
      ed.toggleMark(fmt);
    } else {
      return; // let the browser handle anything we don't model
    }
      this.commit();
  }

  /** Some replacement inputs carry their text on dataTransfer, not `data`. */
  private dataTransferText(e: InputEvent): string {
    return e.dataTransfer?.getData("text/plain") ?? "";
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
    // The browser painted the text; realign the run offsets so live DOM positions
    // stay correct. Then INVALIDATE the block's render signature (don't stamp the
    // model's — the native DOM has only the text, not our run wrappers/marks, and
    // sometimes a bare text node). This keeps the block eligible for the next
    // renderBlocks() to paint marks AND, crucially, to re-render when a following
    // controlled edit returns the block to a *previously rendered* signature —
    // e.g. type "@"/"/" then Backspace puts the block back at its prior signature,
    // and a stale (matching) signature would make renderBlocks skip it, leaving
    // the typed character on screen even though the model dropped it.
    this.reindex(blockEl);
    blockEl.removeAttribute("data-sig");
    // A native deletion that empties a heading/quote/code drops it to a paragraph.
    // Re-render (the block's type — and CSS class — changed under the browser).
    if (!insert && this.editor.demoteEmptyBlock()) {
      this.commit();
      return;
    }
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
    // Defensive: after Cmd+A serialize the whole document even if a stray
    // selectionchange clipped the model selection to the rendered window.
    if (this.allSelected) this.editor.selectAll();
    const blocks = this.editor.getSelectionBlocks();
    if (!blocks.length || !e.clipboardData) return;
    e.preventDefault();
    const { text, html, json } = serializeSelection(blocks);
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData(ORI_MIME, json);
    if (isCut && !this.opts.readOnly) {
      this.allSelected = false; // the whole-doc selection is now consumed
      this.editor.deleteBackward();
      this.editor.demoteEmptyBlock(); // cutting all of a heading's text -> paragraph
      this.commit();
    }
  }

  /** Paste: restore marks from our payload, else parse external HTML, else plain text. */
  private onPaste(e: ClipboardEvent) {
    if (this.opts.readOnly || !e.clipboardData) return;
    e.preventDefault();
    // After Cmd+A, paste replaces the whole document, not the rendered window the
    // DOM range would report.
    let sel = this.readSelection();
    if (this.allSelected) {
      this.allSelected = false;
      this.editor.selectAll();
      sel = this.editor.getSelection();
    }
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

  /**
   * Drop: route dropped content through the controller. A native drop into the
   * virtualized DOM inserts arbitrary nodes (and can splice across blocks),
   * corrupting the model↔DOM mapping; instead we place the caret at the drop
   * point and insert the payload like a paste. A drag that started inside the
   * editor is a *move*: the source range is deleted so text isn't duplicated.
   */
  private onDrop(e: DragEvent) {
    if (this.opts.readOnly || !e.dataTransfer) return;
    e.preventDefault();
    const source = this.dragSource;
    this.dragSource = null;

    const dt = e.dataTransfer;
    const ori = dt.getData(ORI_MIME);
    const html = dt.getData("text/html");
    const plain = dt.getData("text/plain");
    let blocks = ori ? deserializeOri(ori) : null;
    if (!blocks?.length && html) blocks = htmlToBlocks(html);
    if (!blocks?.length && plain) blocks = textToBlocks(plain);
    // Nothing droppable (e.g. a dragged file/image with no text): don't run an
    // edit. textToBlocks("") yields one empty paragraph, which would otherwise
    // retype an empty heading/code block as a paragraph for no content.
    if (!blocks?.length || blocks.every((b) => b.items.length === 0)) return;

    // Where the content was dropped (fall back to the current model selection).
    const at = this.caretFromPoint(e.clientX, e.clientY) ?? this.editor.getSelection()?.focus ?? null;
    if (!at) return;

    // A copy-drag (Option/Alt on macOS, Ctrl elsewhere, or an explicit "copy"
    // drop effect) duplicates instead of moving — the source must NOT be deleted.
    const isCopy = e.altKey || e.ctrlKey || dt.dropEffect === "copy";
    let dropAt: Pos = at;
    if (source && !isCopy) {
      const range = this.orderRange(source);
      // Dropped within (or at the edge of) the dragged text → leave it in place.
      if (this.docOrder(range.start, at) <= 0 && this.docOrder(at, range.end) <= 0) return;
      // Delete the source first so the caret ends up at the *dropped* content
      // (inserting last leaves the selection there). When the drop is after the
      // source, the deletion shifts the drop point, so map it across the cut.
      const after = this.docOrder(at, range.start) >= 0;
      if (after) dropAt = this.positionAfterDelete(at, range.start, range.end);
      this.editor.setSelection({ anchor: range.start, focus: range.end });
      this.editor.deleteBackward();
    }
    this.editor.setSelection({ anchor: dropAt, focus: dropAt });
    this.pasteBlocks(blocks);
    this.commit();
  }

  /** Order a range's ends into `{ start, end }` in document order. */
  private orderRange(sel: { anchor: Pos; focus: Pos }) {
    return this.docOrder(sel.anchor, sel.focus) <= 0
      ? { start: sel.anchor, end: sel.focus }
      : { start: sel.focus, end: sel.anchor };
  }

  /** Compare two model positions in document order (<0, 0, >0). */
  private docOrder(a: Pos, b: Pos): number {
    if (a.blockId === b.blockId) return a.offset - b.offset;
    const ids = this.editor.blockIds();
    return ids.indexOf(a.blockId) - ids.indexOf(b.blockId);
  }

  /**
   * Map a position that lies at/after `end` to where it lands once the ordered
   * range `[start, end]` is deleted (deleteRange merges `end`'s block into
   * `start`'s and drops the blocks between). Used to keep the drop point correct
   * after removing the source of an internal move-drop.
   */
  private positionAfterDelete(pos: Pos, start: Pos, end: Pos): Pos {
    if (pos.blockId !== end.blockId) return pos; // a later block: offsets unchanged
    if (start.blockId === end.blockId) {
      return { blockId: start.blockId, offset: pos.offset - (end.offset - start.offset) };
    }
    return { blockId: start.blockId, offset: start.offset + (pos.offset - end.offset) };
  }

  /** Map a viewport point to a model position via the browser's caret API. */
  private caretFromPoint(x: number, y: number): { blockId: string; offset: number } | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(x, y);
      if (r) {
        node = r.startContainer;
        offset = r.startOffset;
      }
    } else if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p) {
        node = p.offsetNode;
        offset = p.offset;
      }
    }
    if (!node || !this.root.contains(node)) return null;
    return domToModel(this.root, node, offset);
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
