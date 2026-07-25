import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { Decoration } from "@codemirror/view";
import { ReadOnlyStagePane, StageFileEditor } from "./StageFileEditor";
import type { StageFileContents } from "../../types/workingTree";

// A pure insertion: the right (working-tree / index) side adds line "b".
const inserted: StageFileContents = {
  headContent: "a\nc\n",
  worktreeContent: "a\nb\nc\n",
  isBinary: false,
  worktreeExists: true,
};

// A pure deletion: the right side removes line "b".
const removed: StageFileContents = {
  headContent: "a\nb\nc\n",
  worktreeContent: "a\nc\n",
  isBinary: false,
  worktreeExists: true,
};

// A modification: "b" → "B" (a removed + an added line).
const modified: StageFileContents = {
  headContent: "a\nb\nc\n",
  worktreeContent: "a\nB\nc\n",
  isBinary: false,
  worktreeExists: true,
};

// Two independent modifications, so the rendered diff carries (at least) two
// distinct per-line stage toggles to click.
const twoChanges: StageFileContents = {
  headContent: "a\nb\nc\nd\ne\n",
  worktreeContent: "a\nB\nc\nD\ne\n",
  isBinary: false,
  worktreeExists: true,
};

// The view-mode preference persists to localStorage; reset it between tests so
// each starts from the default (split) view.
beforeEach(() => localStorage.clear());

function pane(container: HTMLElement, testId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`pane ${testId} not found`);
  return el;
}

// Convenience: the working-tree editor is always opened in a mode. "unstaged"
// (Changes panel) is the common case unless a test overrides it.
function renderEditor(
  contents: StageFileContents,
  props: Partial<React.ComponentProps<typeof StageFileEditor>> = {},
) {
  return render(
    <StageFileEditor
      path="f.txt"
      contents={contents}
      stageMode="unstaged"
      onApplyIndex={vi.fn()}
      {...props}
    />,
  );
}

