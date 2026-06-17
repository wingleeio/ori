import type { EditorController, Fragment, InlineAtom, Line, VisibleBlock } from "@wingleeio/ori-core";
import type { CSSProperties } from "react";
import { useRenderers, type AtomRenderer } from "./renderers";

function fragmentStyle(frag: Fragment): CSSProperties {
  const f = frag.font;
  const decoration: string[] = [];
  if (frag.marks.underline) decoration.push("underline");
  if (frag.marks.strike) decoration.push("line-through");
  return {
    fontFamily: f.fontFamily,
    fontSize: f.fontSize,
    fontWeight: f.fontWeight,
    fontStyle: f.italic ? "italic" : "normal",
    letterSpacing: f.letterSpacing || undefined,
    textDecorationLine: decoration.length ? decoration.join(" ") : undefined,
  };
}

/** An inline atom, sized to the exact width Pretext laid out for it. */
function AtomFragment({
  editor,
  atom,
  render,
}: {
  editor: EditorController;
  atom: InlineAtom;
  render?: AtomRenderer;
}) {
  return (
    <span
      className="ori-atom"
      style={{
        display: "inline-block",
        width: atom.width,
        verticalAlign: "middle",
        whiteSpace: "normal",
      }}
    >
      {render ? render({ editor, atom }) : null}
    </span>
  );
}

function LineView({
  line,
  editor,
  atoms,
}: {
  line: Line;
  editor: EditorController;
  atoms: Record<string, AtomRenderer>;
}) {
  return (
    <div
      className="ori-line"
      style={{ height: line.height, lineHeight: `${line.height}px`, whiteSpace: "pre" }}
    >
      {line.fragments.map((frag) => {
        if (frag.atom) {
          return (
            <AtomFragment
              key={frag.start}
              editor={editor}
              atom={frag.atom}
              render={atoms[frag.atom.type]}
            />
          );
        }
        const className = ["ori-frag"];
        if (frag.marks.code) className.push("ori-frag-code");
        if (frag.marks.link) className.push("ori-frag-link");
        return (
          <span
            key={frag.start}
            className={className.join(" ")}
            style={fragmentStyle(frag)}
            data-start={frag.start}
          >
            {frag.text}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Render a visible block. Custom (atomic) block types use their registered
 * renderer; text blocks render materialized Pretext lines, with any inline
 * atoms drawn by their registered atom renderer at the measured width.
 */
export function BlockView({ editor, block }: { editor: EditorController; block: VisibleBlock }) {
  const { blocks, atoms } = useRenderers();
  const layout = editor.getLayout(block.id);
  if (!layout) return null;
  const custom = blocks[block.type];
  return (
    <div
      className={`ori-block ori-block-${block.type}`}
      data-block-id={block.id}
      style={{
        position: "absolute",
        top: block.top,
        left: 0,
        width: "100%",
        height: block.height,
      }}
    >
      {custom
        ? custom({ editor, block, layout })
        : layout.lines.map((line) => (
            <LineView key={line.index} line={line} editor={editor} atoms={atoms} />
          ))}
    </div>
  );
}
