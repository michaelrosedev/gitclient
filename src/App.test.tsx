import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore, WORKING_TREE_OID } from "./stores/graphStore";
import { useGithubStore } from "./stores/githubStore";
import { useRemoteStore } from "./stores/remoteStore";
import { useMergeStore } from "./stores/mergeStore";
import { useTagStore } from "./stores/tagStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";
import { useToastStore } from "./stores/toastStore";
import type { GraphNode } from "./types/graph";
import type { StageFileContents } from "./types/workingTree";
import type { ConflictedFile } from "./types/merge";
import * as hookStore from "./stores/hookStore";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("./components/GitHooks/HookOutputPane", () => ({
  HookOutputPane: ({ height }: { height: number }) => (
    <section aria-label="Hook output" style={{ height }} />
  ),
}));
vi.mock("./components/Settings/SettingsView", () => ({
  SettingsView: () => <div>Settings view</div>,
}));

const mockListen = vi.mocked(listen);

const repo = { name: "gitclient", path: "/repo", headBranch: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  // Collapse the sidebar so App's tree doesn't also have to drive Sidebar's
  // own (unrelated) branch/stash data — this test is only about the
  // repo-scoped effect at the App root.
  localStorage.setItem("sidebarCollapsed", "true");
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  mockListen.mockResolvedValue(() => {});

  useThemeStore.setState({ initTheme: vi.fn().mockResolvedValue(undefined) });

  useRepoStore.setState({
    currentRepo: repo,
    openRepos: [repo],
    activeRepoPath: repo.path,
    recentRepos: [],
    branches: [],
    activationEpoch: 0,
    loadCurrentRepo: vi.fn().mockResolvedValue(undefined),
    loadOpenRepos: vi.fn().mockResolvedValue(undefined),
    loadRecentRepos: vi.fn().mockResolvedValue(undefined),
    loadBranches: vi.fn().mockResolvedValue(undefined),
    syncHead: vi.fn().mockResolvedValue(undefined),
    openRepo: vi.fn().mockResolvedValue(undefined),
    activateRepo: vi.fn().mockResolvedValue(undefined),
    closeRepo: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn(),
    checkoutBranch: vi.fn().mockResolvedValue(true),
    checkoutRemoteBranch: vi.fn().mockResolvedValue(undefined),
  });

  useGraphStore.setState({
    viewport: null,
    selectedOid: null,
    fetchViewport: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    revealHead: vi.fn().mockResolvedValue(undefined),
  });

  useGithubStore.setState({
    remoteInfo: null,
    pullRequests: [],
    init: vi.fn().mockResolvedValue(undefined),
    detectRemote: vi.fn().mockResolvedValue(undefined),
    setPrDraft: vi.fn(),
  });

  useRemoteStore.setState({
    aheadBehind: new Map(),
    aheadBehindEpoch: 0,
    isFetching: false,
    isPulling: false,
    isPushing: false,
    invalidateAheadBehind: vi.fn(),
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "fastForwarded" }),
    push: vi.fn().mockResolvedValue(undefined),
  });

  useMergeStore.setState({
    status: { kind: "none" },
    loadStatus: vi.fn().mockResolvedValue(undefined),
  });

  useTagStore.setState({ loadRemoteTags: vi.fn().mockResolvedValue(undefined) });

  useWorkingTreeStore.setState({
    refreshAll: vi.fn().mockResolvedValue(undefined),
  });
  hookStore.useHookStore.setState({ runs: {} });
});

afterEach(() => {
  localStorage.removeItem("sidebarCollapsed");
  localStorage.removeItem("hookOutputPaneHeight");
  vi.restoreAllMocks();
});

describe("App repo-scoped effect", () => {
  it("shows a toast instead of throwing when loading repo-scoped state fails", async () => {
    useRepoStore.setState({ loadBranches: vi.fn().mockRejectedValue(new Error("backend unavailable")) });
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<App />);
    // Boot completes asynchronously (splash screen) before the repo-scoped
    // effect's promises settle.
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: backend unavailable", {
        title: "Couldn't load repository state",
      }),
    );
  });
});

// The synthetic working-tree row the graph renders for uncommitted changes —
// clicking it (via CommitGraph's handleRowClick) is App's real, user-driven
// path into the uncommitted-diff view (App.tsx's `enterUncommitted`, wired as
// CommitGraph's `onViewChanges` prop).
const workingTreeNode: GraphNode = {
  oid: WORKING_TREE_OID,
  shortOid: "",
  summary: "Uncommitted changes",
  authorName: "",
  authorEmail: "",
  authorTimestamp: 0,
  lane: 0,
  row: 0,
  colorIndex: 0,
  parents: [],
  children: [],
  edges: [],
  branchLabels: [],
  isHead: false,
  onHeadLine: true,
  isWorkingTree: true,
  changeCount: 2,
};