describe("StageFileEditor", () => {
  it("renders the HEAD and Working Tree panes side by side", () => {
    const { container } = renderEditor(inserted);

    expect(screen.getByText("HEAD")).toBeInTheDocument();
    expect(screen.getByText("Working Tree")).toBeInTheDocument();
    expect(pane(container, "head-pane")).toBeInTheDocument();
    expect(pane(container, "worktree-pane")).toBeInTheDocument();
  });

  it("gives the panes minWidth:0 so long unwrapped lines scroll instead of overflowing", () => {
    const { container } = renderEditor(inserted);
    const head = pane(container, "head-pane");
    expect(head.style.minWidth).toBe("0");
    const cmHost = head.lastElementChild as HTMLElement;
    expect(cmHost.style.minWidth).toBe("0");
  });

  it("no longer renders the bottom staged-result pane", () => {
    const { container } = renderEditor(inserted);

    expect(screen.queryByText("Staged result")).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="result-pane"]')).toBeNull();
  });

  it("shows a '+' (stage) toggle per change in the unstaged view", async () => {
    const { container } = renderEditor(inserted);

    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      expect(buttons.length).toBe(1);
      expect(buttons[0]!.textContent).toBe("+");
    });
  });

  it("shows a '−' (unstage) toggle per change in the staged view", async () => {
    const { container } = renderEditor(inserted, { stageMode: "staged" });

    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      expect(buttons.length).toBe(1);
      expect(buttons[0]!.textContent).toBe("−");
    });
  });

  it("reseeds staged rows when the file or stage mode changes", async () => {
    const { container, rerender } = render(<StageFileEditor path="first.txt" contents={twoChanges} stageMode="unstaged" />);
    const firstToggles = await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle"));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    });
    fireEvent.click(firstToggles[0]!);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")!.textContent).toBe("−"));

    rerender(<StageFileEditor path="second.txt" contents={twoChanges} stageMode="unstaged" />);
    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      expect(Array.from(buttons).every((button) => button.textContent === "+")).toBe(true);
    });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")!);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>(".cm-stage-toggle")!.textContent).toBe("−"));
    rerender(<StageFileEditor path="second.txt" contents={twoChanges} stageMode="staged" />);
    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle");
      expect(Array.from(buttons).every((button) => button.textContent === "−")).toBe(true);
    });
  });

  it("shows an addition solid-green on the right and hatched on the HEAD side", async () => {
    const { container } = renderEditor(inserted);

    await waitFor(() => {
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-add-line")).not.toBeNull();
      expect(pane(container, "head-pane").querySelector(".cm-diff-placeholder-line")).not.toBeNull();
      expect(pane(container, "head-pane").querySelector(".cm-diff-add-line")).toBeNull();
    });
  });

  it("shows a removal solid-red on the HEAD side and hatched on the right", async () => {
    const { container } = renderEditor(removed);

    await waitFor(() => {
      expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull();
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-placeholder-line")).not.toBeNull();
      expect(pane(container, "worktree-pane").querySelector(".cm-diff-del-line")).toBeNull();
    });
  });

  it("stages a line immediately when its '+' is clicked (unstaged view)", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { onApplyIndex });

    const toggle = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>(".cm-stage-toggle");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(toggle);

    // Staging the added "b" writes the working-tree content into the index.
    expect(onApplyIndex).toHaveBeenCalledTimes(1);
    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nb\nc\n"]);
  });

  it("unstages a line immediately when its '−' is clicked (staged view)", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { stageMode: "staged", onApplyIndex });

    const toggle = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>(".cm-stage-toggle");
      expect(b).not.toBeNull();
      return b!;
    });
    fireEvent.click(toggle);

    // Unstaging the only staged change reverts the index blob to HEAD.
    expect(onApplyIndex).toHaveBeenCalledTimes(1);
    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nc\n"]);
  });

  it("stages every line via 'Stage all' in the unstaged view", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { onApplyIndex });

    await waitFor(() => expect(container.querySelector(".cm-stage-toggle")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Stage all" }));

    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nb\nc\n"]);
  });

  it("unstages every line via 'Unstage all' in the staged view", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { stageMode: "staged", onApplyIndex });

    await waitFor(() => expect(container.querySelector(".cm-stage-toggle")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Unstage all" }));

    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nc\n"]);
  });

  it("ignores a second line-toggle while the first is still applying", async () => {
    let resolveFirst: () => void;
    // `onApplyIndex`'s declared prop type is `(path, content) => void` (its
    // real-world caller, App.tsx, is fire-and-forget) — but the component
    // guards overlapping toggles via `Promise.resolve(onApplyIndex(...))`, so
    // this test's mock returns a real promise and is cast past the narrower
    // declared type to prove that guard actually waits for it.
    const onApplyIndex = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveFirst = r;
        }),
    ) as unknown as (path: string, content: string) => void;
    const { container } = renderEditor(twoChanges, { onApplyIndex });

    const toggles = await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle"));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    });

    // toggles.length >= 2, asserted in the waitFor above.
    fireEvent.click(toggles[0]!);
    fireEvent.click(toggles[1]!); // fired before the first resolves

    expect(onApplyIndex).toHaveBeenCalledTimes(1); // second click ignored, not composed from stale rows

    resolveFirst!();
    // Once the first apply resolves, a subsequent toggle is honoured again.
    await new Promise((r) => setTimeout(r, 0)); // let the in-flight promise's `.finally` settle
    fireEvent.click(toggles[1]!);
    expect(onApplyIndex).toHaveBeenCalledTimes(2);
  });

  it("defaults to the split view with both panes and a view-mode toggle", () => {
    const { container } = renderEditor(inserted);

    expect(pane(container, "head-pane")).toBeInTheDocument();
    expect(pane(container, "worktree-pane")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="inline-pane"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Side-by-side view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inline view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hunk view" })).toBeInTheDocument();
  });

  it("switches to a single unified pane in inline view", () => {
    const { container } = renderEditor(inserted);

    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    expect(pane(container, "inline-pane")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
    expect(container.querySelector('[data-testid="worktree-pane"]')).toBeNull();
  });

  it("shows added and removed lines together in the inline pane", async () => {
    const { container } = renderEditor(modified);
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    await waitFor(() => {
      const inline = pane(container, "inline-pane");
      expect(inline.querySelector(".cm-diff-add-line")).not.toBeNull();
      expect(inline.querySelector(".cm-diff-del-line")).not.toBeNull();
      expect(inline.querySelector(".cm-diff-placeholder-line")).toBeNull();
    });
  });

  it("stages line-by-line from the inline view", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { onApplyIndex });
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));

    const toggle = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>('[data-testid="inline-pane"] .cm-stage-toggle');
      expect(b).not.toBeNull();
      return b!;
    });
    expect(toggle.textContent).toBe("+");
    fireEvent.click(toggle);
    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nb\nc\n"]);
  });

  it("remembers the chosen view mode across remounts", () => {
    const first = renderEditor(inserted);
    fireEvent.click(screen.getByRole("button", { name: "Inline view" }));
    first.unmount();

    const { container } = renderEditor(inserted);
    expect(pane(container, "inline-pane")).toBeInTheDocument();
  });

  it("switches to a hunk view with an @@ header and change decorations", async () => {
    const { container } = renderEditor(modified);

    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));

    const hunk = pane(container, "hunk-pane");
    expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
    await waitFor(() => {
      expect(hunk.querySelector(".cm-diff-hunk-header")).not.toBeNull();
      expect(hunk.querySelector(".cm-diff-add-line")).not.toBeNull();
      expect(hunk.querySelector(".cm-diff-del-line")).not.toBeNull();
    });
    expect(hunk.textContent).toContain("@@");
  });

  it("stages line-by-line from the hunk view", async () => {
    const onApplyIndex = vi.fn();
    const { container } = renderEditor(inserted, { onApplyIndex });
    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));

    const toggle = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>('[data-testid="hunk-pane"] .cm-stage-toggle');
      expect(b).not.toBeNull();
      return b!;
    });
    expect(toggle.textContent).toBe("+");
    fireEvent.click(toggle);
    expect(onApplyIndex.mock.calls[0]).toEqual(["f.txt", "a\nb\nc\n"]);
  });

  it("remembers the hunk view across remounts", () => {
    const first = renderEditor(inserted);
    fireEvent.click(screen.getByRole("button", { name: "Hunk view" }));
    first.unmount();

    const { container } = renderEditor(inserted);
    expect(pane(container, "hunk-pane")).toBeInTheDocument();
  });

  it("renders the change overview ruler", () => {
    const { container } = renderEditor(inserted);
    const overview = container.querySelector('[data-testid="change-overview"]');
    expect(overview).not.toBeNull();
    const marks = overview!.querySelectorAll("[data-overview-mark]");
    expect(marks.length).toBe(1);
    expect(marks[0]!.getAttribute("data-color")).toBe("add");
  });

  describe("diff-view options", () => {
    const whitespaceOnly: StageFileContents = {
      headContent: "a\nfoo\nc\n",
      worktreeContent: "a\n  foo  \nc\n",
      isBinary: false,
      worktreeExists: true,
    };

    it("wrap toggle defaults on and flips + persists when clicked", () => {
      renderEditor(modified);
      const btn = screen.getByRole("button", { name: "Wrap long lines" });

      expect(btn).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(btn);
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(localStorage.getItem("stageFileEditor.wrap")).toBe("false");
    });

    it("remembers the wrap preference across remounts", () => {
      const first = renderEditor(modified);
      fireEvent.click(screen.getByRole("button", { name: "Wrap long lines" }));
      first.unmount();

      renderEditor(modified);
      expect(screen.getByRole("button", { name: "Wrap long lines" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("hides whitespace-only changes when the whitespace toggle is on", async () => {
      const { container } = renderEditor(whitespaceOnly);

      await waitFor(() =>
        expect(container.querySelectorAll(".cm-stage-toggle").length).toBeGreaterThan(0),
      );

      const btn = screen.getByRole("button", { name: "Hide whitespace-only changes" });
      expect(btn).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(btn);

      await waitFor(() => expect(container.querySelectorAll(".cm-stage-toggle").length).toBe(0));
      expect(btn).toHaveAttribute("aria-pressed", "true");
      expect(localStorage.getItem("stageFileEditor.ignoreWhitespace")).toBe("true");
    });

    it("keeps a real change visible with the whitespace toggle on", async () => {
      localStorage.setItem("stageFileEditor.ignoreWhitespace", "true");
      const { container } = renderEditor(modified);

      await waitFor(() =>
        expect(container.querySelectorAll(".cm-stage-toggle").length).toBeGreaterThan(0),
      );
    });
  });

  describe("image preview", () => {
    const addedImage: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
      headImage: null,
      worktreeImage: "data:image/png;base64,AAAA",
    };
    const modifiedImage: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
      headImage: "data:image/png;base64,OLD0",
      worktreeImage: "data:image/png;base64,NEW1",
    };

    it("previews an image instead of a text diff, offering whole-file staging", () => {
      const onStageWholeFile = vi.fn();
      const { container } = renderEditor(addedImage, { path: "logo.png", onStageWholeFile });

      expect(container.querySelector('[data-testid="image-diff"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
      expect(screen.queryByRole("button", { name: "Inline view" })).toBeNull();

      const img = screen.getByAltText<HTMLImageElement>(/preview/i);
      expect(img.src).toBe("data:image/png;base64,AAAA");

      fireEvent.click(screen.getByRole("button", { name: /stage whole file/i }));
      expect(onStageWholeFile).toHaveBeenCalledWith("logo.png");
    });

    it("shows both before/after images for a modified image", () => {
      renderEditor(modifiedImage, { path: "logo.png" });

      const imgs = screen.getAllByAltText(/preview/i);
      expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
        "data:image/png;base64,OLD0",
        "data:image/png;base64,NEW1",
      ]);
    });

    it("has no staging controls when read-only (commit view)", () => {
      render(<StageFileEditor readOnly path="logo.png" contents={modifiedImage} />);
      expect(screen.queryByRole("button", { name: /stage whole file/i })).toBeNull();
    });
  });

  describe("read-only mode", () => {
    it("renders the diff with custom labels and no staging controls", async () => {
      const { container } = render(
        <StageFileEditor
          readOnly
          path="f.txt"
          contents={modified}
          leftLabel="Parent"
          rightLabel="This commit"
        />,
      );

      expect(screen.getByText("Parent")).toBeInTheDocument();
      expect(screen.getByText("This commit")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stage all" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Unstage all" })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull();
        expect(pane(container, "worktree-pane").querySelector(".cm-diff-add-line")).not.toBeNull();
      });
      expect(container.querySelector(".cm-stage-toggle")).toBeNull();
    });

    it("keeps the split/inline view toggle", () => {
      render(<StageFileEditor readOnly path="f.txt" contents={modified} />);
      expect(screen.getByRole("button", { name: "Side-by-side view" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inline view" })).toBeInTheDocument();
    });

    it("renders a deletion (empty new side) as a diff rather than a fallback", async () => {
      const deleted: StageFileContents = {
        headContent: "a\nb\n",
        worktreeContent: "",
        isBinary: false,
        worktreeExists: false,
      };
      const { container } = render(<StageFileEditor readOnly path="f.txt" contents={deleted} />);

      expect(screen.queryByText(/can't be staged/i)).not.toBeInTheDocument();
      await waitFor(() =>
        expect(pane(container, "head-pane").querySelector(".cm-diff-del-line")).not.toBeNull(),
      );
    });

    it("shows a no-preview message (no stage button) for binary files", () => {
      const binary: StageFileContents = {
        headContent: "",
        worktreeContent: "",
        isBinary: true,
        worktreeExists: true,
      };
      render(
        <StageFileEditor readOnly path="logo.png" contents={binary} onStageWholeFile={vi.fn()} />,
      );

      expect(screen.getByText(/no preview/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stage whole file" })).not.toBeInTheDocument();
    });
  });

  it("falls back to whole-file staging for binary files", () => {
    const onStageWholeFile = vi.fn();
    const binary: StageFileContents = {
      headContent: "",
      worktreeContent: "",
      isBinary: true,
      worktreeExists: true,
    };
    renderEditor(binary, { path: "logo.png", onStageWholeFile });

    expect(screen.getByText(/binary file/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage all" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stage whole file" }));
    expect(onStageWholeFile).toHaveBeenCalledWith("logo.png");
  });

  it("falls back to whole-file staging instead of a line diff when the file is too large", () => {
    const onStageWholeFile = vi.fn();
    const huge: StageFileContents = {
      headContent: Array.from({ length: 5000 }, (_, i) => `h${i}`).join("\n"),
      worktreeContent: Array.from({ length: 5000 }, (_, i) => `w${i}`).join("\n"),
      isBinary: false,
      worktreeExists: true,
    };
    const { container } = renderEditor(huge, { path: "bundle.min.js", onStageWholeFile });

    expect(screen.getByText(/too large to diff line-by-line/i)).toBeInTheDocument();
    expect(container.querySelector('[data-testid="head-pane"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stage whole file" }));
    expect(onStageWholeFile).toHaveBeenCalledWith("bundle.min.js");
  });

  describe("ReadOnlyStagePane scroll preservation", () => {
    // A tall doc so the pane can scroll (jsdom doesn't lay out real content
    // height, but scrollTop is a plain settable property, so this just proves
    // the rebuild doesn't stomp on it back to 0).
    const bigContent = (prefix: string) =>
      Array.from({ length: 400 }, (_, i) => `${prefix}${i}`).join("\n");
    const lineNumberMapFor = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

    function pane(content: string, changedLines: Set<number>, fileKey: string) {
      return (
        <ReadOnlyStagePane
          testId="head-pane"
          content={content}
          changedLines={changedLines}
          stagedLines={new Set()}
          onToggle={() => {}}
          decorations={Decoration.none}
          lineNumberMap={lineNumberMapFor(400)}
          language={null}
          fileKey={fileKey}
        />
      );
    }

    it("keeps the scroll position when a line toggle causes new content/decorations to arrive", () => {
      const { rerender } = render(pane(bigContent("a"), new Set([5]), "file-a.txt"));

      const scroller = screen.getByTestId("head-pane").querySelector(".cm-scroller");
      expect(scroller).not.toBeNull();
      scroller!.scrollTop = 4000;

      // A realistic line-toggle: brand-new `content`/`changedLines` (and thus a
      // brand-new `decorations` set, computed by the parent from fresh rows),
      // exactly what happens on every stage/unstage click, but the SAME file.
      rerender(pane(bigContent("b"), new Set([6]), "file-a.txt"));

      const newScroller = screen.getByTestId("head-pane").querySelector(".cm-scroller");
      expect(newScroller).not.toBeNull();
      expect(newScroller!.scrollTop).toBeGreaterThan(3900); // did not snap back to 0
    });

    it("does not carry a stale file's scroll position onto a freshly opened file", () => {
      // Regression: the same pane instance persists across a genuine file
      // switch (e.g. clicking a different row in the working-tree list),
      // which — from the pane's perspective — presents new content/decorations
      // exactly like a same-file line toggle does. Only `fileKey` tells them
      // apart; without that check, file B would inherit file A's scroll.
      const { rerender } = render(pane(bigContent("a"), new Set([5]), "file-a.txt"));

      const scroller = screen.getByTestId("head-pane").querySelector(".cm-scroller");
      expect(scroller).not.toBeNull();
      scroller!.scrollTop = 4000;

      // A genuine file switch: different `fileKey`, different content.
      rerender(pane(bigContent("c"), new Set([2]), "file-b.txt"));

      const newScroller = screen.getByTestId("head-pane").querySelector(".cm-scroller");
      expect(newScroller).not.toBeNull();
      expect(newScroller!.scrollTop).toBe(0); // file B opens fresh, not at file A's position
    });
  });

  describe("discard confirmation", () => {
    it("prompts for confirmation before discarding, and discards only after confirming", () => {
      const onDiscardFile = vi.fn();
      renderEditor(inserted, { onDiscardFile });
      fireEvent.click(screen.getByRole("button", { name: "Discard file" }));

      expect(onDiscardFile).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog", { name: "Discard changes" });
      expect(within(dialog).getByText(/f\.txt/)).toBeInTheDocument();

      fireEvent.click(within(dialog).getByText("Discard"));
      expect(onDiscardFile).toHaveBeenCalledWith("f.txt");
    });

    it("does not discard when the confirmation is cancelled", () => {
      const onDiscardFile = vi.fn();
      renderEditor(inserted, { onDiscardFile });
      fireEvent.click(screen.getByRole("button", { name: "Discard file" }));
      fireEvent.click(screen.getByText("Cancel"));

      expect(onDiscardFile).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows a too-large message with no stage button in read-only mode", () => {
    const huge: StageFileContents = {
      headContent: Array.from({ length: 5000 }, (_, i) => `h${i}`).join("\n"),
      worktreeContent: Array.from({ length: 5000 }, (_, i) => `w${i}`).join("\n"),
      isBinary: false,
      worktreeExists: true,
    };
    render(
      <StageFileEditor readOnly path="bundle.min.js" contents={huge} onStageWholeFile={vi.fn()} />,
    );

    expect(screen.getByText(/too large to diff line-by-line/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage whole file" })).not.toBeInTheDocument();
  });
});
