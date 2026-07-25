import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { selectHookRun, useHookStore } from "../../stores/hookStore";
import { ResizeHandle } from "../common/ResizeHandle";
import { Button } from "../ui/Button";

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 480;

function resolvedToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function sameChunk(
  left: { stream: string; chunk: string },
  right: { stream: string; chunk: string },
): boolean {
  return left.stream === right.stream && left.chunk === right.chunk;
}

export function HookOutputPane({
  repoPath,
  height,
  onResize,
}: {
  repoPath: string;
  height: number;
  onResize: (delta: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writtenRef = useRef<Array<{ stream: string; chunk: string }>>([]);
  const runKeyRef = useRef<string | undefined>(undefined);
  const terminalGenerationRef = useRef(0);

  const run = useHookStore(selectHookRun(repoPath));
  const setPaneVisible = useHookStore((state) => state.setPaneVisible);
  const setFollowing = useHookStore((state) => state.setFollowing);

  useEffect(() => {
    if (!run?.paneVisible || !hostRef.current) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 10_000,
      theme: {
        background: resolvedToken("--color-bg-app"),
        foreground: resolvedToken("--color-text-primary"),
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(hostRef.current);
    const scrollListener = terminal.onScroll(() => {
      const buffer = terminal.buffer.active;
      const atBottom = buffer.viewportY >= buffer.baseY;
      const currentRun = selectHookRun(repoPath)(useHookStore.getState());
      if (currentRun && currentRun.following !== atBottom) {
        useHookStore.getState().setFollowing(repoPath, atBottom);
      }
    });
    terminalRef.current = terminal;

    return () => {
      terminalGenerationRef.current += 1;
      terminalRef.current = null;
      runKeyRef.current = undefined;
      resizeObserver.disconnect();
      scrollListener.dispose();
      terminal.dispose();
      writtenRef.current = [];
    };
  }, [repoPath, run?.paneVisible]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !run) return;

    const previous = writtenRef.current;
    const runKey = `${repoPath}\0${run.runId ?? ""}`;
    const runChanged =
      runKeyRef.current !== undefined && runKeyRef.current !== runKey;
    const prefixChanged =
      previous.length > run.chunks.length ||
      previous.some((chunk, index) => !sameChunk(chunk, run.chunks[index]!));

    let start = previous.length;
    if (runChanged || prefixChanged) {
      terminalGenerationRef.current += 1;
      terminal.clear();
      writtenRef.current = [];
      start = 0;
    }
    if (runKeyRef.current === undefined) {
      terminalGenerationRef.current += 1;
    }
    const generation = terminalGenerationRef.current;

    for (let index = start; index < run.chunks.length; index += 1) {
      terminal.write(run.chunks[index]!.chunk);
    }
    if (run.following && run.chunks.length > start) {
      // An empty queued write is a completion barrier: xterm invokes this only
      // after all preceding output has reached its buffer.
      terminal.write("", () => {
        const current = selectHookRun(repoPath)(useHookStore.getState());
        const currentKey = current
          ? `${repoPath}\0${current.runId ?? ""}`
          : undefined;
        if (
          terminalRef.current === terminal &&
          terminalGenerationRef.current === generation &&
          runKeyRef.current === runKey &&
          current?.following &&
          currentKey === runKey
        ) {
          terminal.scrollToBottom();
        }
      });
    }
    writtenRef.current = run.chunks.map((chunk) => ({ ...chunk }));
    runKeyRef.current = runKey;
  }, [repoPath, run]);

  if (!run?.paneVisible) return null;

  const resumeFollowing = () => {
    setFollowing(repoPath, true);
    terminalRef.current?.scrollToBottom();
  };

  return (
    <section
      aria-label="Hook output"
      style={{
        height,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-app)",
        borderTop: "1px solid var(--color-border-default)",
      }}
    >
      <ResizeHandle
        orientation="horizontal"
        ariaLabel="Resize hook output"
        onResize={(delta) => {
          const nextHeight = Math.max(
            MIN_HEIGHT,
            Math.min(MAX_HEIGHT, height - delta),
          );
          const clampedDelta = height - nextHeight;
          if (clampedDelta !== 0) onResize(clampedDelta);
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-2)",
          minHeight: "var(--control-height-sm)",
          color: "var(--color-text-secondary)",
          fontSize: "var(--font-size-xs)",
        }}
      >
        <span>Hook output</span>
        <span style={{ display: "inline-flex", gap: "var(--space-1)" }}>
          {!run.following && (
            <Button size="sm" variant="tertiary" onClick={resumeFollowing}>
              Follow output
            </Button>
          )}
          <Button
            size="sm"
            variant="tertiary"
            aria-label="Close hook output"
            onClick={() => setPaneVisible(repoPath, false)}
          >
            ×
          </Button>
        </span>
      </div>
      <div
        ref={hostRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          width: "100%",
          overflow: "hidden",
        }}
      />
    </section>
  );
}
