import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { SegmentedControl, type SegmentOption } from "../ui/SegmentedControl";
import { Input } from "../ui/Input";
import { useToastStore } from "../../stores/toastStore";
import {
  getIdentityConfig,
  setIdentity,
  type IdentityScope,
} from "../../lib/identity";
import type { Identity, IdentityConfig } from "../../types/workingTree";

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  width: 64,
  flexShrink: 0,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  marginBottom: "var(--space-3)",
  maxWidth: 560,
};

const SCOPE_OPTIONS: SegmentOption<IdentityScope>[] = [
  { value: "local", label: "This repository" },
  { value: "global", label: "Global" },
];

function ScopeToggle({
  value,
  onChange,
}: {
  value: IdentityScope;
  onChange: (s: IdentityScope) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="Identity scope"
      options={SCOPE_OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}

const scopeIdentity = (
  config: IdentityConfig,
  scope: IdentityScope,
): Identity | null => (scope === "local" ? config.local : config.global);

/**
 * Settings → Git identity. Shows the effective commit identity and lets the user
 * set the name/email either for the current repository (local) or globally. The
 * form prefills from the selected scope's stored values (falling back to the
 * effective identity), so editing always targets the chosen scope.
 */
export function GitIdentitySettings() {
  const [config, setConfig] = useState<IdentityConfig | null>(null);
  const [scope, setScope] = useState<IdentityScope>("local");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toastSuccess = useToastStore((s) => s.success);

  useEffect(() => {
    getIdentityConfig().then(setConfig, (e) => setError(String(e)));
  }, []);

  const initialIdentity = config
    ? (scopeIdentity(config, scope) ?? config.effective)
    : { name: "", email: "" };

  const handleSave = async (name: string, email: string) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await setIdentity(name.trim(), email.trim(), scope);
      setConfig(updated);
      toastSuccess(
        `Saved ${scope === "global" ? "global" : "repository"} identity`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <p style={descriptionStyle}>
        The name and email recorded on the commits you make. Set it just for
        this repository or globally for all repositories.
      </p>

      {config && (
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-muted)",
          }}
        >
          Commits here use{" "}
          <span style={{ color: "var(--color-text-primary)" }}>
            {config.effective.name || "(no name)"} &lt;
            {config.effective.email || "no email"}&gt;
          </span>
        </div>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}
      >
        <span style={labelStyle}>Scope</span>
        <ScopeToggle value={scope} onChange={setScope} />
      </div>

      <IdentityForm
        key={JSON.stringify([
          scope,
          initialIdentity.name,
          initialIdentity.email,
        ])}
        initialIdentity={initialIdentity}
        saving={saving}
        onSave={handleSave}
      />

      {error && (
        <span
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

function IdentityForm({
  initialIdentity,
  saving,
  onSave,
}: {
  initialIdentity: Identity;
  saving: boolean;
  onSave: (name: string, email: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialIdentity.name);
  const [email, setEmail] = useState(initialIdentity.email);
  const canSave = name.trim().length > 0 && email.trim().length > 0 && !saving;

  return (
    <>
      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}
      >
        <span style={labelStyle}>Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Name"
          aria-label="Identity name"
          style={{ flex: 1, maxWidth: 360 }}
        />
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}
      >
        <span style={labelStyle}>Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Identity email"
          style={{ flex: 1, maxWidth: 360 }}
        />
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
      >
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave}
          loading={saving}
          onClick={() => void onSave(name.trim(), email.trim())}
        >
          Save
        </Button>
      </div>
    </>
  );
}
