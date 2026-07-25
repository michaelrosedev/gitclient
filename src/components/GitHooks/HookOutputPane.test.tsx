import { act, render, screen } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoHookRun } from "../../stores/hookStore";
import { useHookStore } from "../../stores/hookStore";
import { HookOutputPane } from "./HookOutputPane";

const xterm = vi.hoisted(() => {
  const terminal = {
    open: vi.fn(),
    loadAddon: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    scrollToBottom: vi.fn(),
    dispose: vi.fn(),
    onScroll: vi.fn(),
    buffer: { active: { baseY: 0, viewportY: 0 } },
  };
  return {
    terminal,
    scroll: undefined as undefined | (() => void),
    writeCallbacks: [] as Array<() => void>,
    disposable: { dispose: vi.fn() },
  };
});

const fitAddon = vi.hoisted(() => ({
  fit: vi.fn(),
}));

const resizeObserver = vi.hoisted(() => ({
  callback: undefined as ResizeObserverCallback | undefined,
  observe: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    xterm.terminal.onScroll.mockImplementation((callback: () => void) => {
      xterm.scroll = callback;
      return xterm.disposable;
    });
    return xterm.terminal;
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return fitAddon;
  }),
}));

vi.stubGlobal(
  "ResizeObserver",
  vi.fn(function (callback: ResizeObserverCallback) {
    resizeObserver.callback = callback;
    return {
      observe: resizeObserver.observe,
      disconnect: resizeObserver.disconnect,
    };
  }),
);

function seedRun(overrides: Partial<RepoHookRun> = {}) {
  useHookStore.setState({
    runs: {
      "/repo": {
        runId: "run-1",
        hook: "pre-commit",
        operation: "commit",
        status: "running",
        chunks: [],
        retainedLength: 0,
        summary: null,
        paneVisible: true,
        following: true,
        ...overrides,
      },
    },
  });
}

function append(chunk: string) {
  act(() => {
    useHookStore.getState().appendOutput({
      repoPath: "/repo",
      runId: "run-1",
      stream: "stdout",
      chunk,
    });
  });
}

