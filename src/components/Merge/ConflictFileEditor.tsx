import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  type DecorationSet,
} from "@codemirror/view";
import {
  editorThemeExtension,
  registerEditorView,
} from "../../lib/editorTheme";
import { languageForPath } from "../../lib/editorLanguage";
import type { ConflictedFile } from "../../types/merge";
import { isBlockResolved } from "../../lib/conflictBlocks";
import {
  blockLineRanges,
  composeBlockText,
  splitBlockLines,
  type BlockLineRange,
} from "../../lib/lineSelection";
import { buildPaneDecorations } from "./mergeDecorations";
import { selectionGutter, setSelectedLines } from "./selectionGutter";
import { Button } from "../ui/Button";

interface ConflictFileEditorProps {
  file: ConflictedFile;
  onMarkResolved: (path: string, content: string) => void;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

type BlockSelection = { current: Set<number>; source: Set<number> };
type Selections = Record<number, BlockSelection>;

const emptyBlockSelection = (): BlockSelection => ({
  current: new Set(),
  source: new Set(),
});

const paneTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-bg-surface)",
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    height: "100%",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "var(--color-bg-elevated)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-bg-elevated)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-bg-elevated)" },
  ".cm-diff-add": {
    backgroundColor: "var(--color-diff-add-bg)",
    borderBottom: "1px solid var(--color-diff-add)",
  },
  ".cm-diff-del": {
    backgroundColor: "var(--color-diff-del-bg)",
    borderBottom: "1px solid var(--color-diff-del)",
  },
  ".cm-diff-add-line": { backgroundColor: "var(--color-diff-add-bg)" },
  ".cm-diff-del-line": { backgroundColor: "var(--color-diff-del-bg)" },
  ".cm-select-gutter": {
    paddingLeft: "var(--space-1)",
    paddingRight: "var(--space-1)",
  },
  ".cm-select-checkbox": { cursor: "pointer", margin: 0 },
});

// Active-line highlight shared by every pane (read-only panes still track a
// cursor, so clicking a line highlights it).
const activeLineExtensions = [
  highlightActiveLine(),
  highlightActiveLineGutter(),
];

interface BlockRange {
  from: number;
  to: number;
}

// Tracks each conflict block's live range in the result document, mapped through
// every edit so it remains a valid pointer to where the block's content lives.
const blockRangesField = StateField.define<BlockRange[]>({
  create: () => [],
  update(value, tr) {
    if (!tr.docChanged) return value;
    return value.map((r) => ({
      from: tr.changes.mapPos(r.from, -1),
      to: tr.changes.mapPos(r.to, 1),
    }));
  },
});

// Maps a pane's per-block local line selections to its 1-based document line numbers.
function paneSelectedLineNumbers(
  ranges: BlockLineRange[],
  selections: Selections,
  side: "current" | "source",
): Set<number> {
  const set = new Set<number>();
  for (const r of ranges) {
    const localSet = selections[r.blockIndex]?.[side];
    if (!localSet) continue;
    for (const local of localSet) {
      const lineNo = r.start + local;
      if (lineNo <= r.end) set.add(lineNo);
    }
  }
  return set;
}

const paneLabelStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-subtle)",
};

function ReadOnlyPane({
  label,
  content,
  decorations,
  selectionRanges,
  selectedLines,
  onToggleLine,
  language,
}: {
  label: string;
  content: string;
  decorations?: DecorationSet;
  selectionRanges?: BlockLineRange[];
  selectedLines?: Set<number>;
  onToggleLine?: (lineNo: number) => void;
  language?: Extension | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      lineNumbers(),
      ...activeLineExtensions,
      ...(language ? [language] : []),
      editorThemeExtension(),
      paneTheme,
      EditorState.readOnly.of(true),
      EditorView.lineWrapping,
    ];
    if (decorations) extensions.push(EditorView.decorations.of(decorations));
    if (selectionRanges && onToggleLine) {
      extensions.push(selectionGutter(selectionRanges, onToggleLine));
    }

    const view = new EditorView({
      state: EditorState.create({ doc: content, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    const unregister = registerEditorView(view);

    return () => {
      unregister();
      view.destroy();
      viewRef.current = null;
    };
  }, [content, decorations, selectionRanges, onToggleLine, language]);

  // Push the controlled selection into the gutter checkboxes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !selectionRanges) return;
    view.dispatch({ effects: setSelectedLines.of(selectedLines ?? new Set()) });
  }, [selectedLines, selectionRanges]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div style={paneLabelStyle}>{label}</div>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      />
    </div>
  );
}

