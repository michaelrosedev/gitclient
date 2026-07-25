import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CommitForm } from "./CommitForm";
import { useWorkingTreeStore } from "../../stores/workingTreeStore";
import { useGraphStore } from "../../stores/graphStore";
import { useRepoStore } from "../../stores/repoStore";
import { useHookStore } from "../../stores/hookStore";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const mockOpenUrl = vi.mocked(openUrl);

let createCommit: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let amendCommitMessage: ReturnType<typeof vi.fn<(message: string) => Promise<void>>>;
let discardAll: ReturnType<typeof vi.fn<() => Promise<void>>>;
let createBranch: ReturnType<typeof vi.fn<(name: string, startPoint?: string) => Promise<void>>>;
let checkoutBranch: ReturnType<typeof vi.fn<(name: string) => Promise<boolean>>>;
let fastForwardBranch: ReturnType<typeof vi.fn<(branch: string, target: string) => Promise<void>>>;
let listFastForwardableBranches: ReturnType<typeof vi.fn<(target: string) => Promise<string[]>>>;

beforeEach(() => {
  vi.clearAllMocks();
  createCommit = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  amendCommitMessage = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
  discardAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  createBranch = vi.fn<(name: string, startPoint?: string) => Promise<void>>().mockResolvedValue(undefined);
  checkoutBranch = vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true);
  fastForwardBranch = vi.fn<(branch: string, target: string) => Promise<void>>().mockResolvedValue(undefined);
  listFastForwardableBranches = vi.fn<(target: string) => Promise<string[]>>().mockResolvedValue([]);
  useWorkingTreeStore.setState({
    identity: { name: "A", email: "a@a" },
    headCommit: null,
    loadIdentity: vi.fn().mockResolvedValue(undefined),
    loadHeadCommit: vi.fn().mockResolvedValue(undefined),
    createCommit,
    amendCommitMessage,
    discardAll,
  });
  useGraphStore.setState({ fetchViewport: vi.fn().mockResolvedValue(undefined) });
  // Default: on a branch (not detached). Individual detached tests override.
  useRepoStore.setState({
    currentRepo: { name: "r", path: "/r", headBranch: "main" },
    createBranch,
    checkoutBranch,
    fastForwardBranch,
    listFastForwardableBranches,
  });
  useHookStore.setState({ runs: {} });
});

