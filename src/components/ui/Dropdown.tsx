import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** A small caret that flips when the dropdown is open. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      data-icon="caret"
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        flexShrink: 0,
        opacity: 0.7,
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform var(--duration-fast) var(--ease-default)",
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Viewport-relative placement of the portaled panel, measured from the trigger.
interface PanelPos {
  top: number;
  left?: number;
  right?: number;
  width?: number;
}

// The panel is rendered in a portal to document.body with `position: fixed`, so
// it escapes the NavBar's stacking context (the NavBar's `.elevation-below`
// z-index would otherwise trap it *below* the graph canvas). Positioned from the
// trigger's rect — like Tooltip/ContextMenu — so nothing can clip or paint over it.
const panelStyle = (pos: PanelPos, minWidth: number): CSSProperties => ({
  position: "fixed",
  top: pos.top,
  left: pos.left,
  right: pos.right,
  width: pos.width,
  minWidth,
  maxHeight: 360,
  overflowY: "auto",
  padding: "var(--space-1)",
  background: "var(--color-bg-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  color: "var(--color-text-primary)",
  zIndex: 200,
});

/**
 * A trigger button with an anchored popup panel, used for the repo and branch
 * pickers in the NavBar. Manages its own open state and closes on outside
 * click or Escape. The panel content is a render-prop receiving `close` so an
 * item selection can dismiss the menu.
 */
export function Dropdown({
  trigger,
  ariaLabel,
  disabled = false,
  panelMinWidth = 220,
  align = "left",
  fullWidth = false,
  triggerStyle,
  onOpenChange,
  children,
}: {
  trigger: ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  panelMinWidth?: number;
  align?: "left" | "right";
  /** Stretch the trigger (and root) to fill the parent — for use as a form field. */
  fullWidth?: boolean;
  triggerStyle?: CSSProperties;
  /** Notified whenever the panel opens or closes (e.g. to reset a filter). */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, rawSetOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    rawSetOpen((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value !== prev) onOpenChange?.(value);
      return value;
    });
  };

  // Measure the trigger and place the fixed panel just beneath it, aligned to the
  // requested edge (and matched to the trigger width when `fullWidth`). Recomputed
  // on layout, and on scroll/resize while open so the panel tracks the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const top = rect.bottom + 2;
      if (fullWidth) setPos({ top, left: rect.left, width: rect.width });
      else if (align === "right")
        setPos({ top, right: window.innerWidth - rect.right });
      else setPos({ top, left: rect.left });
    };
    measure();
    window.addEventListener("resize", measure);
    // Capture-phase scroll so it updates even when an inner container scrolls.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, align, fullWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel lives in a portal outside `ref`, so check it too — otherwise a
      // click on a menu item would read as "outside" and close before it fires.
      if (ref.current?.contains(target) || panelRef.current?.contains(target))
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        minWidth: 0,
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={(e) => {
          if (!disabled)
            e.currentTarget.style.background = "var(--color-bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = open
            ? "var(--color-bg-hover)"
            : "transparent";
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          maxWidth: fullWidth ? "none" : 240,
          width: fullWidth ? "100%" : undefined,
          minWidth: 0,
          height: "var(--control-height-md)",
          padding: "0 var(--space-2)",
          background: open ? "var(--color-bg-hover)" : "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--radius-sm)",
          color: "var(--color-text-primary)",
          fontSize: "var(--font-size-sm)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...triggerStyle,
        }}
      >
        {trigger}
        <Caret open={open} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={panelStyle(pos, panelMinWidth)}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A selectable row inside a Dropdown panel. */
export function DropdownItem({
  children,
  onSelect,
  active = false,
  title,
  leading,
}: {
  children: ReactNode;
  onSelect: () => void;
  active?: boolean;
  title?: string;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      onClick={onSelect}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active
          ? "var(--color-bg-selected)"
          : "transparent";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        textAlign: "left",
        padding: "var(--space-1) var(--space-2)",
        fontSize: "var(--font-size-sm)",
        background: active ? "var(--color-bg-selected)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-primary)",
        cursor: "pointer",
      }}
    >
      {leading !== undefined && (
        <span
          style={{
            display: "inline-flex",
            width: 14,
            flexShrink: 0,
            justifyContent: "center",
          }}
        >
          {leading}
        </span>
      )}
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
    </button>
  );
}

/** A small uppercase section label inside a Dropdown panel. */
export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "var(--space-1) var(--space-2)",
        fontSize: "var(--font-size-xs)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

/** A thin divider between Dropdown sections. */
export function DropdownDivider() {
  return (
    <div
      style={{
        height: 1,
        margin: "var(--space-1) 0",
        background: "var(--color-border-subtle)",
      }}
    />
  );
}
