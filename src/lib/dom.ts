/**
 * DOM snapshot / restore primitives for PolliStretch.
 *
 * Design goal: faithful restoration of the original document with no
 * re-serialization of the whole document. Every node we replace is
 * serialized into a plain-JSON tree first, and restored node-for-node.
 *
 * The pure serializer is isolated from the live DOM so it can be unit
 * tested in jsdom without any PolliStretch-specific markup.
 */

export type SerializedNode =
  | { kind: "element"; tag: string; attrs: Record<string, string | null>; children: SerializedNode[] }
  | { kind: "text"; text: string }
  | { kind: "comment"; data: string };

/** Serialize a node into a plain-JSON tree. No functions, no cycles. */
export function snapshotNode(node: Node): SerializedNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return { kind: "text", text: node.nodeValue ?? "" };
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return { kind: "comment", data: node.nodeValue ?? "" };
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const attrs: Record<string, string | null> = {};
    for (const attr of Array.from(el.attributes)) {
      attrs[attr.name] = attr.value;
    }
    const children = Array.from(el.childNodes).map(snapshotNode);
    return {
      kind: "element",
      tag: el.tagName.toLowerCase(),
      attrs,
      children,
    };
  }
  // Document / document fragment: serialize children
  const children = Array.from(node.childNodes).map(snapshotNode);
  return { kind: "element", tag: "#document-fragment", attrs: {}, children };
}

/** Rebuild a serialized node tree and append it to `parent`. Returns the root element. */
export function restoreFromSnapshot(snapshot: SerializedNode, parent: Node): Node {
  const doc = (parent as Element).ownerDocument ?? document;

  function build(s: SerializedNode): Node {
    if (s.kind === "text") {
      return doc.createTextNode(s.text);
    }
    if (s.kind === "comment") {
      return doc.createComment(s.data);
    }
    const el = doc.createElement(s.tag);
    for (const [name, value] of Object.entries(s.attrs)) {
      if (value === null) {
        el.removeAttribute(name);
      } else {
        el.setAttribute(name, value);
      }
    }
    for (const child of s.children) {
      el.appendChild(build(child));
    }
    return el;
  }

  const root = build(snapshot);
  parent.appendChild(root);
  return root;
}

/**
 * Serialize each child of `node`, recording its original index so we can
 * restore them in the exact same order.
 */
export interface SnapshotEntry {
  index: number;
  serialized: SerializedNode;
}

export function snapshotChildren(node: Element): SnapshotEntry[] {
  return Array.from(node.childNodes).map((child, index) => ({
    index,
    serialized: snapshotNode(child),
  }));
}

/**
 * Render a paragraph element back to its original children (depth 2 = full).
 * Returns true if a change was made.
 */
export function restoreOriginalParagraph(
  paragraphEl: Element,
  originalChildren: SnapshotEntry[],
): boolean {
  // If the paragraph already has the original children (by reference), no-op.
  if (paragraphEl.childNodes.length === originalChildren.length) {
    let same = true;
    for (let i = 0; i < originalChildren.length; i++) {
      const current = paragraphEl.childNodes[i];
      const snapshot = originalChildren[i].serialized;
      // Cheap check: same tag and same text content (for text nodes)
      const tagOf = (n: Node | null) =>
        n?.nodeType === Node.ELEMENT_NODE ? (n as Element).tagName.toLowerCase() : null;
      const expectedTag = snapshot.kind === "element" ? snapshot.tag : null;
      if (tagOf(current) !== expectedTag) {
        same = false;
        break;
      }
      // For text nodes, also compare text content
      if (current.nodeType === Node.TEXT_NODE && snapshot.kind === "text") {
        if (current.textContent !== snapshot.text) {
          same = false;
          break;
        }
      }
    }
    if (same) return false;
  }

  paragraphEl.replaceChildren();
  const doc = paragraphEl.ownerDocument ?? document;
  const frag = doc.createDocumentFragment();
  for (const entry of originalChildren) {
    frag.appendChild(restoreFromSnapshot(entry.serialized, frag));
  }
  paragraphEl.appendChild(frag);
  return true;
}

/**
 * Debounced MutationObserver guard. Fires `onMutate` only when a mutation
 * originates OUTSIDE PolliStretch's own injected nodes.
 *
 * A "PolliStretch mutation" is one whose target has a [data-polli] ancestor,
 * OR whose added/removed nodes include a [data-polli] element.
 */
export function installMutationGuard(onMutate: () => void): () => void {
  const target = document.body;
  if (!target) return () => {};

  let dirty = false;

  const observer = new MutationObserver((records) => {
    // If any record was caused by our own injected content, skip entirely
    for (const r of records) {
      if (r.type === "childList") {
        for (const n of Array.from(r.addedNodes).concat(Array.from(r.removedNodes))) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const el = n as Element;
            if (el.hasAttribute("data-polli") || el.closest("[data-polli]")) {
              dirty = false;
              return;
            }
          }
        }
      }
      const t = r.target;
      if (t.nodeType === Node.ELEMENT_NODE && ((t as Element).hasAttribute("data-polli") || (t as Element).closest("[data-polli]"))) {
        dirty = false;
        return;
      }
      break;
    }
    if (dirty) return; // already queued
    dirty = true;
    queueMicrotask(() => {
      dirty = false;
      onMutate();
    });
  });

  observer.observe(target, { childList: true, subtree: true, characterData: true });

  return () => observer.disconnect();
}

/**
 * Remove every [data-polli] element from the document, restore original
 * children for every paragraph that has a snapshot, and disconnect the
 * mutation observer. Leaves the page as close to its original state as
 * possible.
 */
export function teardownAll(
  root: Document,
  snapshots: Map<string, SnapshotEntry[]>,
): void {
  // 1. Restore original children for every tracked paragraph
  for (const [id, entries] of snapshots) {
    const el = root.querySelector(`[data-polli-id="${id}"]`);
    if (el) {
      el.replaceChildren();
      const doc = el.ownerDocument ?? root;
      const frag = doc.createDocumentFragment();
      for (const entry of entries) {
        frag.appendChild(restoreFromSnapshot(entry.serialized, frag));
      }
      el.appendChild(frag);
      el.removeAttribute("data-polli");
      el.removeAttribute("data-polli-level");
    }
  }
  // 2. Remove every remaining [data-polli] element (toolbar, chevrons, toasts)
  for (const el of Array.from(root.querySelectorAll("[data-polli]"))) {
    el.remove();
  }
}