// Two independent line modifications, so the rendered per-line diff carries
// (at least) two distinct stage toggles to click — mirrors
// StageFileEditor.test.tsx's `twoChanges` fixture.
const twoChanges: StageFileContents = {
  headContent: "a\nb\nc\nd\ne\n",
  worktreeContent: "a\nB\nc\nD\ne\n",
  isBinary: false,
  worktreeExists: true,
};

describe("App per-line staging guard", () => {
  it("ignores a second per-line stage toggle fired through App's real onApplyIndex wiring while the first is still applying", async () => {
    let resolveFirst!: () => void;
    // A real (not fire-and-forget) promise, so this proves the guard is fed by
    // App.tsx's actual `onApplyIndex` wiring — not a mock standing in for it,
    // the way StageFileEditor.test.tsx's isolated version of this test does.
    const applyIndexContent = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveFirst = r;
        }),
    );

    useGraphStore.setState({
      viewport: { nodes: [workingTreeNode], totalCount: 1, offset: 0, headRow: null },
    });

    useWorkingTreeStore.setState({
      selectedPath: "f.txt",
      stageMode: "unstaged",
      stageDiff: twoChanges,
      // enterUncommitted() (App.tsx) calls clearSelectedFile() on entering the
      // uncommitted view. Stubbed as a no-op so the pre-seeded selection/diff
      // above survive the working-tree row click below and StageFileEditor
      // renders immediately — without also having to drive the separate
      // file-list-selection flow just to reach the same state.
      clearSelectedFile: vi.fn(),
      discardFile: vi.fn().mockResolvedValue(undefined),
      stageFile: vi.fn().mockResolvedValue(undefined),
      applyIndexContent,
    });

    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    // Drive into the uncommitted-diff view the same way a user would: click
    // the working-tree row in the graph.
    const workingTreeRow = await waitFor(() => {
      const row = container.querySelector<HTMLElement>(`[data-oid="${WORKING_TREE_OID}"]`);
      expect(row).not.toBeNull();
      return row!;
    });
    fireEvent.click(workingTreeRow);

    const toggles = await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".cm-stage-toggle"));
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    });

    // toggles.length >= 2, asserted in the waitFor above.
    fireEvent.click(toggles[0]!);
    // Flush one microtask turn before the second click — mirroring two real,
    // separate click events (each its own browser task, with the microtask
    // queue drained in between). This is what makes the regression this test
    // guards against observable: if App.tsx's onApplyIndex fire-and-forgets
    // instead of returning applyIndexContent's promise, StageFileEditor's
    // guard wraps the returned `undefined` in `Promise.resolve(...)`, whose
    // `.finally` fires on the very next microtask turn — well before the real
    // `applyIndexContent` promise (still pending on `resolveFirst`) settles —
    // so the guard would already be re-armed by the time the second click
    // lands, and this assertion would see two calls instead of one. A
    // same-tick pair of `fireEvent.click`s (no await between them) can't
    // distinguish this, since the guard's synchronous flag-set blocks the
    // second click regardless of the returned-promise timing.
    await Promise.resolve();
    fireEvent.click(toggles[1]!); // fired before the first apply resolves

    expect(applyIndexContent).toHaveBeenCalledTimes(1);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 0)); // let the in-flight promise's `.finally` settle

    // The guard re-arms once the first apply resolves.
    fireEvent.click(toggles[1]!);
    expect(applyIndexContent).toHaveBeenCalledTimes(2);
  });
});

describe("App boot sequence", () => {
  it("reveals the app even when restoring session state fails", async () => {
    useRepoStore.setState({
      currentRepo: null,
      openRepos: [],
      loadCurrentRepo: vi.fn().mockRejectedValue(new Error("disk error")),
      loadOpenRepos: vi.fn().mockRejectedValue(new Error("disk error")),
    });

    render(<App />);

    // Boot is best-effort: a rejected restore step must not leave the user
    // stuck behind the splash screen.
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());
  });
});

