/// Minimal reactive state store for the viewer.

export interface ViewerState {
  selectedObjectId: string | null;
  selectedTag: string | null;
  highlightedObjectIds: Set<string>;
  isolatedObjectIds: Set<string> | null;  // null = no isolation active
  agentChatMessages: ChatMessage[];
  auditLog: AuditEntry[];
  isAgentProcessing: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AuditEntry {
  timestamp: string;
  tool_name: string;
  input_summary: string;
  output_summary: string;
  duration_ms: number;
}

type Listener = (state: ViewerState) => void;

class StateStore {
  private state: ViewerState = {
    selectedObjectId: null,
    selectedTag: null,
    highlightedObjectIds: new Set(),
    isolatedObjectIds: null,
    agentChatMessages: [],
    auditLog: [],
    isAgentProcessing: false,
  };
  private listeners: Set<Listener> = new Set();

  get(): ViewerState {
    return this.state;
  }

  update(patch: Partial<ViewerState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const store = new StateStore();
