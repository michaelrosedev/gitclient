import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { ConflictFileEditor } from "./ConflictFileEditor";
import type { ConflictedFile } from "../../types/merge";

const seededResult = [
  "shared line",
  "<<<<<<< HEAD",
  "current text",
  "=======",
  "source text",
  ">>>>>>> feature",
  "trailing line",
].join("\n");

const file: ConflictedFile = {
  path: "src/lib.rs",
  kind: "normalEdit",
  oursContent: "shared line\ncurrent text\ntrailing line",
  theirsContent: "shared line\nsource text\ntrailing line",
  baseContent: "shared line\nbase text\ntrailing line",
  seededResult,
  conflictBlocks: [
    {
      startLine: 2,
      midLine: 4,
      endLine: 6,
      oursText: "current text\n",
      theirsText: "source text\n",
    },
  ],
};

function getResultPaneText(container: HTMLElement): string {
  const resultPane = container.querySelector('[data-testid="result-pane"]');
  if (!resultPane) throw new Error("result pane not found");
  return resultPane.textContent ?? "";
}

describe("ConflictFileEditor", () => {
  it("renders the source, current, and result panes seeded with the right content", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();

    await waitFor(() => {
      expect(container.textContent).toContain("source text");
      expect(container.textContent).toContain("current text");
      expect(getResultPaneText(container)).toContain("<<<<<<< HEAD");
    });
  });

  it("renders Accept source / Accept current actions for each conflict block", async () => {
    render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Accept source" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument();
    });
  });

  it("replaces the conflict markers with the current side's text when Accept current is clicked", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("current text");
      expect(resultText).not.toContain("source text");
    });
  });

  it("replaces the conflict markers with the source side's text when Accept source is clicked", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept source" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept source" }));

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("source text");
      expect(resultText).not.toContain("current text");
    });
  });

  it("decorates the changed characters on the source and current sides", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-diff-add")).toBeInTheDocument(); // source side
      expect(container.querySelector(".cm-diff-del")).toBeInTheDocument(); // current side
    });
  });

  it("renders per-line selection checkboxes on the conflict lines", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() => {
      const boxes = container.querySelectorAll(".cm-select-checkbox");
      // one source line + one current line for this single-line conflict
      expect(boxes.length).toBe(2);
    });
  });

  it("composes the result from an individually selected source line", async () => {
    const { container } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    const sourceBox = await waitFor(() => {
      const boxes = container.querySelectorAll<HTMLInputElement>(
        ".cm-select-checkbox",
      );
      expect(boxes.length).toBe(2);
      return boxes[0]!; // Source pane renders first, and boxes.length === 2 above
    });

    fireEvent.click(sourceBox);

    await waitFor(() => {
      const resultText = getResultPaneText(container);
      expect(resultText).not.toContain("<<<<<<< HEAD");
      expect(resultText).toContain("source text");
      expect(resultText).not.toContain("current text");
    });
  });

  it("calls onMarkResolved with the file path and the current result content", async () => {
    const onMarkResolved = vi.fn<(path: string, content: string) => void>();
    render(<ConflictFileEditor file={file} onMarkResolved={onMarkResolved} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));

    await waitFor(() => {
      expect(onMarkResolved).toHaveBeenCalledTimes(1);
      // toHaveBeenCalledTimes(1) above guarantees calls[0] exists.
      const [path, content] = onMarkResolved.mock.calls[0]!;
      expect(path).toBe("src/lib.rs");
      expect(content).toBe(
        ["shared line", "current text", "trailing line"].join("\n"),
      );
    });
  });

  it("clears the result pane's stale text and stale resolved-state when switching to a different conflicted file", async () => {
    const fileA = file;
    const seededResultB = [
      "alpha",
      "<<<<<<< HEAD",
      "beta ours",
      "=======",
      "beta theirs",
      ">>>>>>> feature",
      "gamma",
    ].join("\n");
    const fileB: ConflictedFile = {
      path: "src/other.rs",
      kind: "normalEdit",
      oursContent: "alpha\nbeta ours\ngamma",
      theirsContent: "alpha\nbeta theirs\ngamma",
      baseContent: "alpha\nbeta base\ngamma",
      seededResult: seededResultB,
      conflictBlocks: [
        {
          startLine: 2,
          midLine: 4,
          endLine: 6,
          oursText: "beta ours\n",
          theirsText: "beta theirs\n",
        },
      ],
    };

    const { rerender } = render(
      <ConflictFileEditor file={fileA} onMarkResolved={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("result-pane")).toHaveTextContent(
        "<<<<<<< HEAD",
      );
    });

    rerender(<ConflictFileEditor file={fileB} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      // The CodeMirror doc itself is rebuilt correctly on a path change...
      expect(screen.getByTestId("result-pane")).not.toHaveTextContent(
        "current text",
      );
      expect(screen.getByTestId("result-pane")).not.toHaveTextContent(
        "source text",
      );
      expect(screen.getByTestId("result-pane")).toHaveTextContent("beta ours");
      expect(screen.getByTestId("result-pane")).toHaveTextContent(
        "beta theirs",
      );
    });

    // ...but the freshly-switched-to file's still-unresolved block must not be
    // reported as resolved because the React `resultContent` state used for the
    // resolved-badge check is still pointed at the previous file's text.
    const conflictLabel = await waitFor(() => screen.getByText(/^Conflict 1/));
    expect(conflictLabel.textContent).not.toContain("resolved");
  });

  it("starts a newly selected conflict file with its seeded result and no selections from the previous file", async () => {
    const fileB: ConflictedFile = {
      ...file,
      path: "src/second.rs",
      oursContent: "shared second\nsecond ours\ntrailing second",
      theirsContent: "shared second\nsecond source\ntrailing second",
      baseContent: "shared second\nsecond base\ntrailing second",
      seededResult:
        "shared second\n<<<<<<< HEAD\nsecond ours\n=======\nsecond source\n>>>>>>> feature\ntrailing second",
      conflictBlocks: [
        {
          startLine: 2,
          midLine: 4,
          endLine: 6,
          oursText: "second ours\n",
          theirsText: "second source\n",
        },
      ],
    };
    const { container, rerender } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));
    await waitFor(() =>
      expect(getResultPaneText(container)).not.toContain("<<<<<<< HEAD"),
    );

    rerender(<ConflictFileEditor file={fileB} onMarkResolved={vi.fn()} />);

    await waitFor(() => {
      expect(getResultPaneText(container)).toContain("<<<<<<< HEAD");
      const boxes = container.querySelectorAll<HTMLInputElement>(
        ".cm-select-checkbox",
      );
      expect(boxes).toHaveLength(2);
      expect([...boxes].every((box) => !box.checked)).toBe(true);
    });
  });

  it("rebuilds the result doc when seededResult changes for the same file (resolved externally mid-merge)", async () => {
    const { rerender } = render(
      <ConflictFileEditor file={file} onMarkResolved={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("result-pane")).toHaveTextContent(
        "<<<<<<< HEAD",
      );
    });

    const resolvedExternally: ConflictedFile = {
      ...file,
      seededResult: "shared line\ncurrent text\ntrailing line",
      conflictBlocks: [],
    };
    rerender(
      <ConflictFileEditor file={resolvedExternally} onMarkResolved={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("result-pane")).not.toHaveTextContent(
        "<<<<<<< HEAD",
      );
      expect(screen.getByTestId("result-pane")).toHaveTextContent(
        "current text",
      );
    });
  });

  it("reports dirty via onDirtyChange when the result diverges from the seeded text via a real editor edit", async () => {
    const onDirtyChange = vi.fn();
    render(
      <ConflictFileEditor
        file={file}
        onMarkResolved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    // Mount seeds resultContent === file.seededResult, so the initial report is "clean".
    await waitFor(() =>
      expect(onDirtyChange).toHaveBeenCalledWith("src/lib.rs", false),
    );
    onDirtyChange.mockClear();

    // "Accept current" dispatches a real change into the live CodeMirror
    // EditorView (the same `updateListener`/`docChanged` path a keystroke
    // takes) — this is not a mocked/simulated dirty flag.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept current" }));

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith("src/lib.rs", true);
    });
  });

  it("does not require onDirtyChange — it remains an optional prop", async () => {
    expect(() =>
      render(<ConflictFileEditor file={file} onMarkResolved={vi.fn()} />),
    ).not.toThrow();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Accept current" }),
      ).toBeInTheDocument(),
    );
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Accept current" })),
    ).not.toThrow();
  });
});
