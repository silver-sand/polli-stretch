/**
 * PolliStretch Content Script UI
 *
 * Subtle inline chevrons, compact fixed toolbar, toasts.
 * No external dependencies. All styles in content.css with .polli-* prefix.
 * Inherits page currentColor for theme adaptivity.
 */

import type { StretchParagraph, DisplayLevel } from "../types";

/** Unique ID for this content script instance */
const INSTANCE_ID = Math.random().toString(36).slice(2);

/** Marker attribute for our injected elements */
const POLLI_MARKER = "data-polli";

/** Chevron level markers */
const LEVEL_LABELS: Record<DisplayLevel, string> = {
  kernel: "Essential",
  context: "Detail",
  full: "Full",
};

/** Keyboard keys that toggle */
const TOGGLE_KEYS = new Set(["Enter", " "]);

/** Element references we need to track */
interface UIRefs {
  toolbar: HTMLElement | null;
  toasts: HTMLElement[];
  loading: HTMLElement | null;
  chevrons: Map<string, HTMLElement>; // paragraphId -> chevron element
}

/** Create an element with our marker attribute */
function createPolliElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  el.setAttribute(POLLI_MARKER, "true");
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

/** Get or create the toolbar */
function getOrCreateToolbar(refs: UIRefs): HTMLElement {
  if (refs.toolbar && document.body.contains(refs.toolbar)) {
    return refs.toolbar;
  }
  const toolbar = createPolliElement("div", "polli-toolbar", {
    role: "toolbar",
    "aria-label": "PolliStretch reading controls",
  });

  const pageGroup = createPolliElement("div", "polli-toolbar__group", {});
  const pageTitle = createPolliElement("span", "polli-toolbar__label", { id: "polli-page-title" });
  pageGroup.appendChild(pageTitle);
  toolbar.appendChild(pageGroup);

  toolbar.appendChild(createPolliElement("div", "polli-toolbar__divider", { "aria-hidden": "true" }));

  const actionsGroup = createPolliElement("div", "polli-toolbar__group", {});
  const expandAllBtn = createPolliElement("button", "polli-toolbar__btn", {
    "data-action": "expand-all",
    "aria-label": "Expand all paragraphs",
    title: "Expand all (Alt+Shift+E)",
  });
  expandAllBtn.textContent = "Expand All";
  actionsGroup.appendChild(expandAllBtn);
  const collapseAllBtn = createPolliElement("button", "polli-toolbar__btn", {
    "data-action": "collapse-all",
    "aria-label": "Collapse all paragraphs",
    title: "Collapse all (Alt+Shift+C)",
  });
  collapseAllBtn.textContent = "Collapse All";
  actionsGroup.appendChild(collapseAllBtn);
  toolbar.appendChild(actionsGroup);

  toolbar.appendChild(createPolliElement("div", "polli-toolbar__divider", { "aria-hidden": "true" }));

  const restoreGroup = createPolliElement("div", "polli-toolbar__group", {});
  const restoreBtn = createPolliElement("button", "polli-toolbar__btn", {
    "data-action": "restore",
    "aria-label": "Restore original page",
    title: "Restore original (Alt+Shift+R)",
  });
  restoreBtn.textContent = "Restore";
  restoreGroup.appendChild(restoreBtn);
  const deactivateBtn = createPolliElement("button", "polli-toolbar__btn", {
    "data-action": "deactivate",
    "aria-label": "Deactivate PolliStretch",
    title: "Deactivate (Alt+Shift+P)",
  });
  deactivateBtn.textContent = "Deactivate";
  restoreGroup.appendChild(deactivateBtn);
  toolbar.appendChild(restoreGroup);

  toolbar.appendChild(createPolliElement("div", "polli-toolbar__divider", { "aria-hidden": "true" }));

  const progress = createPolliElement("div", "polli-toolbar__progress", { "aria-live": "polite" });
  const progressBar = createPolliElement("div", "polli-toolbar__progress-bar", {
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": "0",
  });
  progressBar.style.width = "100%";
  const progressFill = createPolliElement("div", "polli-toolbar__progress-fill", {});
  progressFill.style.width = "0%";
  progressBar.appendChild(progressFill);
  progress.appendChild(progressBar);
  const progressText = createPolliElement("span", "polli-toolbar__progress-text", {
    id: "polli-progress-text",
  });
  progressText.textContent = "0%";
  progress.appendChild(progressText);
  toolbar.appendChild(progress);

  document.body.appendChild(toolbar);
  refs.toolbar = toolbar;

  // Bind toolbar button events
  toolbar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action) {
      toolbar.dispatchEvent(new CustomEvent("polli:toolbar-action", { detail: { action } }));
    }
  });

  return toolbar;
}