function seedOtherRun(overrides: Partial<RepoHookRun> = {}) {
  useHookStore.setState((state) => ({
    runs: {
      ...state.runs,
      "/other": {
        runId: "run-other",
        hook: "pre-push",
        operation: "push",
        status: "running",
        chunks: [],
        retainedLength: 0,
        summary: null,
        paneVisible: true,
        following: true,
        ...overrides,
      },
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  xterm.scroll = undefined;
  xterm.writeCallbacks = [];
  resizeObserver.callback = undefined;
  xterm.terminal.write.mockImplementation(
    (_chunk: string, callback?: () => void) => {
      if (callback) xterm.writeCallbacks.push(callback);
    },
  );
  xterm.terminal.buffer.active.baseY = 0;
  xterm.terminal.buffer.active.viewportY = 0;
  useHookStore.setState({ runs: {} });
});

describe("HookOutputPane", () => {
  it("returns to column zero when output contains a newline", () => {
    seedRun();
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        convertEol: true,
      }),
    );
  });

  it("fits the terminal to the output host and refits when the host resizes", () => {
    seedRun();
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);

    expect(xterm.terminal.loadAddon).toHaveBeenCalledWith(fitAddon);
    expect(fitAddon.fit).toHaveBeenCalledOnce();
    expect(resizeObserver.observe).toHaveBeenCalledOnce();

    act(() => resizeObserver.callback?.([], {} as ResizeObserver));
    expect(fitAddon.fit).toHaveBeenCalledTimes(2);
  });

  it("replays retained chunks and writes new chunks exactly once", () => {
    seedRun({
      chunks: [{ stream: "stdout", chunk: "first\r\n" }],
      retainedLength: 7,
    });
    const { rerender } = render(
      <HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />,
    );
    expect(xterm.terminal.write).toHaveBeenCalledWith("first\r\n");

    append("second\r\n");
    rerender(
      <HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />,
    );
    expect(xterm.terminal.write).toHaveBeenCalledWith("second\r\n");
    expect(
      xterm.terminal.write.mock.calls
        .map((call) => String(call[0]))
        .filter((chunk) => chunk !== ""),
    ).toEqual(["first\r\n", "second\r\n"]);
  });

  it("clears and replays when a run is replaced or its prefix changes", () => {
    seedRun({
      chunks: [
        { stream: "stdout", chunk: "first" },
        { stream: "stdout", chunk: "second" },
      ],
      retainedLength: 11,
    });
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);

    act(() => {
      seedRun({
        runId: "run-2",
        chunks: [{ stream: "stderr", chunk: "replacement" }],
        retainedLength: 11,
      });
    });

    expect(xterm.terminal.clear).toHaveBeenCalledOnce();
    expect(xterm.terminal.write).toHaveBeenCalledWith("replacement");
  });

  it("pauses follow when scrolled up and resumes at bottom", () => {
    seedRun();
    seedOtherRun();
    const { rerender } = render(
      <HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />,
    );

    rerender(
      <HookOutputPane repoPath="/other" height={180} onResize={vi.fn()} />,
    );
    xterm.terminal.buffer.active.baseY = 20;
    xterm.terminal.buffer.active.viewportY = 10;
    act(() => xterm.scroll?.());
    expect(useHookStore.getState().runs["/repo"]?.following).toBe(true);
    expect(useHookStore.getState().runs["/other"]?.following).toBe(false);

    xterm.terminal.buffer.active.viewportY = 20;
    act(() => xterm.scroll?.());
    expect(useHookStore.getState().runs["/other"]?.following).toBe(true);
  });

  it("scrolls only after xterm has processed the appended output", () => {
    seedRun({
      chunks: [{ stream: "stdout", chunk: "pending" }],
      retainedLength: 7,
    });
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
    expect(xterm.terminal.scrollToBottom).not.toHaveBeenCalled();

    act(() => xterm.writeCallbacks[xterm.writeCallbacks.length - 1]?.());

    expect(xterm.terminal.scrollToBottom).toHaveBeenCalledOnce();
  });

  it("does not scroll from a queued write after the pane is hidden and disposed", () => {
    seedRun({
      chunks: [{ stream: "stdout", chunk: "pending" }],
      retainedLength: 7,
    });
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
    const queuedScroll = xterm.writeCallbacks[xterm.writeCallbacks.length - 1]!;

    act(() => useHookStore.getState().setPaneVisible("/repo", false));
    act(() => queuedScroll());

    expect(xterm.terminal.dispose).toHaveBeenCalledOnce();
    expect(xterm.terminal.scrollToBottom).not.toHaveBeenCalled();
  });

  it("does not scroll from a queued write after switching the visible repository", () => {
    seedRun({
      chunks: [{ stream: "stdout", chunk: "old" }],
      retainedLength: 3,
    });
    seedOtherRun({
      chunks: [{ stream: "stdout", chunk: "new" }],
      retainedLength: 3,
    });
    const { rerender } = render(
      <HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />,
    );
    const queuedOldScroll =
      xterm.writeCallbacks[xterm.writeCallbacks.length - 1]!;

    rerender(
      <HookOutputPane repoPath="/other" height={180} onResize={vi.fn()} />,
    );
    act(() => queuedOldScroll());

    expect(xterm.terminal.scrollToBottom).not.toHaveBeenCalled();
  });

  it("resumes follow from the button and scrolls to bottom", async () => {
    seedRun({ following: false });
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Follow output" }),
    );
    expect(useHookStore.getState().runs["/repo"]?.following).toBe(true);
    expect(xterm.terminal.scrollToBottom).toHaveBeenCalled();
  });

  it("creates the terminal when retained output is shown after a hidden mount", () => {
    seedRun({
      paneVisible: false,
      chunks: [{ stream: "stdout", chunk: "retained" }],
      retainedLength: 8,
    });
    render(<HookOutputPane repoPath="/repo" height={180} onResize={vi.fn()} />);
    expect(xterm.terminal.open).not.toHaveBeenCalled();

    act(() => useHookStore.getState().setPaneVisible("/repo", true));

    expect(xterm.terminal.open).toHaveBeenCalledOnce();
    expect(xterm.terminal.write).toHaveBeenCalledWith("retained");
  });

  it("closes, forwards resize deltas, and disposes terminal resources", async () => {
    seedRun();
    const onResize = vi.fn();
    const { unmount } = render(
      <HookOutputPane repoPath="/repo" height={180} onResize={onResize} />,
    );
    screen
      .getByRole("separator", { name: "Resize hook output" })
      .dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
    window.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientY: 90 }),
    );
    expect(onResize).toHaveBeenCalledWith(-10);

    await userEvent.click(
      screen.getByRole("button", { name: "Close hook output" }),
    );
    expect(useHookStore.getState().runs["/repo"]?.paneVisible).toBe(false);
    unmount();
    expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
    expect(xterm.disposable.dispose).toHaveBeenCalledOnce();
    expect(xterm.terminal.dispose).toHaveBeenCalledOnce();
  });
});
