import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Safe default for every test file that doesn't mock `listen`/`emit` itself —
// a file-level `vi.mock("@tauri-apps/api/event", ...)` (several already do)
// takes precedence over this one, so this only protects the *other* files
// that would otherwise hit the real, unmocked module.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// jsdom has no ResizeObserver. This minimal mock records the callback passed
// to each observed target and lets tests invoke it synchronously via
// `triggerResizeObserver`, rather than relying on a real layout pass.
const resizeObserverCallbacks = new Map<Element, ResizeObserverCallback>();

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    resizeObserverCallbacks.set(target, this.callback);
  }

  unobserve(target: Element) {
    if (resizeObserverCallbacks.get(target) === this.callback) {
      resizeObserverCallbacks.delete(target);
    }
  }

  disconnect() {
    for (const [target, cb] of resizeObserverCallbacks) {
      if (cb === this.callback) resizeObserverCallbacks.delete(target);
    }
  }
}

window.ResizeObserver = MockResizeObserver;
globalThis.ResizeObserver = window.ResizeObserver;

// Test helper: synchronously invoke the ResizeObserver callback registered
// for `target` (as if a real resize had just been observed).
export function triggerResizeObserver(target: Element) {
  const cb = resizeObserverCallbacks.get(target);
  cb?.([{ target } as ResizeObserverEntry], new MockResizeObserver(() => {}));
}

// jsdom has no matchMedia. Default stub so components that subscribe to a
// media query (e.g. the graph's DPR-change listener) don't crash on mount;
// individual tests can still `vi.spyOn(window, "matchMedia")` to override it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
