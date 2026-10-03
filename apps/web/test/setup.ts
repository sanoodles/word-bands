// Registers @testing-library/jest-dom matchers on vitest's `expect`. Only the
// matcher definitions load here (no DOM access), so this is safe under the node
// environment the lib/API tests use; component tests opt into jsdom per file.
import "@testing-library/jest-dom/vitest";

// jsdom omits these browser APIs; Fondue's Tabs (built on Radix) constructs an
// IntersectionObserver and scrolls the active trigger into view on mount, so
// stub them where a DOM exists. Guarded so the node-environment tests are untouched.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = () => {};
}
// Radix's Select (Fondue's Select) drives its trigger through Pointer Capture,
// which jsdom doesn't implement — stub the three methods so opening it works.
if (typeof window !== "undefined") {
  const el = window.Element.prototype;
  el.hasPointerCapture ??= () => false;
  el.setPointerCapture ??= () => {};
  el.releasePointerCapture ??= () => {};
}
// jsdom has the <dialog> element but no modal for it. Enough of one for the figure's full
// screen: `open` follows the two calls, and closing fires `close` as a browser does.
if (typeof window !== "undefined" && !window.HTMLDialogElement.prototype.showModal) {
  const dialog = window.HTMLDialogElement.prototype;
  dialog.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  dialog.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
// jsdom's canvas returns no 2d context; GraphView measures label widths through
// one. Hand back a minimal stub with approximate text metrics.
if (typeof window !== "undefined") {
  window.HTMLCanvasElement.prototype.getContext = (() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
}
