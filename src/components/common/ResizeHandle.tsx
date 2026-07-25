import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * A thin draggable divider. Reports the pointer delta along its resize axis via
 * `onResize`; the parent applies it to a panel width (vertical handle) or a
 * section height (horizontal handle). Uses window listeners so the drag
 * continues even when the pointer leaves the handle. The visible line brightens
 * on hover and while dragging so the divider reads clearly as draggable. An
 * optional `style` allows absolute positioning (e.g. overlaying a boundary).
 */
export function ResizeHandle({
  onResize,
  ariaLabel,
  orientation = "vertical",
  style,
}: {
  onResize: (delta: number) => void;
  ariaLabel?: string;
  orientation?: "vertical" | "horizontal";
  style?: CSSProperties;
}) {
  const dragging = useRef(false);
  const last = useRef(0);
  const [active, setActive] = useState(false); // hovered or dragging (line highlight)

  const horizontal = orientation === "horizontal";
  const cursor = horizontal ? "row-resize" : "col-resize";

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const pos = horizontal ? e.clientY : e.clientX;
      const delta = pos - last.current;
      last.current = pos;
      if (delta !== 0) onResize(delta);
    };
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setActive(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [horizontal, onResize]);

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        dragging.current = true;
        last.current = horizontal ? e.clientY : e.clientX;
        setActive(true);
        document.body.style.cursor = cursor;
        document.body.style.userSelect = "none";
        e.preventDefault();
      }}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => {
        if (!dragging.current) setActive(false);
      }}
      style={{
        flexShrink: 0,
        display: "flex",
        cursor,
        background: "transparent",
        ...(horizontal
          ? {
              height: 7,
              width: "100%",
              flexDirection: "column",
              justifyContent: "center",
            }
          : { width: 7, justifyContent: "center" }),
        ...style,
      }}
    >
      {/* Thin visible divider centred in a wider (transparent) grab zone; it
          brightens to the accent while hovered/dragging to signal it's draggable. */}
      <div
        style={{
          background: active
            ? "var(--color-accent-primary)"
            : "var(--color-border-default)",
          transition: "background var(--duration-fast) var(--ease-default)",
          ...(horizontal
            ? { height: 1, width: "100%" }
            : { width: 1, alignSelf: "stretch" }),
        }}
      />
    </div>
  );
}
