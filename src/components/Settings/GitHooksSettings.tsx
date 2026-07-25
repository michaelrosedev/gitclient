import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useRepoStore } from "../../stores/repoStore";
import type { HookPreferences } from "../../types/hooks";

const descriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  maxWidth: 560,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-primary)",
};

export function GitHooksSettings() {
  const repoPath = useRepoStore((state) => state.currentRepo?.path ?? null);

  if (repoPath === null) {
    return (
      <p style={descriptionStyle}>
        Open a repository to configure its Git hooks.
      </p>
    );
  }

  return <HookPreferencesForm key={repoPath} repoPath={repoPath} />;
}

function HookPreferencesForm({ repoPath }: { repoPath: string }) {
  const requestIdRef = useRef(0);
  const [preferences, setPreferences] = useState<HookPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    void invoke<HookPreferences>("get_hook_preferences", { repoPath }).then(
      (loaded) => {
        if (requestId !== requestIdRef.current) return;
        setPreferences(loaded);
        setLoading(false);
      },
      (loadError) => {
        if (requestId !== requestIdRef.current) return;
        setError(String(loadError));
        setLoading(false);
      },
    );

    return () => {
      requestIdRef.current += 1;
    };
  }, [repoPath]);

  const persist = async (next: HookPreferences) => {
    const requestId = requestIdRef.current;
    setSaving(true);
    setError(null);
    try {
      const confirmed = await invoke<HookPreferences>("set_hook_preferences", {
        repoPath,
        preferences: next,
      });
      if (requestId !== requestIdRef.current) return;
      setPreferences(confirmed);
    } catch (saveError) {
      if (requestId !== requestIdRef.current) return;
      setError(String(saveError));
    } finally {
      if (requestId === requestIdRef.current) setSaving(false);
    }
  };

  const disabled = loading || saving || preferences === null;
  const confirmed = preferences ?? { preCommit: true, prePush: true };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <p style={descriptionStyle}>
        Choose which hooks Git Wasp runs for this repository. Hooks are enabled
        by default; these settings do not affect Git in a terminal or another
        client.
      </p>

      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={confirmed.preCommit}
          disabled={disabled}
          onChange={() =>
            void persist({ ...confirmed, preCommit: !confirmed.preCommit })
          }
        />
        Run pre-commit
      </label>

      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={confirmed.prePush}
          disabled={disabled}
          onChange={() =>
            void persist({ ...confirmed, prePush: !confirmed.prePush })
          }
        />
        Run pre-push
      </label>

      {error && (
        <span
          role="alert"
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