/** Show/hide toolbar with animation */
function setToolbarVisible(refs: UIRefs, visible: boolean): void {
  const toolbar = getOrCreateToolbar(refs);
  if (visible) {
    toolbar.classList.add("polli-visible");
  } else {
    toolbar.classList.remove("polli-visible");
  }
}

/** Update toolbar progress */
function updateToolbarProgress(refs: UIRefs, current: number, total: number): void {
  const toolbar = getOrCreateToolbar(refs);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const fill = toolbar.querySelector(".polli-toolbar__progress-fill") as HTMLElement;
  const text = toolbar.querySelector("#polli-progress-text") as HTMLElement;
  const progressBar = toolbar.querySelector('[role="progressbar"]') as HTMLElement;
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${percent}%`;
  if (progressBar) progressBar.setAttribute("aria-valuenow", String(percent));
}

/** Update toolbar page title */
function updateToolbarTitle(refs: UIRefs, title: string): void {
  const toolbar = getOrCreateToolbar(refs);
  const titleEl = toolbar.querySelector("#polli-page-title") as HTMLElement;
  if (titleEl) titleEl.textContent = title.slice(0, 50);
}

/** Create a chevron element for a paragraph */
function createChevron(paragraphId: string, level: DisplayLevel): HTMLElement {
  const chevron = createPolliElement("span", "polli-chevron", {
    "data-polli-id": paragraphId,
    "data-polli": "chevron",
    "data-level": level,
    role: "button",
    tabindex: "0",
    "aria-label": `Expand from ${LEVEL_LABELS[level]}`,
    "aria-expanded": level !== "full" ? "false" : "true",
  });
  return chevron;
}

/** Update chevron visual state */
function updateChevron(chevron: HTMLElement, level: DisplayLevel): void {
  chevron.setAttribute("data-level", level);
  chevron.setAttribute("aria-label", `Expand from ${LEVEL_LABELS[level]}`);
  chevron.setAttribute("aria-expanded", level !== "full" ? "false" : "true");
}

/** Attach chevron to paragraph */
function attachChevron(paragraphEl: Element, chevron: HTMLElement): void {
  // Insert after the paragraph's content, before any trailing whitespace
  paragraphEl.appendChild(chevron);
}

/** Remove chevron from paragraph */
function removeChevron(chevron: HTMLElement): void {
  chevron.remove();
}

/** Show a toast notification */
function showToast(refs: UIRefs, message: string, type: "info" | "success" | "error" = "info", duration = 3000): void {
  const toast = createPolliElement("div", "polli-toast", {
    role: "alert",
    "aria-live": "polite",
    "data-type": type,
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  refs.toasts.push(toast);

  // Force reflow then animate in
  requestAnimationFrame(() => {
    toast.classList.add("polli-visible");
  });

  // Auto-dismiss
  const timeoutId = setTimeout(() => {
    dismissToast(refs, toast);
  }, duration);

  // Click to dismiss
  toast.addEventListener("click", () => {
    clearTimeout(timeoutId);
    dismissToast(refs, toast);
  });
}

/** Dismiss a toast */
function dismissToast(refs: UIRefs, toast: HTMLElement): void {
  toast.classList.remove("polli-visible");
  toast.addEventListener("transitionend", () => {
    toast.remove();
    const idx = refs.toasts.indexOf(toast);
    if (idx >= 0) refs.toasts.splice(idx, 1);
  }, { once: true });
}

/** Show loading overlay */
function showLoading(refs: UIRefs, message = "Generating summaries…"): void {
  if (refs.loading && document.body.contains(refs.loading)) return;
  const loading = createPolliElement("div", "polli-loading", { role: "status", "aria-live": "polite" });
  loading.innerHTML = `
    <div class="polli-loading__spinner" aria-hidden="true"></div>
    <span>${message}</span>
  `;
  document.body.appendChild(loading);
  refs.loading = loading;
}

/** Hide loading overlay */
function hideLoading(refs: UIRefs): void {
  if (refs.loading) {
    refs.loading.remove();
    refs.loading = null;
  }
}

/** Transform a paragraph element to show a specific level */
function transformParagraph(
  paragraphEl: HTMLElement,
  paragraph: StretchParagraph,
  level: DisplayLevel,
  originalNodesMap: Map<string, Node[]>,
): void {
  const id = paragraph.id;
  const currentLevel = paragraphEl.getAttribute("data-polli-level") as DisplayLevel | null;

  if (currentLevel === level) return; // Already at this level

  // Store original nodes on first transformation
  if (!originalNodesMap.has(id)) {
    const nodes = Array.from(paragraphEl.childNodes);
    // Filter out our own injected elements
    const originalNodes = nodes.filter((n) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        return !(n as Element).hasAttribute(POLLI_MARKER);
      }
      return true;
    });
    originalNodesMap.set(id, originalNodes);
  }

  // Clear current content
  paragraphEl.replaceChildren();

  // Create wrapper for the level content
  const wrapper = document.createElement("span");
  wrapper.setAttribute(POLLI_MARKER, "true");
  wrapper.setAttribute("data-polli", level === "kernel" ? "kernel-wrapper" : level === "context" ? "context-wrapper" : "full-wrapper");

  let text: string;
  switch (level) {
    case "kernel":
      text = paragraph.kernel;
      break;
    case "context":
      text = paragraph.context;
      break;
    case "full":
      text = paragraph.full;
      break;
  }

  wrapper.textContent = text;
  paragraphEl.appendChild(wrapper);

  // Update level attribute
  paragraphEl.setAttribute("data-polli-level", level);

  // Re-attach chevron (it was removed by replaceChildren)
  const chevron = createChevron(id, level);
  attachChevron(paragraphEl, chevron);

  // Bind chevron click/keyboard
  chevron.addEventListener("click", () => {
    paragraphEl.dispatchEvent(new CustomEvent("polli:chevron-click", { detail: { id } }));
  });
  chevron.addEventListener("keydown", (e) => {
    if (TOGGLE_KEYS.has(e.key)) {
      e.preventDefault();
      chevron.click();
    }
  });
}

/** Restore paragraph to original state using stored node references */
function restoreParagraph(
  paragraphEl: HTMLElement,
  paragraphId: string,
  originalNodesMap: Map<string, Node[]>,
): boolean {
  const originalNodes = originalNodesMap.get(paragraphId);
  if (!originalNodes || originalNodes.length === 0) return false;

  paragraphEl.replaceChildren(...originalNodes);
  paragraphEl.removeAttribute("data-polli-level");
  paragraphEl.removeAttribute("data-polli-active");
  return true;
}

/** Check if an element is a protected interactive element */
function isProtectedElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (["button", "a", "input", "select", "textarea", "label", "option", "form"].includes(tag)) return true;
  if (el.isContentEditable) return true;
  if (el.hasAttribute("role") && ["button", "link", "menuitem", "tab"].includes(el.getAttribute("role") ?? "")) return true;
  return false;
}

/** Deep check if paragraph contains protected elements */
function hasProtectedElements(paragraphEl: Element): boolean {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    if (isProtectedElement(walker.currentNode)) return true;
  }
  return false;
}

/** Initialize UI refs */
function createUIRefs(): UIRefs {
  return {
    toolbar: null,
    toasts: [],
    loading: null,
    chevrons: new Map(),
  };
}

/** Cleanup all UI elements */
function teardownUI(refs: UIRefs): void {
  if (refs.toolbar) {
    refs.toolbar.remove();
    refs.toolbar = null;
  }
  for (const toast of refs.toasts) {
    toast.remove();
  }
  refs.toasts = [];
  if (refs.loading) {
    refs.loading.remove();
    refs.loading = null;
  }
  refs.chevrons.clear();
}

export const ui = {
  createUIRefs,
  getOrCreateToolbar,
  setToolbarVisible,
  updateToolbarProgress,
  updateToolbarTitle,
  createChevron,
  updateChevron,
  attachChevron,
  removeChevron,
  showToast,
  dismissToast,
  showLoading,
  hideLoading,
  transformParagraph,
  restoreParagraph,
  isProtectedElement,
  hasProtectedElements,
  teardownUI,
  POLLI_MARKER,
  INSTANCE_ID,
};