describe("CommitForm", () => {
  it("locks repository commit and amend actions while its hook-aware operation runs", () => {
    useRepoStore.setState({
      currentRepo: { name: "r", path: "/repo", headBranch: "main" },
    });
    useWorkingTreeStore.setState({
      headCommit: { oid: "abc", message: "Old", pushed: false },
    });
    useHookStore.getState().started({
      repoPath: "/repo",
      runId: "run-1",
      hook: "pre-commit",
      operation: "commit",
    });

    render(<CommitForm stagedCount={1} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Change" } });

    expect(screen.getByRole("button", { name: "Running pre-commit…" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/amend last commit/i));
    expect(screen.getByRole("button", { name: "Amend" })).toBeDisabled();
  });

  it("disables Commit until there is a staged file and a subject", () => {
    const { rerender } = render(<CommitForm stagedCount={0} />);
    expect(screen.getByRole("button", { name: /^commit/i })).toBeDisabled();

    rerender(<CommitForm stagedCount={2} />);
    expect(screen.getByRole("button", { name: /^commit/i })).toBeDisabled(); // no subject yet

    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "My change" } });
    expect(screen.getByRole("button", { name: /^commit/i })).toBeEnabled();
  });

  it("composes subject and body into one message", async () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Add feature" } });
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "Some **details**." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() =>
      expect(createCommit).toHaveBeenCalledWith("Add feature\n\nSome **details**."),
    );
  });

  it("renders a markdown preview of the body", () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "**bold**" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("clicking a link in the markdown preview opens it via the opener plugin instead of navigating the webview", async () => {
    render(<CommitForm stagedCount={0} />);
    fireEvent.change(screen.getByPlaceholderText(/description/i), {
      target: { value: "[link](https://example.com)" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await userEvent.click(screen.getByRole("link", { name: "link" }));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/");
  });

  it("calls onCommitted after a successful commit", async () => {
    const onCommitted = vi.fn();
    render(<CommitForm stagedCount={1} onCommitted={onCommitted} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("does not call onCommitted when the commit fails", async () => {
    createCommit.mockRejectedValueOnce(new Error("nope"));
    const onCommitted = vi.fn();
    render(<CommitForm stagedCount={1} onCommitted={onCommitted} />);
    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Done" } });
    fireEvent.click(screen.getByRole("button", { name: /^commit/i }));

    await waitFor(() => expect(createCommit).toHaveBeenCalled());
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("hides the amend toggle when there is no HEAD commit", () => {
    useWorkingTreeStore.setState({ headCommit: null });
    render(<CommitForm stagedCount={0} />);
    expect(screen.queryByLabelText(/amend last commit/i)).not.toBeInTheDocument();
  });

  it("hides the amend toggle when the HEAD commit is already pushed", () => {
    useWorkingTreeStore.setState({
      headCommit: { oid: "abc", message: "pushed", pushed: true },
    });
    render(<CommitForm stagedCount={0} />);
    expect(screen.queryByLabelText(/amend last commit/i)).not.toBeInTheDocument();
  });

  it("prefills the form from the HEAD message and amends on submit", async () => {
    useWorkingTreeStore.setState({
      headCommit: { oid: "abc", message: "Old subject\n\nOld body", pushed: false },
    });
    render(<CommitForm stagedCount={0} />);

    // Entering amend mode prefills subject + body and allows commit with nothing staged.
    fireEvent.click(screen.getByLabelText(/amend last commit/i));
    expect(screen.getByPlaceholderText<HTMLInputElement>(/summary/i).value).toBe("Old subject");
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(/description/i).value).toBe("Old body");

    const amendButton = screen.getByRole("button", { name: /^amend/i });
    expect(amendButton).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "New subject" } });
    fireEvent.click(amendButton);

    await waitFor(() =>
      expect(amendCommitMessage).toHaveBeenCalledWith("New subject\n\nOld body"),
    );
    expect(createCommit).not.toHaveBeenCalled();
  });

  describe("on a detached HEAD", () => {
    const detach = () =>
      useRepoStore.setState({
        currentRepo: { name: "r", path: "/r", headBranch: null },
      });

    it("blocks the normal commit and requires creating a branch", () => {
      detach();
      useWorkingTreeStore.setState({ headCommit: { oid: "abc123", message: "m", pushed: false } });
      render(<CommitForm stagedCount={1} />);

      expect(screen.getByRole("alert")).toHaveTextContent(/detached head/i);
      expect(screen.queryByRole("button", { name: /^commit/i })).not.toBeInTheDocument();

      const createBtn = screen.getByRole("button", { name: /create branch & commit/i });
      // A subject alone isn't enough — a branch name is required.
      fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Fix" } });
      expect(createBtn).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/new branch name/i), { target: { value: "fix/bug" } });
      expect(createBtn).toBeEnabled();
    });

    it("creates the branch, switches to it, then commits — in order", async () => {
      detach();
      useWorkingTreeStore.setState({ headCommit: { oid: "abc123", message: "m", pushed: false } });
      render(<CommitForm stagedCount={1} />);

      fireEvent.change(screen.getByPlaceholderText(/summary/i), { target: { value: "Fix bug" } });
      fireEvent.change(screen.getByLabelText(/new branch name/i), { target: { value: "fix/bug" } });
      fireEvent.click(screen.getByRole("button", { name: /create branch & commit/i }));

      await waitFor(() => expect(createCommit).toHaveBeenCalledWith("Fix bug"));
      expect(createBranch).toHaveBeenCalledWith("fix/bug");
      expect(checkoutBranch).toHaveBeenCalledWith("fix/bug");
      // Branch must exist and be current before the commit lands on it.
      // Each mock's toHaveBeenCalledWith assertion above guarantees at least
      // one invocation, so invocationCallOrder[0] always exists.
      expect(createBranch.mock.invocationCallOrder[0]!).toBeLessThan(
        checkoutBranch.mock.invocationCallOrder[0]!,
      );
      expect(checkoutBranch.mock.invocationCallOrder[0]!).toBeLessThan(
        createCommit.mock.invocationCallOrder[0]!,
      );
    });

    it("offers to fast-forward eligible branches and switch to them", async () => {
      detach();
      useWorkingTreeStore.setState({ headCommit: { oid: "abc123", message: "m", pushed: false } });
      listFastForwardableBranches.mockResolvedValue(["main"]);
      render(<CommitForm stagedCount={1} />);

      const ffBtn = await screen.findByRole("button", { name: /fast-forward main & switch/i });
      fireEvent.click(ffBtn);

      await waitFor(() => expect(fastForwardBranch).toHaveBeenCalledWith("main", "abc123"));
      expect(checkoutBranch).toHaveBeenCalledWith("main");
    });

    it("does not carry a previous detached HEAD's recovery branches into the next detached HEAD", async () => {
      let resolveFirstLookup: (branches: string[]) => void;
      const firstLookup = new Promise<string[]>((resolve) => { resolveFirstLookup = resolve; });
      listFastForwardableBranches.mockImplementation((oid) =>
        oid === "first" ? firstLookup : Promise.resolve(["release"]),
      );
      detach();
      useWorkingTreeStore.setState({ headCommit: { oid: "first", message: "m", pushed: false } });
      const { rerender } = render(<CommitForm stagedCount={1} />);
      act(() => { useRepoStore.setState({ currentRepo: { name: "r", path: "/r", headBranch: "main" } }); });
      rerender(<CommitForm stagedCount={1} />);
      act(() => {
        detach();
        useWorkingTreeStore.setState({ headCommit: { oid: "second", message: "m", pushed: false } });
      });
      rerender(<CommitForm stagedCount={1} />);
      resolveFirstLookup!(["main"]);

      expect(await screen.findByRole("button", { name: /fast-forward release & switch/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /fast-forward main & switch/i })).not.toBeInTheDocument();
    });

    it("Cmd+Enter from the summary input routes through branch creation, not a bare commit, while detached", async () => {
      detach();
      render(<CommitForm stagedCount={1} />);
      await userEvent.type(screen.getByPlaceholderText("Summary (required)"), "msg");
      fireEvent.change(screen.getByLabelText(/new branch name/i), { target: { value: "fix/bug" } });
      // Refocus the summary input — changing the branch-name field above moved focus.
      screen.getByPlaceholderText("Summary (required)").focus();
      await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

      // Proof the routing mechanism itself fired handleCreateBranchAndCommit, not
      // handleCommit's own internal !canCommit no-op: createBranch/checkoutBranch
      // only happen on the detached-recovery path.
      await waitFor(() => expect(createBranch).toHaveBeenCalledWith("fix/bug"));
      expect(checkoutBranch).toHaveBeenCalledWith("fix/bug");
      expect(createCommit).toHaveBeenCalledWith("msg");
    });

    it("Cmd+Enter from the body textarea also routes through branch creation while detached", async () => {
      detach();
      render(<CommitForm stagedCount={1} />);
      await userEvent.type(screen.getByPlaceholderText("Summary (required)"), "msg");
      fireEvent.change(screen.getByLabelText(/new branch name/i), { target: { value: "fix/bug" } });
      await userEvent.type(screen.getByPlaceholderText(/description/i), "details");
      await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

      await waitFor(() => expect(createBranch).toHaveBeenCalledWith("fix/bug"));
      expect(checkoutBranch).toHaveBeenCalledWith("fix/bug");
      expect(createCommit).toHaveBeenCalledWith("msg\n\ndetails");
    });
  });

  it("Reset opens a confirm dialog and discards all on confirm", async () => {
    render(<CommitForm stagedCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: /^reset/i }));

    // Dialog appears; confirm the destructive action.
    expect(screen.getByRole("dialog", { name: /discard all changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discard everything/i }));

    await waitFor(() => expect(discardAll).toHaveBeenCalledTimes(1));
  });
});
