import { apiUrl } from "../api.js";
import { fetchStaticObjectProperties } from "../data/static_data.js";

interface ObjectProperties {
  object_id: string;
  tag?: string;
  name?: string;
  class?: string;
  status?: string;
  tile_id?: string;
  feature_id?: number;
  [key: string]: unknown;
}

export async function fetchAndRenderProperties(
  objectId: string,
  panelEl: HTMLElement
): Promise<void> {
  panelEl.innerHTML = `<h3>Properties</h3><p class="loading">Loading ${objectId.slice(0, 16)}...</p>`;

  try {
    const res = await fetch(apiUrl(`/objects/${encodeURIComponent(objectId)}`));
    if (!res.ok) {
      await renderStaticProperties(objectId, panelEl);
      return;
    }
    const data: { found: boolean; properties: ObjectProperties } = await res.json();
    panelEl.innerHTML = renderPropertiesTable(data.properties ?? {});
  } catch {
    await renderStaticProperties(objectId, panelEl);
  }
}

async function renderStaticProperties(objectId: string, panelEl: HTMLElement): Promise<void> {
  try {
    const properties = await fetchStaticObjectProperties(objectId);
    if (!properties) {
      panelEl.innerHTML = `<h3>Properties</h3><p class="error">Not found</p>`;
      return;
    }
    panelEl.innerHTML = renderPropertiesTable(properties);
  } catch (err) {
    console.warn("[Properties] Static properties unavailable:", err);
    panelEl.innerHTML = `<h3>Properties</h3><p class="error">Properties unavailable</p>`;
  }
}

function renderPropertiesTable(props: Record<string, unknown>): string {
  const priority = [
    "tag",
    "name",
    "class",
    "status",
    "fluid",
    "design_pressure_bar",
    "design_temperature_c",
    "power_kw",
    "volume_m3",
    "nominal_bore_mm",
  ];
  const shown = new Set<string>();
  let rows = "";

  for (const key of priority) {
    if (key in props && props[key] != null) {
      rows += `<tr><td class="prop-key">${key}</td><td class="prop-val">${props[key]}</td></tr>`;
      shown.add(key);
    }
  }

  for (const [key, val] of Object.entries(props)) {
    if (!shown.has(key) && val != null && !key.startsWith("aabb_")) {
      const display = typeof val === "object" ? JSON.stringify(val) : String(val);
      rows += `<tr><td class="prop-key">${key}</td><td class="prop-val">${display}</td></tr>`;
    }
  }

  return `<h3>Properties</h3>
    <table class="prop-table"><tbody>${rows}</tbody></table>`;
}
