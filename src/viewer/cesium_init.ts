import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { loadStaticObjectProperties } from "../data/static_data.js";

export interface TileGraphViewer {
  viewer: Cesium.Viewer;
  tilesetRef: { tileset: Cesium.Cesium3DTileset | null };
  featureIdToObjectId: Map<number, string>;
  objectIdToFeatureId: Map<string, number>;
  highlightObjects: (objectIds: string[], color?: string) => void;
  clearHighlights: () => void;
  isolateObjects: (objectIds: string[]) => void;
  focusCameraOn: (objectIds: string[]) => void;
  showBoundingBoxes: (show: boolean) => void;
}

export const featureIdToObjectId: Map<number, string> = new Map();
export const objectIdToFeatureId: Map<string, number> = new Map();

const LOCAL_TILESET_ECEF_THRESHOLD_METERS = 100_000;

interface ViewerThemeColors {
  background: string;
  highlight: string;
  normal: string;
  dim: string;
}

function readCssColorVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function getViewerThemeColors(): ViewerThemeColors {
  return {
    background: readCssColorVar("--app-viewer-bg", "black"),
    highlight: readCssColorVar("--app-viewer-highlight", "cyan"),
    normal: readCssColorVar("--app-viewer-normal", "white"),
    dim: readCssColorVar("--app-viewer-dim", "gray"),
  };
}

function readNumberEnv(name: string, fallback: number): number {
  const value = Number(import.meta.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getTilesetOriginFrame(): Cesium.Matrix4 {
  const longitude = readNumberEnv("VITE_TILESET_ORIGIN_LONGITUDE", 0);
  const latitude = readNumberEnv("VITE_TILESET_ORIGIN_LATITUDE", 0);
  const height = readNumberEnv("VITE_TILESET_ORIGIN_HEIGHT", 0);
  const origin = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
  return Cesium.Transforms.eastNorthUpToFixedFrame(origin);
}

function isPlantLocalTileset(tileset: Cesium.Cesium3DTileset): boolean {
  const centerMagnitude = Cesium.Cartesian3.magnitude(tileset.boundingSphere.center);
  return (
    Number.isFinite(centerMagnitude) &&
    centerMagnitude > 0 &&
    centerMagnitude < LOCAL_TILESET_ECEF_THRESHOLD_METERS
  );
}

function configureSceneForPlantModel(viewer: Cesium.Viewer): void {
  if (viewer.scene.globe) {
    viewer.scene.globe.show = false;
  }
  viewer.scene.fog.enabled = false;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  viewer.scene.camera.frustum.near = 0.1;
}

function placeLocalTilesetIfNeeded(tileset: Cesium.Cesium3DTileset): Cesium.BoundingSphere | null {
  if (!isPlantLocalTileset(tileset)) return null;
  const localBoundingSphere = Cesium.BoundingSphere.clone(tileset.boundingSphere);
  tileset.modelMatrix = getTilesetOriginFrame();
  return localBoundingSphere;
}

function getTilesetFrameSphere(
  tileset: Cesium.Cesium3DTileset,
  localBoundingSphere: Cesium.BoundingSphere | null
): Cesium.BoundingSphere {
  if (!localBoundingSphere) return tileset.boundingSphere;

  const center = Cesium.Matrix4.multiplyByPoint(
    tileset.modelMatrix,
    localBoundingSphere.center,
    new Cesium.Cartesian3()
  );
  return new Cesium.BoundingSphere(center, localBoundingSphere.radius);
}

function frameTilesetCamera(viewer: Cesium.Viewer, sphere: Cesium.BoundingSphere): void {
  const range = Math.max(sphere.radius * 1.45, 82);
  viewer.camera.lookAt(
    sphere.center,
    new Cesium.HeadingPitchRange(
      0,
      Cesium.Math.toRadians(-89),
      range
    )
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}

function escapeStyleString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildObjectIdPredicate(objectIds: string[]): string {
  return objectIds.length > 0
    ? objectIds.map((id) => `\${object_id} === '${escapeStyleString(id)}'`).join(" || ")
    : "false";
}

function buildHighlightStyle(
  highlightIds: string[],
  isolatedIds: string[] | null
): Cesium.Cesium3DTileStyle {
  const colors = getViewerThemeColors();

  if (isolatedIds !== null && isolatedIds.length > 0) {
    const predicate = buildObjectIdPredicate(isolatedIds);
    return new Cesium.Cesium3DTileStyle({
      show: predicate,
      color: {
        conditions: [
          [predicate, `color('${colors.highlight}', 1.0)`],
          ["true", `color('${colors.normal}', 0.0)`],
        ],
      },
    });
  }

  if (highlightIds.length > 0) {
    const predicate = buildObjectIdPredicate(highlightIds);
    return new Cesium.Cesium3DTileStyle({
      show: "true",
      color: {
        conditions: [
          [predicate, `color('${colors.highlight}', 1.0)`],
          ["true", `color('${colors.dim}', 0.5)`],
        ],
      },
    });
  }

  return new Cesium.Cesium3DTileStyle({
    color: `color('${colors.normal}', 0.9)`,
  });
}

export async function initCesiumViewer(
  containerId: string,
  tilesetPath: string,
  onObjectSelected: (objectId: string, tag: string | null) => void
): Promise<TileGraphViewer> {
  Cesium.Ion.defaultAccessToken = "";

  const viewer = new Cesium.Viewer(containerId, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    animation: false,
    scene3DOnly: true,
    skyBox: false,
    skyAtmosphere: false,
    baseLayer: false,
    globe: false,
  });

  configureSceneForPlantModel(viewer);

  viewer.scene.backgroundColor =
    Cesium.Color.fromCssColorString(getViewerThemeColors().background) ?? Cesium.Color.BLACK;

  const tilesetRef = { tileset: null as Cesium.Cesium3DTileset | null };
  let currentFrameSphere: Cesium.BoundingSphere | null = null;

  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetPath);
    const localBoundingSphere = placeLocalTilesetIfNeeded(tileset);
    const frameSphere = getTilesetFrameSphere(tileset, localBoundingSphere);
    currentFrameSphere = frameSphere;
    viewer.scene.primitives.add(tileset);
    frameTilesetCamera(viewer, frameSphere);
    tilesetRef.tileset = tileset;

    tileset.style = buildHighlightStyle([], null);
    void populateFeatureMapsFromStaticMetadata();
    tileset.initialTilesLoaded.addEventListener(() => frameTilesetCamera(viewer, frameSphere));

    // Populate feature ↔ object_id lookup maps as tiles stream in
    tileset.tileVisible.addEventListener((tile: Cesium.Cesium3DTile) => {
      const content = tile.content;
      if (!content) return;
      const featuresLength = content.featuresLength;
      for (let i = 0; i < featuresLength; i++) {
        try {
          const feature = content.getFeature(i);
          const oid = feature.getProperty("object_id") as string | undefined;
          const fid = feature.getProperty("feature_id") as number | undefined;
          if (oid && fid != null) {
            featureIdToObjectId.set(fid, oid);
            objectIdToFeatureId.set(oid, fid);
          }
        } catch {
          // Some tiles may not support getFeature — skip silently
        }
      }
    });
  } catch (err) {
    console.error("Failed to load tileset:", err);
  }

  // Feature picking with EXT_structural_metadata primary path and node.extras fallback
  viewer.screenSpaceEventHandler.setInputAction(
    (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position);
      if (!Cesium.defined(picked)) return;

      const objectId = readPickedStringProperty(picked, "object_id");
      const tag = readPickedStringProperty(picked, "tag");
      if (objectId) {
        onObjectSelected(objectId, tag ?? null);
        return;
      }

      const featureId = readPickedNumberProperty(picked, "feature_id") ?? readPickedFeatureId(picked);
      const mappedObjectId = featureId != null ? featureIdToObjectId.get(featureId) : undefined;
      if (mappedObjectId) {
        onObjectSelected(mappedObjectId, tag ?? null);
        return;
      }

      const extras = readPickedNodeExtras(picked, featureId);
      if (extras?.object_id) {
        onObjectSelected(String(extras.object_id), extras.tag ? String(extras.tag) : null);
      }
    },
    Cesium.ScreenSpaceEventType.LEFT_CLICK
  );

  const highlightObjects = (objectIds: string[], _color?: string): void => {
    if (!tilesetRef.tileset) return;
    tilesetRef.tileset.style = buildHighlightStyle(objectIds, null);
  };

  const clearHighlights = (): void => {
    if (!tilesetRef.tileset) return;
    tilesetRef.tileset.style = buildHighlightStyle([], null);
  };

  const isolateObjects = (objectIds: string[]): void => {
    if (!tilesetRef.tileset) return;
    tilesetRef.tileset.style = buildHighlightStyle([], objectIds);
  };

  const focusCameraOn = (_objectIds: string[]): void => {
    if (!tilesetRef.tileset) return;
    if (currentFrameSphere) {
      frameTilesetCamera(viewer, currentFrameSphere);
    } else {
      void viewer.zoomTo(tilesetRef.tileset);
    }
  };

  const showBoundingBoxes = (show: boolean): void => {
    if (tilesetRef.tileset) {
      tilesetRef.tileset.debugShowBoundingVolume = show;
    }
  };

  return {
    viewer,
    tilesetRef,
    featureIdToObjectId,
    objectIdToFeatureId,
    highlightObjects,
    clearHighlights,
    isolateObjects,
    focusCameraOn,
    showBoundingBoxes,
  };
}

