import { useEffect, useReducer, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/TabBar/TabBar";
import { NavBar } from "./components/NavBar/NavBar";
import { CommitGraph } from "./components/CommitGraph/CommitGraph";
import { HistoryToolbar } from "./components/CommitGraph/HistoryToolbar";
import { CommitDetail } from "./components/CommitDetail/CommitDetail";
import { UncommittedPanel } from "./components/WorkingTree/UncommittedPanel";
import { StageFileEditor } from "./components/WorkingTree/StageFileEditor";
import { PRPanel } from "./components/PRPanel/PRPanel";
import { MergeEditor } from "./components/Merge/MergeEditor";
import { MergeCommitDialog } from "./components/Merge/MergeCommitDialog";
import { SettingsView } from "./components/Settings/SettingsView";
import { WelcomeView } from "./components/Welcome/WelcomeView";
import { SplashScreen } from "./components/Splash/SplashScreen";
import { ToastContainer } from "./components/ui/Toast";
import { AutoStashDialog } from "./components/common/AutoStashDialog";
import { ResizeHandle } from "./components/common/ResizeHandle";
import { HookOutputPane } from "./components/GitHooks/HookOutputPane";
import { HookStatusBar } from "./components/GitHooks/HookStatusBar";
import { usePersistedWidth } from "./lib/usePersistedWidth";
import { usePersistedSize } from "./lib/usePersistedSize";
import { usePersistedBoolean } from "./lib/usePersistedBoolean";
import { applyDiagnosticsPref } from "./lib/diagnostics";
import { shouldScanWorkingTree } from "./lib/workingTreeSync";
import { listen } from "@tauri-apps/api/event";
import { useRepoStore } from "./stores/repoStore";
import { useGraphStore } from "./stores/graphStore";
import { useCommitFileStore } from "./stores/commitFileStore";
import { useGithubStore } from "./stores/githubStore";
import { useRemoteStore } from "./stores/remoteStore";
import { useMergeStore } from "./stores/mergeStore";
import { useTagStore } from "./stores/tagStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkingTreeStore } from "./stores/workingTreeStore";
import { useToastStore } from "./stores/toastStore";
import {
  initHookListeners,
  selectHookRun,
  useHookStore,
} from "./stores/hookStore";
import type { View, HistoryRightMode } from "./types/view";
import type { OperationStatus } from "./types/merge";

// How many history rows to warm during boot so the graph isn't blank on reveal.
const BOOT_GRAPH_LIMIT = 150;

interface MergePresentationState {
  previousStatus: OperationStatus;
  hadConflicts: boolean;
}

function createMergePresentationState(
  status: OperationStatus,
): MergePresentationState {
  return {
    previousStatus: status,
    hadConflicts: status.kind === "merge" && status.conflicts.length > 0,
  };
}

function mergePresentationReducer(
  state: MergePresentationState,
  status: OperationStatus,
): MergePresentationState {
  if (status.kind !== "merge") return createMergePresentationState(status);

  return {
    previousStatus: status,
    hadConflicts:
      (state.previousStatus.kind === "merge" && state.hadConflicts) ||
      status.conflicts.length > 0,
  };
}

function RepositoryView({
  repoPath,
  historyRightMode,
  onHistoryRightModeChange,
  detailWidth,
  onResizeDetail,
  hookPaneHeight,
  onResizeHookPane,
  onStartPullRequest,
}: {
  repoPath: string | null;
  historyRightMode: HistoryRightMode;
  onHistoryRightModeChange: (mode: HistoryRightMode) => void;
  detailWidth: number;
  onResizeDetail: (updater: (width: number) => number) => void;
  hookPaneHeight: number;
  onResizeHookPane: (height: number) => void;
  onStartPullRequest: (head: string, base: string) => void;
}) {
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const { selectedOid } = useGraphStore();
  const {
    path: commitFilePath,
    contents: commitFileContents,
    clear: clearCommitFile,
  } = useCommitFileStore();
  const {
    selectedPath: wtSelectedPath,
    stageMode: wtStageMode,
    stageDiff: wtStageDiff,
    clearSelectedFile,
    discardFile,
    stageFile,
    applyIndexContent,
  } = useWorkingTreeStore();
  const currentHookRun = useHookStore((s) => selectHookRun(repoPath)(s));

  const enterUncommitted = () => {
    clearSelectedFile();
    clearCommitFile();
    onHistoryRightModeChange("uncommitted");
  };
  const exitUncommitted = () => {
    clearSelectedFile();
    onHistoryRightModeChange("commit");
  };

  const showingUncommittedDiff =
    historyRightMode === "uncommitted" &&
    wtSelectedPath != null &&
    wtStageDiff != null;
  // A file picked from a commit's changed-files list opens its (read-only) diff in
  // the main panel, the same surface staging uses.
  const showingCommitFileDiff =
    historyRightMode === "commit" &&
    commitFilePath != null &&
    commitFileContents != null;

  return (
    <>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <HistoryToolbar onJumpToHead={exitUncommitted} />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {showingUncommittedDiff && wtSelectedPath && wtStageDiff ? (
            <StageFileEditor
              path={wtSelectedPath}
              contents={wtStageDiff}
              stageMode={wtStageMode ?? "unstaged"}
              onApplyIndex={(path, content) => {
                // Return the promise (not fire-and-forget): StageFileEditor's
                // per-line toggle guard awaits this to know when the index
                // write has actually landed, so a second toggle fired before
                // it resolves is ignored rather than composed from stale rows.
                return applyIndexContent(path, content).catch((e: unknown) => {
                  useToastStore
                    .getState()
                    .error(String(e), { title: "Stage failed" });
                });
              }}
              onStageWholeFile={(path) => {
                stageFile(path).catch((e: unknown) =>
                  useToastStore
                    .getState()
                    .error(String(e), { title: "Stage failed" }),
                );
              }}
              onDiscardFile={(path) => {
                discardFile(path).catch((e: unknown) =>
                  useToastStore
                    .getState()
                    .error(String(e), { title: "Discard failed" }),
                );
              }}
              onClose={clearSelectedFile}
              leftLabel={wtStageMode === "staged" ? "HEAD" : "Staged"}
              rightLabel={wtStageMode === "staged" ? "Staged" : "Working tree"}
            />
          ) : showingCommitFileDiff && commitFilePath && commitFileContents ? (
            <StageFileEditor
              readOnly
              path={commitFilePath}
              contents={commitFileContents}
              leftLabel="Parent"
              rightLabel="This commit"
              onClose={clearCommitFile}
            />
          ) : (
            <CommitGraph
              onStartPullRequest={onStartPullRequest}
              onViewChanges={enterUncommitted}
              onCommitSelect={exitUncommitted}
            />
          )}
        </div>
        {repoPath && currentHookRun?.paneVisible && (
          <HookOutputPane
            repoPath={repoPath}
            height={hookPaneHeight}
            onResize={onResizeHookPane}
          />
        )}
        {repoPath && <HookStatusBar repoPath={repoPath} />}
      </div>
      <ResizeHandle
        ariaLabel="Resize detail panel"
        onResize={(dx) => onResizeDetail((w) => w - dx)}
      />
      <div
        className="elevation-left"
        style={{
          width: detailWidth,
          flexShrink: 0,
          background: "var(--color-bg-panel)",
          borderLeft: "1px solid var(--color-border-subtle)",
          overflow: "hidden",
        }}
      >
        {historyRightMode === "uncommitted" ? (
          <UncommittedPanel
            branch={currentRepo?.headBranch ?? null}
            onCommitted={exitUncommitted}
          />
        ) : (
          <CommitDetail oid={selectedOid} />
        )}
      </div>
    </>
  );
}

export default function App() {
  const { loadCurrentRepo, loadOpenRepos, currentRepo, loadBranches } =
    useRepoStore();
  const { init, setPrDraft, detectRemote } = useGithubStore();
  const invalidateAheadBehind = useRemoteStore((s) => s.invalidateAheadBehind);
  const loadRemoteTags = useTagStore((s) => s.loadRemoteTags);
  const { status: operationStatus, loadStatus } = useMergeStore();
  const { initTheme } = useThemeStore();
  const [view, setView] = useState<View>("history");
  const repoPath = currentRepo?.path ?? null;
  const [historyPanel, setHistoryPanel] = useState<{
    repoPath: string | null;
    mode: HistoryRightMode;
  }>({ repoPath, mode: "commit" });
  if (historyPanel.repoPath !== repoPath) {
    setHistoryPanel({ repoPath, mode: "commit" });
  }
  const [sidebarWidth, setSidebarWidth] = usePersistedWidth(
    "sidebarWidth",
    220,
    160,
    400,
  );
  const [detailWidth, setDetailWidth] = usePersistedWidth(
    "detailWidth",
    380,
    280,
    720,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean(
    "sidebarCollapsed",
    false,
  );
  const [hookPaneHeight, setHookPaneHeight] = usePersistedSize(
    "hookOutputPaneHeight",
    180,
    100,
    480,
  );
  const [booted, setBooted] = useState(false);
  const [bootTask, setBootTask] = useState("Starting…");

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void initHookListeners().then((unlisten) => {
      if (cancelled) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Latches whether the in-progress merge ever had conflicts, so the surface
  // (full-screen editor vs. floating commit dialog) is decided once at merge
  // start and doesn't flip when the last conflict is resolved.
  const [mergePresentation, dispatchOperationStatus] = useReducer(
    mergePresentationReducer,
    operationStatus,
    createMergePresentationState,
  );
  if (mergePresentation.previousStatus !== operationStatus) {
    dispatchOperationStatus(operationStatus);
  }

  // No active repo (initial launch, a "new tab", or the last repo closed) lands
  // on the welcome view — except in Settings, which stands alone.
  const showWelcome = !currentRepo && view !== "settings";

  const handleStartPullRequest = (head: string, base: string) => {
    setPrDraft({ head, base });
    setView("prs");
  };

  // One-time boot: restore state behind the splash screen, then reveal the app.
  // Local/cheap work is awaited so the graph isn't blank on reveal; network-bound
  // work (GitHub) is deferred to after reveal so it can't stall the splash.
  useEffect(() => {
    let cancelled = false;
    const task = (t: string) => {
      if (!cancelled) setBootTask(t);
    };
    void (async () => {
      try {
        task("Loading theme…");
        await initTheme();
        task("Restoring session…");
        await Promise.all([loadCurrentRepo(), loadOpenRepos()]);
        // Resolve any in-progress merge before reveal so we don't flash the
        // normal UI and then swap to the merge editor.
        await loadStatus();
        if (useRepoStore.getState().currentRepo) {
          task("Loading history…");
          // The per-repo effect loads branches/remote/ahead-behind; we also warm
          // the first graph slice so the graph has content on reveal.
          await useGraphStore
            .getState()
            .fetchViewport(0, BOOT_GRAPH_LIMIT)
            .catch(() => {});
        }
      } catch {
        // Boot is best-effort — always reveal the app so the user isn't stuck on
        // the splash if a restore step fails.
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initTheme, loadCurrentRepo, loadOpenRepos, loadStatus]);

  // Network-bound startup work runs after reveal so it can't stall the splash.
  useEffect(() => {
    if (!booted) return;
    void init();
    applyDiagnosticsPref().catch(() => {});
  }, [booted, init]);

  // Load everything scoped to the active repo whenever it changes. This lives at
  // the app root (not in the Sidebar) so it runs even when the sidebar is
  // collapsed — otherwise the remote wouldn't be detected and the push/pull
  // buttons (gated on a detected remote) would stay disabled.
  useEffect(() => {
    if (!repoPath) return;
    // Ahead/behind is fetched per-branch, on demand, by each sidebar row
    // (see remoteStore.requestAheadBehind) — but a previous repo's cached
    // counts could collide by branch name (e.g. both have "main"), so clear
    // them on every repo switch rather than leaving them to be overwritten
    // only when/if that same-named row happens to re-request.
    invalidateAheadBehind();
    void (async () => {
      try {
        await Promise.all([loadBranches(), detectRemote()]);
      } catch (e) {
        useToastStore
          .getState()
          .error(String(e), { title: "Couldn't load repository state" });
      }
    })();
    // Best-effort: populates the tag local/remote indicator (network ls-remote).
    void loadRemoteTags();
  }, [
    repoPath,
    loadBranches,
    detectRemote,
    invalidateAheadBehind,
    loadRemoteTags,
  ]);

  // The file watcher marks the working tree dirty; the poll consumes the flag to
  // decide whether the (potentially expensive) `git status` scan is worth
  // running this tick. See `lib/workingTreeSync`.
  const wtDirtyRef = useRef(true);
  const pollTickRef = useRef(0);

  // App-level file-watcher subscription: while a repo is open, flag the working
  // tree dirty whenever the backend emits `working-tree-changed` (git-ignored
  // churn is already filtered out backend-side). This runs on every view — the
  // StagingPanel keeps its own subscription for the live sub-second refresh
  // there; here we only record that *something* changed so the poll can skip the
  // scan when nothing has.
  useEffect(() => {
    if (!repoPath) return;
    // A freshly-opened/activated repo starts dirty so the first poll re-affirms
    // the working-tree baseline for the graph's dirty-file node.
    wtDirtyRef.current = true;
    pollTickRef.current = 0;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen("working-tree-changed", () => {
      wtDirtyRef.current = true;
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [repoPath]);

  // Background poll: while a repo is open, periodically re-sync the working tree
  // and graph so changes made outside the app — or while not on the uncommitted
  // view (where the file watcher's live refresh runs) — appear without needing a
  // restart. On a large monorepo the `git status` scan is costly, so a clean
  // tick (nothing flagged by the watcher since the last scan) skips it entirely;
  // a periodic backstop still forces a scan to recover any dropped watcher
  // event. HEAD is cheap to re-check, so `syncHead` runs every tick regardless
  // (an external `git checkout` must move the "current branch" marker). The
  // manual "Check for changes" toolbar button runs the full refresh on demand.
  useEffect(() => {
    if (!repoPath) return;
    let running = false;
    const tick = async () => {
      // Skip when a tick is still in flight or the window is hidden.
      if (running || document.hidden) return;
      running = true;
      try {
        const scan = shouldScanWorkingTree(
          wtDirtyRef.current,
          pollTickRef.current,
        );
        pollTickRef.current += 1;
        // Clear before scanning so a change landing mid-scan re-arms the flag.
        wtDirtyRef.current = false;
        await Promise.all([
          scan
            ? useWorkingTreeStore.getState().refreshAll()
            : Promise.resolve(),
          useRepoStore.getState().syncHead(),
        ]);
      } catch {
        // Best-effort: a transient failure must not break the poll.
      } finally {
        running = false;
      }
    };
    const id = setInterval(() => void tick(), 8000);
    return () => clearInterval(id);
  }, [repoPath]);

  // Re-sync as soon as the window regains focus, so changes made in a terminal
  // while the app was in the background (e.g. `git checkout` on another branch)
  // are reflected immediately rather than on the next poll tick.
  useEffect(() => {
    if (!repoPath) return;
    const onFocus = () => {
      void useRepoStore.getState().syncHead();
      void useWorkingTreeStore.getState().refreshAll();
      // A terminal `git fetch`/checkout while backgrounded could change any
      // branch's ahead/behind — invalidate so currently-rendered rows
      // re-request fresh counts instead of showing stale ones.
      useRemoteStore.getState().invalidateAheadBehind();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [repoPath]);

  if (!booted) {
    return <SplashScreen task={bootTask} />;
  }

  // A merge with conflicts takes over the whole screen (the full-screen editor);
  // a clean merge keeps the app visible and just floats a commit-message dialog.
  // `mergePresentation.hadConflicts` latches so the editor stays put after the last conflict
  // is resolved (rather than flipping to the dialog mid-resolution).
  const mergeInProgress = operationStatus.kind === "merge";
  const conflictCount = mergeInProgress ? operationStatus.conflicts.length : 0;
  const showMergeEditor =
    mergeInProgress && (conflictCount > 0 || mergePresentation.hadConflicts);
  const showMergeCommitDialog = mergeInProgress && !showMergeEditor;

  if (showMergeEditor) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          overflow: "hidden",
          background: "var(--color-bg-app)",
          color: "var(--color-text-primary)",
        }}
      >
        <MergeEditor />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
      }}
    >
      <TabBar />
      <NavBar
        view={view}
        onViewChange={setView}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      />
      <div
        style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}
      >
        {!sidebarCollapsed && (
          <>
            <Sidebar width={sidebarWidth} />
            <ResizeHandle
              ariaLabel="Resize sidebar"
              onResize={(dx) => setSidebarWidth((w) => w + dx)}
            />
          </>
        )}

        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {showWelcome ? (
            <WelcomeView />
          ) : view === "history" ? (
            <RepositoryView
              repoPath={repoPath}
              historyRightMode={historyPanel.mode}
              onHistoryRightModeChange={(mode) =>
                setHistoryPanel((state) => ({ ...state, mode }))
              }
              detailWidth={detailWidth}
              onResizeDetail={setDetailWidth}
              hookPaneHeight={hookPaneHeight}
              onResizeHookPane={setHookPaneHeight}
              onStartPullRequest={handleStartPullRequest}
            />
          ) : view === "prs" ? (
            <PRPanel />
          ) : (
            <SettingsView />
          )}
        </div>
      </div>
      {showMergeCommitDialog && <MergeCommitDialog />}
      <AutoStashDialog />
      <ToastContainer />
    </div>
  );
}
