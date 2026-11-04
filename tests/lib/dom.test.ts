/**
 * DOM utility tests for PolliStretch.
 *
 * Tests the serializer, restorer, snapshot children, and teardown functions.
 * Runs in jsdom (vitest environment).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  snapshotNode,
  restoreFromSnapshot,
  snapshotChildren,
  restoreOriginalParagraph,
  teardownAll,
  type SerializedNode,
  type SnapshotEntry,
} from "../../src/lib/dom";

describe("snapshotNode", () => {
  it("serializes text nodes", () => {
    const text = document.createTextNode("Hello world");
    const result = snapshotNode(text);
    expect(result).toEqual({ kind: "text", text: "Hello world" });
  });

  it("serializes comment nodes", () => {
    const comment = document.createComment("This is a comment");
    const result = snapshotNode(comment);
    expect(result).toEqual({ kind: "comment", data: "This is a comment" });
  });

  it("serializes element nodes with attributes", () => {
    const el = document.createElement("div");
    el.setAttribute("id", "test");
    el.setAttribute("class", "my-class");
    el.setAttribute("data-custom", "value");
    el.textContent = "Inner text";
    const result = snapshotNode(el);
    expect(result.kind).toBe("element");
    expect(result.tag).toBe("div");
    expect(result.attrs).toEqual({
      id: "test",
      class: "my-class",
      "data-custom": "value",
    });
    expect(result.children.length).toBe(1);
    expect(result.children[0]).toEqual({ kind: "text", text: "Inner text" });
  });

  it("serializes nested elements", () => {
    const outer = document.createElement("section");
    const inner = document.createElement("p");
    inner.textContent = "Nested paragraph";
    outer.appendChild(inner);
    const result = snapshotNode(outer);
    expect(result.tag).toBe("section");
    expect(result.children.length).toBe(1);
    expect(result.children[0].kind).toBe("element");
    expect((result.children[0] as { tag: string }).tag).toBe("p");
    expect(result.children[0].children[0]).toEqual({ kind: "text", text: "Nested paragraph" });
  });

  it("serializes document fragment / root nodes", () => {
    // Use a true DocumentFragment (not a full HTML document) to test fragment serialization
    const frag = document.createDocumentFragment();
    const p = document.createElement("p");
    p.textContent = "Fragment content";
    frag.appendChild(p);
    const result = snapshotNode(frag);
    expect(result.tag).toBe("#document-fragment");
    expect(result.children.length).toBe(1);
    expect(result.children[0].kind).toBe("element");
  });
});

describe("restoreFromSnapshot", () => {
  it("restores text nodes", () => {
    const parent = document.createElement("div");
    const snapshot: SerializedNode = { kind: "text", text: "Restored text" };
    const result = restoreFromSnapshot(snapshot, parent);
    expect(result.nodeType).toBe(Node.TEXT_NODE);
    expect(result.textContent).toBe("Restored text");
    expect(parent.childNodes.length).toBe(1);
  });

  it("restores comment nodes", () => {
    const parent = document.createElement("div");
    const snapshot: SerializedNode = { kind: "comment", data: "Restored comment" };
    const result = restoreFromSnapshot(snapshot, parent);
    expect(result.nodeType).toBe(Node.COMMENT_NODE);
    expect(result.textContent).toBe("Restored comment");
  });

  it("restores element nodes with attributes", () => {
    const parent = document.createElement("div");
    const snapshot: SerializedNode = {
      kind: "element",
      tag: "span",
      attrs: { id: "restored", class: "test", "data-value": "123" },
      children: [{ kind: "text", text: "Content" }],
    };
    const result = restoreFromSnapshot(snapshot, parent);
    expect(result.nodeType).toBe(Node.ELEMENT_NODE);
    const el = result as Element;
    expect(el.tagName.toLowerCase()).toBe("span");
    expect(el.id).toBe("restored");
    expect(el.className).toBe("test");
    expect(el.getAttribute("data-value")).toBe("123");
    expect(el.textContent).toBe("Content");
  });

  it("restores nested structures", () => {
    const parent = document.createElement("div");
    const snapshot: SerializedNode = {
      kind: "element",
      tag: "section",
      attrs: {},
      children: [
        {
          kind: "element",
          tag: "h1",
          attrs: {},
          children: [{ kind: "text", text: "Title" }],
        },
        {
          kind: "element",
          tag: "p",
          attrs: { class: "lead" },
          children: [{ kind: "text", text: "Paragraph" }],
        },
      ],
    };
    const result = restoreFromSnapshot(snapshot, parent);
    expect(result.childNodes.length).toBe(2);
    const h1 = result.querySelector("h1");
    expect(h1?.textContent).toBe("Title");
    const p = result.querySelector("p");
    expect(p?.textContent).toBe("Paragraph");
    expect(p?.className).toBe("lead");
  });

  it("handles null attribute values (removes attribute)", () => {
    const parent = document.createElement("div");
    const snapshot: SerializedNode = {
      kind: "element",
      tag: "div",
      attrs: { "data-keep": "value", "data-remove": null },
      children: [],
    };
    const result = restoreFromSnapshot(snapshot, parent);
    const el = result as Element;
    expect(el.getAttribute("data-keep")).toBe("value");
    expect(el.hasAttribute("data-remove")).toBe(false);
  });
});

describe("snapshotChildren", () => {
  it("serializes each child with its index", () => {
    const parent = document.createElement("div");
    const text1 = document.createTextNode("First");
    const el = document.createElement("span");
    el.textContent = "Second";
    const text2 = document.createTextNode("Third");
    parent.appendChild(text1);
    parent.appendChild(el);
    parent.appendChild(text2);
    const result = snapshotChildren(parent);
    expect(result.length).toBe(3);
    expect(result[0].index).toBe(0);
    expect(result[0].serialized).toEqual({ kind: "text", text: "First" });
    expect(result[1].index).toBe(1);
    expect(result[1].serialized.kind).toBe("element");
    expect(result[2].index).toBe(2);
    expect(result[2].serialized).toEqual({ kind: "text", text: "Third" });
  });

  it("returns empty array for empty element", () => {
    const parent = document.createElement("div");
    const result = snapshotChildren(parent);
    expect(result).toEqual([]);
  });
});

describe("restoreOriginalParagraph", () => {
  it("restores original children from snapshots", () => {
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-polli-id", "p0");
    // Original content
    const text1 = document.createTextNode("Original ");
    const strong = document.createElement("strong");
    strong.textContent = "bold";
    const text2 = document.createTextNode(" text");
    paragraph.appendChild(text1);
    paragraph.appendChild(strong);
    paragraph.appendChild(text2);

    // Snapshot the original children
    const originalChildren = snapshotChildren(paragraph);

    // Now transform the paragraph (simulate PolliStretch replacement)
    paragraph.replaceChildren();
    const wrapper = document.createElement("span");
    wrapper.textContent = "Transformed text";
    paragraph.appendChild(wrapper);

    // Restore
    const changed = restoreOriginalParagraph(paragraph, originalChildren);
    expect(changed).toBe(true);
    expect(paragraph.childNodes.length).toBe(3);
    expect(paragraph.textContent).toBe("Original bold text");
    // Original strong element should be restored
    const restoredStrong = paragraph.querySelector("strong");
    expect(restoredStrong).not.toBeNull();
    expect(restoredStrong?.textContent).toBe("bold");
  });

  it("returns false if already at original state (by structure check)", () => {
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-polli-id", "p0");
    const text = document.createTextNode("Unchanged");
    paragraph.appendChild(text);
    const originalChildren = snapshotChildren(paragraph);
    const changed = restoreOriginalParagraph(paragraph, originalChildren);
    expect(changed).toBe(false);
  });

  it("returns true and restores when content differs", () => {
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-polli-id", "p0");
    const text = document.createTextNode("Original");
    paragraph.appendChild(text);
    const originalChildren = snapshotChildren(paragraph);

    // Change content
    paragraph.replaceChildren();
    const newText = document.createTextNode("Different");
    paragraph.appendChild(newText);

    const changed = restoreOriginalParagraph(paragraph, originalChildren);
    expect(changed).toBe(true);
    expect(paragraph.textContent).toBe("Original");
  });
});

describe("teardownAll", () => {
  it("removes all data-polli elements and restores paragraphs", () => {
    const doc = document.implementation.createHTMLDocument();
    const body = doc.body;

    // Create a paragraph with PolliStretch content
    const p = doc.createElement("p");
    p.setAttribute("data-polli-id", "p0");
    p.setAttribute("data-polli-level", "kernel");
    const wrapper = doc.createElement("span");
    wrapper.setAttribute("data-polli", "kernel-wrapper");
    wrapper.textContent = "Compressed";
    p.appendChild(wrapper);
    body.appendChild(p);

    // Create toolbar
    const toolbar = doc.createElement("div");
    toolbar.setAttribute("data-polli", "toolbar");
    body.appendChild(toolbar);

    // Create chevron
    const chevron = doc.createElement("span");
    chevron.setAttribute("data-polli", "chevron");
    p.appendChild(chevron);

    // Snapshot original children (before transformation)
    const snapshots = new Map<string, SnapshotEntry[]>();
    const originalP = doc.createElement("p");
    const originalText = doc.createTextNode("Original full paragraph text.");
    originalP.appendChild(originalText);
    snapshots.set("p0", snapshotChildren(originalP));

    // Run teardown
    teardownAll(doc, snapshots);

    // Verify paragraph restored
    const restoredP = doc.querySelector('[data-polli-id="p0"]');
    expect(restoredP).not.toBeNull();
    expect(restoredP?.textContent).toBe("Original full paragraph text.");
    expect(restoredP?.hasAttribute("data-polli")).toBe(false);
    expect(restoredP?.hasAttribute("data-polli-level")).toBe(false);

    // Verify toolbar removed
    expect(doc.querySelector("[data-polli='toolbar']")).toBeNull();

    // Verify chevron removed
    expect(doc.querySelector("[data-polli='chevron']")).toBeNull();
  });

  it("handles missing paragraph element gracefully", () => {
    const doc = document.implementation.createHTMLDocument();
    const snapshots = new Map<string, SnapshotEntry[]>();
    const originalP = doc.createElement("p");
    const originalText = doc.createTextNode("Original");
    originalP.appendChild(originalText);
    snapshots.set("missing-id", snapshotChildren(originalP));

    // Should not throw
    teardownAll(doc, snapshots);
  });

  it("cleans up all data-polli elements even without snapshots", () => {
    const doc = document.implementation.createHTMLDocument();
    const body = doc.body;

    const el1 = doc.createElement("div");
    el1.setAttribute("data-polli", "something");
    body.appendChild(el1);

    const el2 = doc.createElement("span");
    el2.setAttribute("data-polli", "else");
    body.appendChild(el2);

    teardownAll(doc, new Map());

    expect(doc.querySelector("[data-polli]")).toBeNull();
  });
});