async function populateFeatureMapsFromStaticMetadata(): Promise<void> {
  try {
    const records = await loadStaticObjectProperties();
    for (const record of records) {
      if (typeof record.object_id === "string" && typeof record.feature_id === "number") {
        featureIdToObjectId.set(record.feature_id, record.object_id);
        objectIdToFeatureId.set(record.object_id, record.feature_id);
      }
    }
  } catch (err) {
    console.warn("[Tileset] Static feature metadata unavailable:", err);
  }
}

function readPickedStringProperty(picked: unknown, name: string): string | undefined {
  const value = readPickedProperty(picked, name);
  return typeof value === "string" ? value : undefined;
}

function readPickedNumberProperty(picked: unknown, name: string): number | undefined {
  const value = readPickedProperty(picked, name);
  return typeof value === "number" ? value : undefined;
}

function readPickedProperty(picked: unknown, name: string): unknown {
  const candidate = picked as {
    getProperty?: (propertyName: string) => unknown;
    getPropertyInherited?: (propertyName: string) => unknown;
  };

  try {
    const value = candidate.getProperty?.(name);
    if (value != null) return value;
  } catch {
    // Fall through to inherited metadata lookup.
  }

  try {
    return candidate.getPropertyInherited?.(name);
  } catch {
    return undefined;
  }
}

function readPickedFeatureId(picked: unknown): number | undefined {
  const featureId = (picked as { featureId?: unknown }).featureId;
  return typeof featureId === "number" ? featureId : undefined;
}

function readPickedNodeExtras(
  picked: unknown,
  featureId: number | undefined
): Record<string, unknown> | null {
  if (featureId == null) return null;

  const nodes = (picked as any)?._content?._model?._loader?.gltfJson?.nodes;
  if (!Array.isArray(nodes)) return null;

  const node = nodes.find((candidate: any) => candidate?.extras?.feature_id === featureId);
  return node?.extras ?? null;
}
