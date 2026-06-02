import type { TileGraphViewer } from "../viewer/cesium_init.js";
import { store } from "../state/store.js";

export type ViewerCommand =
  | { type: "highlight_objects"; object_ids: string[]; color?: string }
  | { type: "isolate_objects"; object_ids: string[] }
  | { type: "focus_camera"; object_ids: string[] }
  | { type: "show_bounding_boxes"; object_ids: string[] }
  | { type: "clear_highlights" }
  | { type: "create_issue_marker"; object_id: string; title: string; severity: string };

type Cursor = string | number;

interface CommandEnvelope {
  id?: Cursor;
  sequence?: Cursor;
  timestamp?: string;
  command?: unknown;
  [key: string]: unknown;
}

interface CommandPollResult {
  commands: CommandEnvelope[];
  nextCursor: Cursor | null;
}

interface HttpViewerCommandClientOptions {
  commandsPath?: string;
  pollIntervalMs?: number;
}

const DEFAULT_COMMANDS_PATH = "/viewer/commands";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_SEEN_COMMANDS = 100;

export class HttpViewerCommandClient {
  private apiBaseUrl: string;
  private viewer: TileGraphViewer;
  private commandsPath: string;
  private pollIntervalMs: number;
  private cursor: Cursor | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private stopped = true;
  private hasLoggedUnavailable = false;
  private seenCommandKeys: string[] = [];
  private seenCommandKeySet: Set<string> = new Set();

  constructor(
    apiBaseUrl: string,
    viewer: TileGraphViewer,
    options: HttpViewerCommandClientOptions = {},
  ) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.viewer = viewer;
    this.commandsPath = options.commandsPath ?? DEFAULT_COMMANDS_PATH;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.inFlight) return;

    this.inFlight = true;
    try {
      const url = new URL(this.commandsPath, `${this.apiBaseUrl}/`);
      if (this.cursor !== null) {
        url.searchParams.set("after", String(this.cursor));
      }

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        this.logUnavailable(`Command polling unavailable (${res.status} ${res.statusText})`);
        return;
      }

      const result = this.normalizePollResult(await res.json());
      for (const entry of result.commands) {
        const key = this.commandKey(entry);
        if (key && this.seenCommandKeySet.has(key)) continue;

        const command = this.extractCommand(entry);
        if (!command) continue;

        this.applyCommand(command);
        if (key) this.rememberCommandKey(key);
      }

      const lastCommand = result.commands.length > 0
        ? result.commands[result.commands.length - 1]
        : undefined;
      this.cursor = result.nextCursor ?? this.cursorFromEntry(lastCommand) ?? this.cursor;
      this.hasLoggedUnavailable = false;
    } catch (err) {
      this.logUnavailable("Command polling failed; Cesium tile loading is unaffected.", err);
    } finally {
      this.inFlight = false;
    }
  }

  private normalizePollResult(payload: unknown): CommandPollResult {
    if (Array.isArray(payload)) {
      return { commands: payload as CommandEnvelope[], nextCursor: null };
    }

    if (!this.isRecord(payload)) {
      return { commands: [], nextCursor: null };
    }

    const commands = Array.isArray(payload.commands)
      ? payload.commands
      : Array.isArray(payload.items)
        ? payload.items
        : [];
    const nextCursor = this.readCursor(payload.next_cursor ?? payload.nextCursor ?? payload.cursor);
    return { commands: commands as CommandEnvelope[], nextCursor };
  }

  private extractCommand(entry: CommandEnvelope): ViewerCommand | null {
    const candidate = this.isRecord(entry.command) ? entry.command : entry;
    const type = typeof candidate.type === "string" ? candidate.type : "";

    switch (type) {
      case "highlight_objects":
        return {
          type,
          object_ids: this.readObjectIds(candidate.object_ids),
          color: typeof candidate.color === "string" ? candidate.color : undefined,
        };
      case "isolate_objects":
      case "focus_camera":
      case "show_bounding_boxes":
        return { type, object_ids: this.readObjectIds(candidate.object_ids) };
      case "clear_highlights":
        return { type };
      case "create_issue_marker":
        if (
          typeof candidate.object_id !== "string" ||
          typeof candidate.title !== "string" ||
          typeof candidate.severity !== "string"
        ) {
          console.warn("[HTTP Commands] Invalid create_issue_marker command:", candidate);
          return null;
        }
        return {
          type,
          object_id: candidate.object_id,
          title: candidate.title,
          severity: candidate.severity,
        };
      default:
        if (type) console.warn("[HTTP Commands] Unknown command:", type);
        return null;
    }
  }

  private applyCommand(cmd: ViewerCommand): void {
    console.log("[HTTP Commands] Received:", cmd.type);

    switch (cmd.type) {
      case "highlight_objects":
        this.viewer.highlightObjects(cmd.object_ids, cmd.color);
        store.update({
          highlightedObjectIds: new Set(cmd.object_ids),
        });
        break;

      case "isolate_objects":
        this.viewer.isolateObjects(cmd.object_ids);
        store.update({
          isolatedObjectIds: new Set(cmd.object_ids),
        });
        break;

      case "focus_camera":
        this.viewer.focusCameraOn(cmd.object_ids);
        break;

      case "show_bounding_boxes":
        this.viewer.showBoundingBoxes(true);
        break;

      case "clear_highlights":
        this.viewer.clearHighlights();
        store.update({
          highlightedObjectIds: new Set(),
          isolatedObjectIds: null,
        });
        break;

      case "create_issue_marker":
        console.log(`[Issue] ${cmd.severity}: ${cmd.title} on ${cmd.object_id}`);
        break;
    }
  }

  private readObjectIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  }

  private readCursor(value: unknown): Cursor | null {
    return typeof value === "string" || typeof value === "number" ? value : null;
  }

  private cursorFromEntry(entry: CommandEnvelope | undefined): Cursor | null {
    if (!entry) return null;
    return this.readCursor(entry.id ?? entry.sequence ?? entry.timestamp);
  }

  private commandKey(entry: CommandEnvelope): string | null {
    const cursor = this.cursorFromEntry(entry);
    if (cursor !== null) return String(cursor);
    try {
      return JSON.stringify(entry.command ?? entry);
    } catch {
      return null;
    }
  }

  private rememberCommandKey(key: string): void {
    this.seenCommandKeys.push(key);
    this.seenCommandKeySet.add(key);

    while (this.seenCommandKeys.length > MAX_SEEN_COMMANDS) {
      const oldest = this.seenCommandKeys.shift();
      if (oldest) this.seenCommandKeySet.delete(oldest);
    }
  }

  private logUnavailable(message: string, err?: unknown): void {
    if (this.hasLoggedUnavailable) return;
    this.hasLoggedUnavailable = true;
    console.warn(`[HTTP Commands] ${message}`, err ?? "");
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
}
