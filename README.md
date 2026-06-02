# tilegraphviewer

CesiumJS-based industrial 3D viewer for TileGraphAgent, deployed to **Cloudflare Pages**. It streams 3D Tiles from `public/data/tiles` by default and communicates with the MCP server via the **Cloudflare Worker** HTTP API.

## Architecture

```
Browser (Cloudflare Pages)
  ├── CesiumJS  ←─ 3D Tiles (/data/tiles/tileset.json + GLBs)
  ├── Agent chat panel  ──── POST /chat (SSE) ──▶  Cloudflare Worker
  ├── Model tree panel  ──── GET /hierarchy    ──▶  Cloudflare Worker
  └── Command polling   ──── GET /viewer/commands ─▶  Cloudflare Worker
```

## Tech stack

| Concern         | Technology                           |
| --------------- | ------------------------------------ |
| Hosting         | Cloudflare Pages                     |
| 3D rendering    | CesiumJS                             |
| Build tool      | Vite + vite-plugin-cesium            |
| Tile storage    | Pages static assets (`public/data`)  |
| Agent backend   | Cloudflare Worker (tilegraphmcp)     |
| Viewer commands | HTTP polling (`GET /viewer/commands`) |

## Local development

```bash
cd apps/tilegraphviewer
bun install
bun run dev      # Vite dev server on http://localhost:5173
```

The tileset path is fixed to `/data/tiles/tileset.json`, which maps to `public/data/tiles/tileset.json` in Vite and Cloudflare Pages.

Create a `.env.local` only for backend overrides:

```env
VITE_MCP_REST_URL=http://localhost:9000
```

For local end-to-end testing with newly generated tile files, replace the contents of `public/data/tiles` while preserving the `tileset.json`, `content`, `metadata`, and `index` layout.

```bash
rsync -a ../../output/tiles/ public/data/tiles/
```

## Deployment to Cloudflare Pages

```bash
# Production build
bun run build     # outputs to dist/

# Deploy via Wrangler
npx wrangler pages deploy dist --project-name tilegraphviewer

# Or connect GitHub repo in Cloudflare Dashboard for automatic deploys
```

### Pages build settings (Cloudflare Dashboard)

| Setting                | Value                  |
| ---------------------- | ---------------------- |
| Framework preset       | None (Vite)            |
| Build command          | `bun run build`        |
| Build output directory | `dist`                 |
| Root directory         | `apps/tilegraphviewer` |

### Environment variables (set in Cloudflare Pages → Settings → Environment Variables)

| Variable            | Production value                                                         | Description                         |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `VITE_MCP_REST_URL` | `https://tilegraphmcp.quatricmorph.workers.dev`                          | Cloudflare Worker base URL          |

## Tile data in public/data

The viewer loads the root tileset from `/data/tiles/tileset.json`. In the repository and Cloudflare Pages build output, that maps to `public/data/tiles/tileset.json`.

```
public/data/tiles/
  ├── tileset.json
  ├── content/
  │    ├── area-a-piping.glb
  │    ├── area-a-equipment.glb
  │    └── ...
  ├── metadata/
  │    └── tile_feature_map.json
  └── index/
       └── spatial_index.json
```

## Viewer features

- **3D Tiles streaming** — hierarchical LOD rendering of industrial plant geometry
- **Feature picking** — click any object to see its engineering properties (tag, class, status, AABB)
- **Highlight / isolate** — objects highlighted or isolated by AI agent commands from the HTTP API
- **Model tree** — area → system → line hierarchy panel (populated from `/hierarchy` REST endpoint)
- **Agent chat** — natural language queries routed to the Cloudflare Worker AI agent loop
- **Audit log panel** — last 5 tool calls from the agent session

The HTTP command polling channel is optional for rendering. If the MCP Worker is unavailable, Cesium still loads `/data/tiles/tileset.json` and its referenced GLBs; only agent-issued viewer commands are unavailable until the API responds again.

## Build

```bash
bun run build    # TypeScript compile + Vite bundle → dist/
bun run preview  # Serve dist/ locally for final check before deploy
```
