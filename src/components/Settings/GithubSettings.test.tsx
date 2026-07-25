import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { GithubSettings } from "./GithubSettings";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";
import type { GithubConnection } from "../../types/github";

let checkConnection: ReturnType<typeof vi.fn<(host: string) => Promise<void>>>;
let logout: ReturnType<typeof vi.fn<(host: string) => Promise<void>>>;

function seed(connection?: GithubConnection) {
  useGithubStore.setState({
    remoteInfo: null,
    connections: connection ? { "github.com": connection } : {},
    checkConnection,
    logout,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkConnection = vi
    .fn<(host: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  logout = vi
    .fn<(host: string) => Promise<void>>()
    .mockResolvedValue(undefined);
});

describe("GithubSettings", () => {
  it("validates the connection on mount", () => {
    seed();
    render(<GithubSettings />);
    expect(checkConnection).toHaveBeenCalledWith("github.com");
  });

  it("shows the connected user and disconnects", () => {
    seed({ state: "connected", login: "mike", message: null });
    render(<GithubSettings />);

    expect(screen.getByText(/Connected as mike/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(logout).toHaveBeenCalledWith("github.com");
  });

  it("shows a toast instead of throwing when disconnect fails", async () => {
    logout.mockRejectedValue(new Error("network down"));
    const error = vi.fn();
    useToastStore.setState({ error });
    seed({ state: "connected", login: "mike", message: null });

    render(<GithubSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: network down", {
        title: "Couldn't disconnect",
      }),
    );
  });

  it("offers Connect when disconnected", () => {
    seed({ state: "disconnected", login: null, message: null });
    render(<GithubSettings />);
    expect(screen.getByText(/Not connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("flags an expired token and offers Reconnect", () => {
    seed({ state: "expired", login: null, message: null });
    render(<GithubSettings />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reconnect" }),
    ).toBeInTheDocument();
  });

  it("keeps the buttons visible but disabled while a re-check is in flight", () => {
    seed({ state: "connected", login: "mike", message: null });
    render(<GithubSettings />);

    // The store flips to "checking" during a re-validation.
    act(() => {
      useGithubStore.setState({
        connections: {
          "github.com": { state: "checking", login: "mike", message: null },
        },
      });
    });

    const disconnect = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnect).toBeInTheDocument();
    expect(disconnect).toBeDisabled();
    // The connected status (and its user) stays on screen rather than vanishing.
    expect(screen.getByText(/Connected as mike/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check now" }),
    ).toBeInTheDocument();
  });

  it("keeps the last resolved connection visible while checking, then shows a verification error", () => {
    seed({ state: "connected", login: "mike", message: null });
    render(<GithubSettings />);

    act(() => {
      useGithubStore.setState({
        connections: {
          "github.com": { state: "checking", login: "mike", message: null },
        },
      });
    });

    expect(screen.getByText(/Connected as mike/)).toBeInTheDocument();
    expect(document.querySelector("[data-spinner]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();

    act(() => {
      useGithubStore.setState({
        connections: {
          "github.com": {
            state: "error",
            login: null,
            message: "network down",
          },
        },
      });
    });

    expect(screen.getByText(/Couldn't verify connection/)).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("surfaces the error message and a Retry when verification fails", () => {
    seed({ state: "error", login: null, message: "network down" });
    render(<GithubSettings />);
    expect(screen.getByText(/Couldn't verify connection/)).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // Once on mount, once on Retry.
    expect(checkConnection).toHaveBeenCalledTimes(2);
  });
});
