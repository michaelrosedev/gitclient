import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CommitDetail } from "./CommitDetail";
import "@testing-library/jest-dom";
import { useCommitFileStore } from "../../stores/commitFileStore";
import { useToastStore } from "../../stores/toastStore";
import type { CommitDetail as CommitDetailData } from "../../types/repo";

const mockInvoke = vi.mocked(invoke);

const fakeDetail: CommitDetailData = {
  oid: "abc123def456",
  message: "fix: do the thing",
  authorName: "Alice",
  authorEmail: "alice@example.com",
  authorTimestamp: 1000000000,
  committerName: "Alice",
  committerTimestamp: 1000000000,
  parentOids: [],
  changedFiles: [
    {
      path: "src/main.rs",
      oldPath: null,
      status: "Modified",
      additions: 5,
      deletions: 2,
    },
    {
      path: "README.md",
      oldPath: null,
      status: "Added",
      additions: 10,
      deletions: 0,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useCommitFileStore.setState({ oid: null, path: null, contents: null });
});

describe("CommitDetail", () => {
  it("shows placeholder when oid is null", () => {
    render(<CommitDetail oid={null} />);
    expect(screen.getByText(/select a commit/i)).toBeTruthy();
  });

  it("calls get_commit_diff with the correct oid", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail); // get_commit_diff

    render(<CommitDetail oid="abc123" />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_commit_diff", {
        oid: "abc123",
      });
    });
  });

  it("renders commit message and author after loading", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail);

    render(<CommitDetail oid="abc123def456" />);

    await waitFor(() => {
      expect(screen.getByText("fix: do the thing")).toBeTruthy();
    });
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it("renders the file list with changed files", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail);

    render(<CommitDetail oid="abc123def456" />);

    await waitFor(() => {
      expect(screen.getByText("src/main.rs")).toBeTruthy();
    });
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("does not auto-load any file diff (the graph stays in the main panel)", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail);

    render(<CommitDetail oid="abc123def456" />);

    await waitFor(() => expect(screen.getByText("src/main.rs")).toBeTruthy());
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "get_commit_file_contents",
      expect.anything(),
    );
  });

  it("loads the commit file diff into the store when a file is selected", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail); // get_commit_diff
    mockInvoke.mockResolvedValueOnce({
      headContent: "old\n",
      worktreeContent: "new\n",
      isBinary: false,
      worktreeExists: true,
    }); // get_commit_file_contents

    render(<CommitDetail oid="abc123def456" />);

    fireEvent.click(await screen.findByText("src/main.rs"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_contents", {
        oid: "abc123def456",
        path: "src/main.rs",
        oldPath: null,
      });
    });
    expect(useCommitFileStore.getState().path).toBe("src/main.rs");
  });

  it("shows a toast instead of throwing when loading the commit fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("no such commit"));
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<CommitDetail oid="abc123def456" />);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no such commit", {
        title: "Couldn't load commit",
      }),
    );
  });

  it("shows a toast instead of throwing when loading a file's diff fails", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail); // get_commit_diff
    mockInvoke.mockRejectedValueOnce(new Error("no such file")); // get_commit_file_contents
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<CommitDetail oid="abc123def456" />);
    fireEvent.click(await screen.findByText("src/main.rs"));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no such file", {
        title: "Couldn't load diff",
      }),
    );
  });

  it("drops a stale diff response when the selected commit changed before it resolved", async () => {
    let resolveA: (v: CommitDetailData) => void;
    const pendingA = new Promise<CommitDetailData>((r) => {
      resolveA = r;
    });
    mockInvoke.mockImplementationOnce(() => pendingA);
    const { rerender } = render(<CommitDetail oid="A" />);
    mockInvoke.mockResolvedValueOnce({
      ...fakeDetail,
      oid: "B",
      message: "B's message",
    });
    rerender(<CommitDetail oid="B" />);
    await screen.findByText("B's message");
    resolveA!({ ...fakeDetail, oid: "A", message: "A's message" });

    // Use waitFor to give the microtask queue time to process the stale response
    await waitFor(() => {
      expect(screen.queryByText("A's message")).not.toBeInTheDocument();
    });
  });

  it("clears the detail immediately when the selected commit is removed", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail);
    const { rerender } = render(<CommitDetail oid="abc123def456" />);

    await screen.findByText("fix: do the thing");
    rerender(<CommitDetail oid={null} />);

    expect(screen.getByText(/select a commit/i)).toBeInTheDocument();
    expect(screen.queryByText("fix: do the thing")).not.toBeInTheDocument();
  });

  it("does not show a previous commit while the next commit is loading", async () => {
    mockInvoke.mockResolvedValueOnce(fakeDetail);
    const { rerender } = render(<CommitDetail oid="A" />);

    await screen.findByText("fix: do the thing");
    const pendingB = new Promise<CommitDetailData>(() => {});
    mockInvoke.mockImplementationOnce(() => pendingB);
    rerender(<CommitDetail oid="B" />);

    expect(screen.getByText(/select a commit/i)).toBeInTheDocument();
    expect(screen.queryByText("fix: do the thing")).not.toBeInTheDocument();
  });
});
