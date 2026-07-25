import { useEffect, useState } from "react";
import { useGithubStore } from "../../stores/githubStore";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { DeviceFlowModal } from "../GitHub/DeviceFlowModal";
import type {
  GithubConnection,
  GithubConnectionState,
} from "../../types/github";

// Re-validate the connection on this cadence while Settings is open, so a
// token that's revoked elsewhere is caught without a manual check.
const POLL_MS = 60_000;
const DISCONNECTED_CONNECTION: GithubConnection = {
  state: "disconnected",
  login: null,
  message: null,
};

const DOT_COLOR: Record<GithubConnectionState, string> = {
  connected: "var(--color-success)",
  expired: "var(--color-danger)",
  error: "var(--color-warning)",
  checking: "var(--color-text-muted)",
  disconnected: "var(--color-text-muted)",
};

function statusLabel(conn: GithubConnection, host: string): string {
  switch (conn.state) {
    case "checking":
      return conn.login
        ? `Connected as ${conn.login} · ${host}`
        : `Checking connection · ${host}…`;
    case "connected":
      return `Connected as ${conn.login ?? "?"} · ${host}`;
    case "expired":
      return `Connection expired — reconnect · ${host}`;
    case "error":
      return `Couldn't verify connection · ${host}`;
    case "disconnected":
    default:
      return `Not connected · ${host}`;
  }
}

/**
 * GitHub connection management, moved out of the sidebar into Settings. The
 * status is *validated* (a real `GET /user` check via `checkConnection`), so it
 * distinguishes a working connection from a stale/revoked token, and it
 * re-checks periodically while open.
 */
export function GithubSettings() {
  const remoteInfo = useGithubStore((s) => s.remoteInfo);
  const connections = useGithubStore((s) => s.connections);
  const checkConnection = useGithubStore((s) => s.checkConnection);
  const logout = useGithubStore((s) => s.logout);
  const [connecting, setConnecting] = useState(false);

  const host = remoteInfo?.host ?? "github.com";
  const conn: GithubConnection = connections[host] ?? DISCONNECTED_CONNECTION;

  // A re-check flips the store state to "checking"; keep the last resolved state
  // on screen so the buttons stay put (no layout shift) — they're just disabled
  // with a spinner while the check is in flight.
  const [lastResolved, setLastResolved] = useState<GithubConnection>(conn);

  useEffect(() => {
    if (conn.state === "checking") return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLastResolved(conn);
    });
    return () => {
      cancelled = true;
    };
  }, [conn]);

  const handleLogout = () => {
    logout(host).catch((e: unknown) =>
      useToastStore
        .getState()
        .error(String(e), { title: "Couldn't disconnect" }),
    );
  };

  useEffect(() => {
    void checkConnection(host);
    const id = setInterval(() => void checkConnection(host), POLL_MS);
    const onFocus = () => void checkConnection(host);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [host, checkConnection]);

  const busy = conn.state === "checking";
  const view = busy ? lastResolved : conn;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: DOT_COLOR[view.state],
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-secondary)",
          }}
        >
          {statusLabel(view, host)}
        </span>
        {busy && (
          <Spinner size={12} style={{ color: "var(--color-text-muted)" }} />
        )}
      </div>

      {view.state === "error" && view.message && (
        <div
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          {view.message}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        {view.state === "connected" && (
          <>
            <Button onClick={handleLogout} disabled={busy}>
              Disconnect
            </Button>
            <Button onClick={() => void checkConnection(host)} loading={busy}>
              Check now
            </Button>
          </>
        )}
        {view.state === "expired" && (
          <>
            <Button
              variant="primary"
              onClick={() => setConnecting(true)}
              disabled={busy}
            >
              Reconnect
            </Button>
            <Button onClick={handleLogout} disabled={busy}>
              Disconnect
            </Button>
          </>
        )}
        {view.state === "disconnected" && (
          <Button
            variant="primary"
            onClick={() => setConnecting(true)}
            disabled={busy}
          >
            Connect
          </Button>
        )}
        {view.state === "error" && (
          <Button onClick={() => void checkConnection(host)} loading={busy}>
            Retry
          </Button>
        )}
      </div>

      {connecting && (
        <DeviceFlowModal
          host={host}
          onClose={() => {
            setConnecting(false);
            void checkConnection(host);
          }}
        />
      )}
    </div>
  );
}
