export const MCP_REST_BASE = (
  import.meta.env.VITE_MCP_REST_URL?.trim() || "http://localhost:9000"
).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${MCP_REST_BASE}${normalizedPath}`;
}
