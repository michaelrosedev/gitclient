import { useEffect, useState } from "react";
import type { RemoteInfo } from "../../types/github";
import { useGithubStore } from "../../stores/githubStore";
import { useRepoStore } from "../../stores/repoStore";
import { PRRow } from "./PRRow";
import { NewPRForm } from "./NewPRForm";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

export function PRPanel() {
  const remoteInfo = useGithubStore((state) => state.remoteInfo);
  const activeRepoPath = useRepoStore((state) => state.activeRepoPath);

  if (!remoteInfo) {
    return (
      <EmptyState message="No GitHub remote detected for this repository." />
    );
  }

  // A host alone does not define a PR view: two repositories can share a host,
  // and the same GitHub repository can be open at multiple local paths.
  const viewKey = [
    activeRepoPath,
    remoteInfo.host,
    remoteInfo.owner,
    remoteInfo.repo,
  ].join("\u0000");

  return <PRPanelContent key={viewKey} remoteInfo={remoteInfo} />;
}

function PRPanelContent({ remoteInfo }: { remoteInfo: RemoteInfo }) {
  const pullRequests = useGithubStore((state) => state.pullRequests);
  const loadPullRequests = useGithubStore((state) => state.loadPullRequests);
  const prDraft = useGithubStore((state) => state.prDraft);
  const setPrDraft = useGithubStore((state) => state.setPrDraft);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadPullRequests(remoteInfo.host).catch((e) => {
      if (!cancelled) setError(String(e));
    });

    return () => {
      cancelled = true;
    };
  }, [remoteInfo.host, loadPullRequests]);

  // A graph-provided draft always opens the form. Manual form visibility is
  // controlled only by the explicit create and close actions below.
  const showNewForm = prDraft !== null || isCreating;

  const closeNewForm = () => {
    setIsCreating(false);
    setPrDraft(null);
  };

  const toggleNewForm = () => {
    if (showNewForm) {
      closeNewForm();
    } else {
      setIsCreating(true);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-primary)",
          }}
        >
          Pull Requests · {remoteInfo.owner}/{remoteInfo.repo}
        </span>
        <Button variant="primary" size="sm" onClick={toggleNewForm}>
          New Pull Request
        </Button>
      </div>

      {showNewForm && (
        <NewPRForm
          initialHead={prDraft?.head}
          initialBase={prDraft?.base}
          onCreated={closeNewForm}
          onCancel={closeNewForm}
        />
      )}

      {error && (
        <div
          style={{
            padding: "var(--space-3)",
            color: "var(--color-danger)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {pullRequests.length === 0 ? (
          <EmptyState message="No open pull requests." />
        ) : (
          pullRequests.map((pr) => <PRRow key={pr.number} pr={pr} />)
        )}
      </div>
    </div>
  );
}