describe("App hook integration", () => {
  it("initializes hook listeners once and cleans them up on unmount", async () => {
    const cleanup = vi.fn();
    const init = vi.spyOn(hookStore, "initHookListeners").mockResolvedValue(cleanup);

    const { unmount } = render(<App />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());
    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up listeners that finish initializing after App unmounts", async () => {
    let resolve!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    vi.spyOn(hookStore, "initHookListeners").mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const { unmount } = render(<App />);
    unmount();
    resolve(cleanup);

    await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  });

  it("mounts hook output and status only in the active history graph column", async () => {
    localStorage.setItem("hookOutputPaneHeight", "999");
    hookStore.useHookStore.getState().started({
      repoPath: "/repo",
      runId: "run-1",
      hook: "pre-commit",
      operation: "commit",
    });
    hookStore.useHookStore.getState().appendOutput({
      repoPath: "/repo",
      runId: "run-1",
      stream: "stdout",
      chunk: "checking files",
    });

    render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());
    await waitFor(() => {
      expect(screen.getByRole("region", { name: /hook output/i })).toHaveStyle({ height: "480px" });
      expect(screen.getByRole("contentinfo", { name: /git hook status/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "PRs" }));
    expect(screen.queryByRole("region", { name: /hook output/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo", { name: /git hook status/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.queryByRole("region", { name: /hook output/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo", { name: /git hook status/i })).not.toBeInTheDocument();
  });

  it("does not mount hook UI on welcome or full-screen merge views", async () => {
    useRepoStore.setState({ currentRepo: null, activeRepoPath: null });
    const { rerender } = render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());
    expect(screen.queryByRole("contentinfo", { name: /git hook status/i })).not.toBeInTheDocument();

    useRepoStore.setState({ currentRepo: repo, activeRepoPath: repo.path });
    hookStore.useHookStore.getState().started({
      repoPath: "/repo",
      runId: "run-1",
      hook: "pre-commit",
      operation: "commit",
    });
    useMergeStore.setState({
      status: { kind: "merge", sourceBranch: "feature", conflicts: [oneConflict] },
    });
    rerender(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("contentinfo", { name: /git hook status/i })).not.toBeInTheDocument(),
    );
  });
});

// A minimal non-text conflict (kind "binaryOrUnmergeable") so the merge editor
// mounts NonTextConflictPicker rather than ConflictFileEditor/CodeMirror —
// irrelevant to these tests, which only care whether the full-screen editor
// or the floating commit dialog is showing.
const oneConflict: ConflictedFile = {
  path: "f.txt",
  kind: "binaryOrUnmergeable",
  oursContent: null,
  theirsContent: null,
  baseContent: null,
  seededResult: null,
  conflictBlocks: [],
};

describe("App merge-editor latch", () => {
  it("keeps the full-screen merge editor visible after the last conflict resolves mid-merge", async () => {
    render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());
    expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument();

    // Merge starts with a conflict — the full-screen editor takes over (NavBar
    // and the rest of the app tree are not rendered alongside it).
    useMergeStore.setState({ status: { kind: "merge", sourceBranch: "feature", conflicts: [oneConflict] } });
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "Views" })).not.toBeInTheDocument());

    // The last conflict resolves, but the merge is still in progress — the
    // surface must not flip to the floating commit dialog mid-resolution.
    useMergeStore.setState({ status: { kind: "merge", sourceBranch: "feature", conflicts: [] } });
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "Views" })).not.toBeInTheDocument());
  });

  it("shows the floating commit dialog, not the full-screen editor, for a merge that starts clean", async () => {
    render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    useMergeStore.setState({ status: { kind: "merge", sourceBranch: "feature", conflicts: [] } });

    await waitFor(() => expect(screen.getByRole("tablist", { name: "Views" })).toBeInTheDocument());
  });
});

describe("App background poll", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("always re-syncs HEAD each tick but skips the git-status scan once the working tree is clean", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const refreshAll = vi.fn().mockResolvedValue(undefined);
    const syncHead = vi.fn().mockResolvedValue(undefined);
    useWorkingTreeStore.setState({ refreshAll });
    useRepoStore.setState({ syncHead });

    render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    // Tick 0 (t=8s) always scans: a freshly-opened repo starts flagged dirty
    // regardless of any watcher event (see App.tsx's wtDirtyRef comment).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(syncHead).toHaveBeenCalledTimes(1);

    // Tick 1 (t=16s): nothing flagged the tree dirty since tick 0 — the scan
    // is skipped, but HEAD is cheap enough to re-check every tick regardless.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(syncHead).toHaveBeenCalledTimes(2);
  });

  it("does not start a new poll tick while the previous tick's refresh is still in flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveRefresh!: () => void;
    const refreshAll = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveRefresh = r;
        }),
    );
    const syncHead = vi.fn().mockResolvedValue(undefined);
    useWorkingTreeStore.setState({ refreshAll });
    useRepoStore.setState({ syncHead });

    render(<App />);
    await waitFor(() => expect(screen.queryByText(/starting/i)).not.toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000); // tick 0 starts; refreshAll never resolves
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(syncHead).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000); // tick 1 fires while tick 0 is still in flight
    });
    expect(refreshAll).toHaveBeenCalledTimes(1); // not re-entered
    expect(syncHead).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
