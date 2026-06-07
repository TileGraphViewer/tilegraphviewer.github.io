import { apiUrl } from "../api.js";

interface TreeNode {
  id: string;
  tag: string;
  name: string;
  class: string;
  children?: TreeNode[];
  objectIds?: string[];
}

export async function initModelTree(
  panelEl: HTMLElement,
  onIsolate: (objectIds: string[]) => void,
  onSelect: (objectIds: string[]) => void
): Promise<void> {
  panelEl.innerHTML = renderModelTreeShell(`<p class="loading">Loading hierarchy...</p>`);
  try {
    const res = await fetch(apiUrl("/hierarchy"));
    if (!res.ok) {
      panelEl.innerHTML = renderModelTreeShell(`<p class="error">Hierarchy unavailable</p>`);
      return;
    }
    const tree: TreeNode[] = await res.json();
    panelEl.innerHTML = renderModelTreeShell(renderTree(tree));
    attachTreeHandlers(panelEl, onIsolate, onSelect);
  } catch {
    panelEl.innerHTML = renderModelTreeShell(`<p class="error">MCP server unreachable</p>`);
  }
}

function renderModelTreeShell(content: string): string {
  return `<h3>Model Tree</h3><p class="panel-note">Hierarchy</p><div class="model-tree-content">${content}</div>`;
}

function renderTree(nodes: TreeNode[]): string {
  return nodes
    .map((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const icon = hasChildren ? "▶" : "•";
      const ids = (node.objectIds ?? []).join(",");
      const isolateBtn = node.objectIds?.length
        ? `<button class="tree-isolate" data-ids="${ids}">⊡</button>`
        : "";
      const childrenHtml = hasChildren
        ? `<div class="tree-children" hidden>${renderTree(node.children!)}</div>`
        : "";
      return `
        <div class="tree-node" data-class="${node.class}">
          <div class="tree-row">
            <span class="tree-toggle ${hasChildren ? "has-children" : ""}">${icon}</span>
            <span class="tree-label" data-ids="${ids}" title="${node.tag}">${node.tag || node.name}</span>
            ${isolateBtn}
          </div>
          ${childrenHtml}
        </div>`;
    })
    .join("");
}

function attachTreeHandlers(
  panelEl: HTMLElement,
  onIsolate: (ids: string[]) => void,
  onSelect: (ids: string[]) => void
): void {
  panelEl.querySelectorAll(".tree-toggle.has-children").forEach((el) => {
    el.addEventListener("click", (e) => {
      const row = (e.target as Element).closest(".tree-node");
      const children = row?.querySelector(".tree-children") as HTMLElement | null;
      if (children) {
        const isOpen = !children.hidden;
        children.hidden = isOpen;
        (e.target as Element).textContent = isOpen ? "▶" : "▼";
      }
    });
  });

  panelEl.querySelectorAll(".tree-label").forEach((el) => {
    el.addEventListener("click", () => {
      const ids = (el.getAttribute("data-ids") ?? "").split(",").filter(Boolean);
      if (ids.length > 0) onSelect(ids);
    });
  });

  panelEl.querySelectorAll(".tree-isolate").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const ids = (el.getAttribute("data-ids") ?? "").split(",").filter(Boolean);
      if (ids.length > 0) onIsolate(ids);
    });
  });
}
