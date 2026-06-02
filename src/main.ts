import "./styles.css";

import { initCesiumViewer } from "./viewer/cesium_init.js";
import type { TileGraphViewer } from "./viewer/cesium_init.js";
import { HttpViewerCommandClient } from "./agent/http_command_client.js";
import { sendAgentMessage } from "./agent/claude_client.js";
import { store } from "./state/store.js";
import { fetchAndRenderProperties } from "./ui/properties_panel.js";
import { initModelTree } from "./ui/model_tree.js";
import { MCP_REST_BASE } from "./api.js";

const TILESET_PATH = "/data/tiles/tileset.json";

async function main(): Promise<void> {
  const container = document.getElementById("cesium-container");
  if (!container) throw new Error("Missing #cesium-container");

  const tileGraph = await initCesiumViewer(
    "cesium-container",
    TILESET_PATH,
    async (objectId, tag) => {
      store.update({ selectedObjectId: objectId, selectedTag: tag });
      const panel = document.getElementById("selection-panel")!;
      await fetchAndRenderProperties(objectId, panel);
    }
  );

  startOptionalCommandPolling(tileGraph);

  store.subscribe(renderAuditPanel);

  // Initialize model tree (non-blocking — shows error if MCP server not running)
  initModelTree(
    document.getElementById("model-tree-panel")!,
    (objectIds) => {
      tileGraph.isolateObjects(objectIds);
      store.update({ isolatedObjectIds: new Set(objectIds) });
    },
    (objectIds) => {
      tileGraph.highlightObjects(objectIds);
      store.update({ highlightedObjectIds: new Set(objectIds) });
    }
  );

  // Wire the agent chat panel
  const agentInput = document.getElementById("agent-input") as HTMLInputElement;
  const agentSubmit = document.getElementById("agent-submit") as HTMLButtonElement;
  const agentMessages = document.getElementById("agent-messages")!;

  let agentAbortController: AbortController | null = null;

  function appendAgentMessage(role: "user" | "assistant", text: string): HTMLElement {
    const div = document.createElement("div");
    div.className = `msg-${role}`;
    div.textContent = text;
    agentMessages.appendChild(div);
    agentMessages.scrollTop = agentMessages.scrollHeight;
    return div;
  }

  agentSubmit.addEventListener("click", async () => {
    const message = agentInput.value.trim();
    if (!message) return;

    agentInput.value = "";
    agentSubmit.disabled = true;
    store.update({ isAgentProcessing: true });

    appendAgentMessage("user", message);
    const assistantDiv = appendAgentMessage("assistant", "");
    let assistantText = "";

    agentAbortController = new AbortController();

    try {
      await sendAgentMessage(
        message,
        (chunk) => {
          if (chunk.type === "chunk" && chunk.text) {
            assistantText += chunk.text;
            assistantDiv.textContent = assistantText;
            agentMessages.scrollTop = agentMessages.scrollHeight;
          } else if (chunk.type === "done") {
            const toolSummary = chunk.tool_calls?.join(", ") ?? "none";
            const meta = document.createElement("div");
            meta.className = "msg-meta";
            meta.textContent = `[${chunk.turns} turns, tools: ${toolSummary}]`;
            agentMessages.appendChild(meta);
            agentMessages.scrollTop = agentMessages.scrollHeight;
          } else if (chunk.type === "error") {
            assistantDiv.textContent = `Error: ${chunk.message}`;
            (assistantDiv as HTMLElement).style.color = "#ef5350";
          }
        },
        agentAbortController.signal,
      );
    } finally {
      agentSubmit.disabled = false;
      store.update({ isAgentProcessing: false });
      agentAbortController = null;
    }
  });

  agentInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      agentSubmit.click();
    }
  });

  console.log("[TileGraphAgent Viewer] ready");
}

function renderAuditPanel(state: ReturnType<typeof store.get>): void {
  const panel = document.getElementById("audit-panel");
  if (!panel) return;
  const last5 = state.auditLog.slice(-5).reverse();
  panel.innerHTML = `
    <h3>Audit Log</h3>
    ${last5.map((e) => `<div class="audit-entry"><span class="tool">${e.tool_name}</span> ${e.timestamp}</div>`).join("")}
  `;
}

main().catch(console.error);

function startOptionalCommandPolling(tileGraph: TileGraphViewer): void {
  window.setTimeout(() => {
    try {
      const commandClient = new HttpViewerCommandClient(MCP_REST_BASE, tileGraph);
      commandClient.start();
    } catch (err) {
      console.warn("[HTTP Commands] Command polling unavailable; Cesium tile loading is unaffected.", err);
    }
  }, 0);
}
