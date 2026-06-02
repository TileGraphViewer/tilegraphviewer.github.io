import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

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

const HIGHLIGHT_COLOR_HEX = "#00CCFF";
const NORMAL_COLOR_HEX = "#CCCCCC";
const DIM_COLOR_HEX = "#555555";

function buildHighlightStyle(
  highlightIds: string[],
  isolatedIds: string[] | null
): Cesium.Cesium3DTileStyle {
  if (isolatedIds !== null && isolatedIds.length > 0) {
    const idList = isolatedIds.map((id) => `'${id}'`).join(",");
    return new Cesium.Cesium3DTileStyle({
      show: `Boolean([${idList}].indexOf(String(\${object_id})) >= 0)`,
      color: {
        conditions: [
          [
            `[${idList}].indexOf(String(\${object_id})) >= 0`,
            `color('${HIGHLIGHT_COLOR_HEX}', 1.0)`,
          ],
          ["true", `color('${NORMAL_COLOR_HEX}', 0.0)`],
        ],
      },
    });
  }

  if (highlightIds.length > 0) {
    const idList = highlightIds.map((id) => `'${id}'`).join(",");
    return new Cesium.Cesium3DTileStyle({
      show: "true",
      color: {
        conditions: [
          [
            `[${idList}].indexOf(String(\${object_id})) >= 0`,
            `color('${HIGHLIGHT_COLOR_HEX}', 1.0)`,
          ],
          ["true", `color('${DIM_COLOR_HEX}', 0.5)`],
        ],
      },
    });
  }

  return new Cesium.Cesium3DTileStyle({
    color: `color('${NORMAL_COLOR_HEX}', 0.9)`,
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
  });

  viewer.scene.backgroundColor = new Cesium.Color(0.12, 0.12, 0.16, 1.0);

  const tilesetRef = { tileset: null as Cesium.Cesium3DTileset | null };

  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetPath);
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    tilesetRef.tileset = tileset;

    tileset.style = buildHighlightStyle([], null);

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

      if (picked instanceof Cesium.Cesium3DTileFeature) {
        const objectId = picked.getProperty("object_id") as string | undefined;
        const tag = picked.getProperty("tag") as string | undefined;
        if (objectId) {
          onObjectSelected(objectId, tag ?? null);
          return;
        }

        // Fallback: read from node extras (pre-EXT_structural_metadata)
        const extras = (picked as any)._content?._model?._loader?.gltfJson?.nodes?.find(
          (n: any) => n.extras?.feature_id === picked.featureId
        )?.extras;
        if (extras?.object_id) {
          onObjectSelected(extras.object_id, extras.tag ?? null);
        }
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
    viewer.zoomTo(tilesetRef.tileset);
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
