import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import "@testing-library/jest-dom";
import { PRPanel } from "./PRPanel";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";

const mockInvoke = vi.mocked(invoke);

const fakePrs = [
  {
    number: 1,
    title: "Add feature",
    author: "mike",
    headRef: "feat/x",
    baseRef: "main",
    url: "https://github.com/mike/gitclient/pull/1",
    ciStatus: "success" as const,
    approvalCount: 1,
  },
  {
    number: 2,
    title: "Fix bug",
    author: "alice",
    headRef: "fix/y",
    baseRef: "main",
    url: "https://github.com/mike/gitclient/pull/2",
    ciStatus: "failure" as const,
    approvalCount: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
    remoteInfo: {
      host: "github.com",
      owner: "mike",
      repo: "gitclient",
      protocol: "https",
    },
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
    prDraft: null,
  });
});

describe("PRPanel", () => {
  it("loads and renders open pull requests", async () => {
    mockInvoke.mockResolvedValueOnce(fakePrs);

    render(<PRPanel />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("list_pull_requests", {
        host: "github.com",
      });
    });
    expect(await screen.findByText("Add feature")).toBeTruthy();
    expect(screen.getByText("Fix bug")).toBeTruthy();
  });

  it("shows an empty state when there are no open PRs", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(<PRPanel />);

    expect(await screen.findByText(/no open pull requests/i)).toBeTruthy();
  });

  it("shows the New PR form when the button is clicked", async () => {
    mockInvoke.mockResolvedValueOnce([]);

    render(<PRPanel />);

    await screen.findByText(/no open pull requests/i);
    fireEvent.click(screen.getByRole("button", { name: /new pull request/i }));

    expect(screen.getByPlaceholderText(/title/i)).toBeTruthy();
  });

  it("auto-opens the New PR form pre-seeded from a pr draft and clears it on cancel", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    useGithubStore.setState({ prDraft: { head: "feat/x", base: "develop" } });
    useRepoStore.setState({
      currentRepo: { name: "gitclient", path: "/repo", headBranch: "feat/x" },
      recentRepos: [],
      branches: [],
    });

    render(<PRPanel />);

    expect(await screen.findByDisplayValue("feat/x")).toBeTruthy();
    expect(screen.getByDisplayValue("develop")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useGithubStore.getState().prDraft).toBeNull();
  });

  it("opens the New PR form when a draft arrives after the panel mounts", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    useRepoStore.setState({
      currentRepo: { name: "gitclient", path: "/repo", headBranch: "feat/x" },
      recentRepos: [],
      branches: [],
    });

    render(<PRPanel />);

    await screen.findByText(/no open pull requests/i);
    expect(screen.queryByPlaceholderText(/title/i)).toBeNull();

    act(() => {
      useGithubStore.setState({
        prDraft: { head: "feat/later", base: "release" },
      });
    });

    expect(await screen.findByDisplayValue("feat/later")).toBeTruthy();
    expect(screen.getByDisplayValue("release")).toBeTruthy();
  });

  it("shows a message when no GitHub remote is detected", () => {
    useGithubStore.setState({ remoteInfo: null });

    render(<PRPanel />);

    expect(screen.getByText(/no github remote/i)).toBeTruthy();
  });

  it("clears a previous error banner once a later load succeeds", async () => {
    useRepoStore.setState({
      currentRepo: { name: "repoA", path: "/repoA", headBranch: "main" },
      activeRepoPath: "/repoA",
      recentRepos: [],
      branches: [],
    });
    mockInvoke.mockRejectedValueOnce(new Error("rate limited"));
    const { rerender } = render(<PRPanel />);
    expect(await screen.findByText(/rate limited/i)).toBeInTheDocument();

    // Switch to a different repo on the same host — a fresh load should clear
    // the stale error banner from the previous repo, even on success.
    mockInvoke.mockResolvedValueOnce([]);
    act(() => {
      useRepoStore.setState({
        currentRepo: { name: "repoB", path: "/repoB", headBranch: "main" },
        activeRepoPath: "/repoB",
        recentRepos: [],
        branches: [],
      });
    });
    rerender(<PRPanel />);

    await waitFor(() =>
      expect(screen.queryByText(/rate limited/i)).not.toBeInTheDocument(),
    );
  });

  it("clears a previous load error and reloads when the GitHub repository changes", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("rate limited"));
    render(<PRPanel />);
    expect(await screen.findByText(/rate limited/i)).toBeInTheDocument();

    const pendingReload = new Promise<never>(() => {});
    mockInvoke.mockImplementationOnce(() => pendingReload);
    act(() => {
      useGithubStore.setState({
        remoteInfo: {
          host: "github.com",
          owner: "mike",
          repo: "another-repo",
          protocol: "https",
        },
      });
    });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/rate limited/i)).not.toBeInTheDocument();
    expect(screen.getByText(/mike\/another-repo/i)).toBeInTheDocument();
  });

  it("reloads pull requests when the active repo path changes, even with the same remote host", async () => {
    useRepoStore.setState({
      currentRepo: { name: "repoA", path: "/repoA", headBranch: "main" },
      activeRepoPath: "/repoA",
      recentRepos: [],
      branches: [],
    });
    mockInvoke.mockResolvedValueOnce(fakePrs);
    const { rerender } = render(<PRPanel />);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("list_pull_requests", {
        host: "github.com",
      }),
    );
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Switch to a different repo whose remote is on the same host — the
    // effect must re-key on activeRepoPath, not just remoteInfo.host.
    mockInvoke.mockResolvedValueOnce([]);
    act(() => {
      useRepoStore.setState({
        currentRepo: { name: "repoB", path: "/repoB", headBranch: "main" },
        activeRepoPath: "/repoB",
        recentRepos: [],
        branches: [],
      });
    });
    rerender(<PRPanel />);

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_pull_requests", {
      host: "github.com",
    });
  });
});
