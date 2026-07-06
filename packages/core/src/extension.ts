import type { EditorSchema } from "./nodes";
import type { BlockRuleMatch, InlineRuleMatch } from "./inputrules";
import type { EditorController } from "./controller";

/**
 * The composable extension surface — how hosts package a feature (nodes +
 * autoformat + commands) as one reusable unit instead of wiring each piece by
 * hand. Everything an extension contributes goes through the same public
 * machinery the built-ins use, so extensions get layout, virtualization,
 * undo and sync behavior for free.
 *
 * ```ts
 * const callout: EditorExtension = {
 *   name: "callout",
 *   schema: { blocks: { callout: { type: "callout", text: true, inset: … } } },
 *   blockRules: [(prefix) => (prefix === ":: " ? { type: "callout", prefixLength: 3 } : null)],
 *   commands: { setCallout: (ed) => ed.setBlockTypeAtSelection("callout") },
 * };
 * const editor = new EditorController({ measurer, extensions: [callout] });
 * editor.exec("setCallout");
 * ```
 */
export interface EditorExtension {
  /** Unique name; a later extension with the same command name wins. */
  name: string;
  /** Custom measurable block/atom nodes, merged over the built-ins. */
  schema?: Partial<EditorSchema>;
  /**
   * Extra markdown-style block conversions, checked BEFORE the built-ins on
   * each qualifying keystroke. `prefix` is the block's text from its start to
   * the caret (including the just-typed character); return a match to convert
   * the block, or `null` to pass.
   */
  blockRules?: Array<(prefix: string) => BlockRuleMatch | null>;
  /** Extra inline span rules (`text` = block text up to the caret), same contract. */
  inlineRules?: Array<(text: string) => InlineRuleMatch | null>;
  /** Named commands invokable via {@link EditorController.exec}. */
  commands?: Record<string, (editor: EditorController, ...args: unknown[]) => unknown>;
}

/** The merged, resolved contributions of a set of extensions. */
export interface ResolvedExtensions {
  schema: Partial<EditorSchema>;
  blockRules: Array<(prefix: string) => BlockRuleMatch | null>;
  inlineRules: Array<(text: string) => InlineRuleMatch | null>;
  commands: Map<string, (editor: EditorController, ...args: unknown[]) => unknown>;
}

/** Merge extensions in order (later wins on name collisions). */
export function resolveExtensions(extensions: EditorExtension[] = []): ResolvedExtensions {
  const out: ResolvedExtensions = {
    schema: { blocks: {}, atoms: {} },
    blockRules: [],
    inlineRules: [],
    commands: new Map(),
  };
  for (const ext of extensions) {
    if (ext.schema?.blocks) Object.assign(out.schema.blocks!, ext.schema.blocks);
    if (ext.schema?.atoms) Object.assign(out.schema.atoms!, ext.schema.atoms);
    if (ext.blockRules) out.blockRules.push(...ext.blockRules);
    if (ext.inlineRules) out.inlineRules.push(...ext.inlineRules);
    for (const [name, fn] of Object.entries(ext.commands ?? {})) out.commands.set(name, fn);
  }
  return out;
}