export function ConflictFileEditor({
  file,
  onMarkResolved,
  onDirtyChange,
}: ConflictFileEditorProps) {
  return (
    <ConflictFileEditorBody
      key={`${file.path}\u0000${file.seededResult ?? ""}`}
      file={file}
      onMarkResolved={onMarkResolved}
      onDirtyChange={onDirtyChange}
    />
  );
}

function ConflictFileEditorBody({
  file,
  onMarkResolved,
  onDirtyChange,
}: ConflictFileEditorProps) {
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const resultViewRef = useRef<EditorView | null>(null);
  const [resultContent, setResultContent] = useState(file.seededResult ?? "");
  const [selections, setSelections] = useState<Selections>({});
  const selectionsRef = useRef<Selections>({});

  const language = useMemo(() => languageForPath(file.path), [file.path]);

  const sourceDecorations = useMemo(
    () =>
      buildPaneDecorations(
        file.theirsContent ?? "",
        file.conflictBlocks,
        "theirs",
      ),
    [file.theirsContent, file.conflictBlocks],
  );
  const currentDecorations = useMemo(
    () =>
      buildPaneDecorations(file.oursContent ?? "", file.conflictBlocks, "ours"),
    [file.oursContent, file.conflictBlocks],
  );

  const sourceRanges = useMemo(
    () =>
      blockLineRanges(file.theirsContent ?? "", file.conflictBlocks, "theirs"),
    [file.theirsContent, file.conflictBlocks],
  );
  const currentRanges = useMemo(
    () => blockLineRanges(file.oursContent ?? "", file.conflictBlocks, "ours"),
    [file.oursContent, file.conflictBlocks],
  );

  const sourceSelectedLines = useMemo(
    () => paneSelectedLineNumbers(sourceRanges, selections, "source"),
    [sourceRanges, selections],
  );
  const currentSelectedLines = useMemo(
    () => paneSelectedLineNumbers(currentRanges, selections, "current"),
    [currentRanges, selections],
  );

  useEffect(() => {
    if (!resultContainerRef.current) return;

    const initialDoc = file.seededResult ?? "";
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          ...activeLineExtensions,
          ...(language ? [language] : []),
          editorThemeExtension(),
          paneTheme,
          EditorView.lineWrapping,
          blockRangesField.init((state) =>
            file.conflictBlocks.map((b) => ({
              from: state.doc.line(b.startLine).from,
              to: state.doc.line(b.endLine).to,
            })),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString();
              setResultContent(next);
              onDirtyChange?.(file.path, next !== (file.seededResult ?? ""));
            }
          }),
        ],
      }),
      parent: resultContainerRef.current,
    });
    resultViewRef.current = view;
    const unregister = registerEditorView(view);
    // A freshly (re)built doc always starts equal to its seeded result — clear
    // any stale dirty flag left over from before this file/seed switch.
    onDirtyChange?.(file.path, false);

    return () => {
      unregister();
      view.destroy();
      resultViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.seededResult]);

  // Replace a block's tracked range in the result with the composed selection.
  const applyBlock = useCallback(
    (blockIndex: number, blockSel: BlockSelection) => {
      const view = resultViewRef.current;
      if (!view) return;
      const block = file.conflictBlocks[blockIndex];
      if (!block) return;
      const text = composeBlockText(
        splitBlockLines(block.oursText),
        splitBlockLines(block.theirsText),
        blockSel.current,
        blockSel.source,
      );
      const range = view.state.field(blockRangesField)[blockIndex];
      if (!range) return;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
      });
    },
    [file],
  );

  const setBlockSelection = useCallback(
    (blockIndex: number, blockSel: BlockSelection) => {
      const next = { ...selectionsRef.current, [blockIndex]: blockSel };
      selectionsRef.current = next;
      setSelections(next);
      applyBlock(blockIndex, blockSel);
    },
    [applyBlock],
  );

  const toggleLine = useCallback(
    (ranges: BlockLineRange[], side: "current" | "source", lineNo: number) => {
      const r = ranges.find((rr) => lineNo >= rr.start && lineNo <= rr.end);
      if (!r) return;
      const local = lineNo - r.start;
      const cur = selectionsRef.current[r.blockIndex] ?? emptyBlockSelection();
      const nextSide = new Set(cur[side]);
      if (nextSide.has(local)) nextSide.delete(local);
      else nextSide.add(local);
      setBlockSelection(r.blockIndex, { ...cur, [side]: nextSide });
    },
    [setBlockSelection],
  );

  const onToggleSource = useCallback(
    (lineNo: number) => toggleLine(sourceRanges, "source", lineNo),
    [toggleLine, sourceRanges],
  );
  const onToggleCurrent = useCallback(
    (lineNo: number) => toggleLine(currentRanges, "current", lineNo),
    [toggleLine, currentRanges],
  );

  // Whole-block chips select every line of one side (and clear the other).
  const selectWholeSide = useCallback(
    (blockIndex: number, side: "current" | "source") => {
      const block = file.conflictBlocks[blockIndex];
      if (!block) return;
      const lines =
        side === "current"
          ? splitBlockLines(block.oursText)
          : splitBlockLines(block.theirsText);
      const all = new Set(lines.map((_, i) => i));
      setBlockSelection(
        blockIndex,
        side === "current"
          ? { current: all, source: new Set() }
          : { current: new Set(), source: all },
      );
    },
    [file, setBlockSelection],
  );

  function handleMarkResolved() {
    onMarkResolved(
      file.path,
      resultViewRef.current?.state.doc.toString() ?? resultContent,
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          height: "50%",
          minHeight: 0,
          gap: "1px",
          background: "var(--color-border-subtle)",
        }}
      >
        <ReadOnlyPane
          label="Source"
          content={file.theirsContent ?? ""}
          decorations={sourceDecorations}
          selectionRanges={sourceRanges}
          selectedLines={sourceSelectedLines}
          onToggleLine={onToggleSource}
          language={language}
        />
        <ReadOnlyPane
          label="Current"
          content={file.oursContent ?? ""}
          decorations={currentDecorations}
          selectionRanges={currentRanges}
          selectedLines={currentSelectedLines}
          onToggleLine={onToggleCurrent}
          language={language}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "50%",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-1) var(--space-2)",
            borderBottom: "1px solid var(--color-border-subtle)",
            borderTop: "1px solid var(--color-border-subtle)",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            Result
          </span>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={handleMarkResolved}
          >
            Mark resolved
          </Button>
        </div>
        {file.conflictBlocks.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-3)",
              padding: "var(--space-1) var(--space-2)",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            {file.conflictBlocks.map((block, index) => {
              const resolved = isBlockResolved(
                resultContent,
                file.seededResult ?? "",
                block,
              );
              return (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--font-size-sm)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Conflict {index + 1}
                    {resolved ? " — resolved" : ""}
                  </span>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => selectWholeSide(index, "source")}
                  >
                    Accept source
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => selectWholeSide(index, "current")}
                  >
                    Accept current
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <div
          ref={resultContainerRef}
          data-testid="result-pane"
          style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        />
      </div>
    </div>
  );
}
