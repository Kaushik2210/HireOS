import { afterEach } from "vitest";

// Node-environment suites (database tests) have no DOM to prepare.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");

  // cmdk measures layout via ResizeObserver and scrollIntoView, absent in jsdom.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub;
  Element.prototype.scrollIntoView ??= () => {};

  afterEach(() => cleanup());
}
