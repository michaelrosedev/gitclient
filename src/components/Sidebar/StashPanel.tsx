import { useEffect, useState } from "react";
import type { StashEntry } from "../../types/workingTree";
import { useRepoStore } from "../../stores/repoStore";
import { useStashStore } from "../../stores/stashStore";
import { useToastStore } from "../../stores/toastStore";
import { CollapsibleSection } from "./CollapsibleSection";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../common/ConfirmDialog";

export function StashPanel() {
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);

  return <StashPanelForRepo key={activeRepoPath ?? "no-active-repository"} />;
}

function StashPanelForRepo() {
  const activeRepoPath = useRepoStore((s) => s.activeRepoPath);
  const entries = useStashStore((s) => s.entries);
  const list = useStashStore((s) => s.list);
  const reset = useStashStore((s) => s.reset);
  const apply = useStashStore((s) => s.apply);
  const pop = useStashStore((s) => s.pop);
  const drop = useStashStore((s) => s.drop);
  const [loading, setLoading] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<StashEntry | null>(null);

  useEffect(() => {
    // Clear immediately so the previous repo's stashes don't linger while the
    // fresh list loads. The repo-keyed component boundary clears local
    // confirmation state when switching repositories.
    reset();
    list().catch((e: unknown) =>
      useToastStore.getState().error(String(e), { title: "Couldn't load stashes" }),
    );
  }, [activeRepoPath, list, reset]);

  // Catches internally (rather than at each call site) since apply/pop/drop
  // each need the same loading + error-toast wrapping around their store call.
  const run = async (action: () => Promise<void>, failTitle: string) => {
    setLoading(true);
    try {
      await action();
    } catch (e) {
      useToastStore.getState().error(String(e), { title: failTitle });
    } finally {
      setLoading(false);
    }
  };

  if (entries.length === 0) return null;

  return (
    <CollapsibleSection
      id="stashes"
      title="Stashes"
      resizable
      defaultHeight={140}
    >
      {entries.map((s) => (
        <div
          key={s.index}
          style={{
            padding: "var(--space-1) var(--space-3)",
          }}
        >
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: "var(--space-1)",
            }}
            title={s.message}
          >
            {s.message}
          </div>
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            {(["Apply", "Pop", "Drop"] as const).map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "Drop" ? "danger" : "secondary"}
                disabled={loading}
                onClick={() => {
                  if (action === "Apply") void run(() => apply(s.index), "Stash apply failed");
                  else if (action === "Pop") void run(() => pop(s.index), "Stash pop failed");
                  else setPendingDrop(s);
                }}
              >
                {action}
              </Button>
            ))}
          </div>
        </div>
      ))}

      {pendingDrop && (
        <ConfirmDialog
          title="Drop stash"
          message={`Drop "${pendingDrop.message}"? This permanently deletes the stashed changes and cannot be undone.`}
          confirmLabel="Drop"
          onConfirm={() => {
            const s = pendingDrop;
            setPendingDrop(null);
            void run(() => drop(s.index), "Stash drop failed");
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </CollapsibleSection>
  );
}
