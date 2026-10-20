import "@testing-library/jest-dom/vitest";

// jsdom has no modal dialogs yet. This stand-in opens and closes them; the browser's focus
// trapping isn't simulated.
if (typeof HTMLDialogElement !== "undefined" && !("showModal" in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
    close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
}
