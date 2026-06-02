import { apiUrl } from "../api.js";

export interface AgentChunk {
  type: "chunk" | "done" | "error";
  text?: string;
  turns?: number;
  tool_calls?: string[];
  session_id?: string;
  message?: string;
}

export async function sendAgentMessage(
  message: string,
  onChunk: (chunk: AgentChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl("/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    onChunk({ type: "error", message: (err as { message?: string }).message ?? "Unknown error" });
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const chunk = JSON.parse(line.slice(6)) as AgentChunk;
          onChunk(chunk);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}
