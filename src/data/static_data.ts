export interface StaticObjectRecord {
  object_id: string;
  tag?: string;
  name?: string;
  class?: string;
  status?: string;
  parent_id?: string | null;
  feature_id?: number | null;
  tile_id?: string | null;
  properties?: Record<string, unknown>;
  aabb?: {
    min?: number[];
    max?: number[];
  } | null;
  [key: string]: unknown;
}

interface StaticRelationshipRecord {
  source_id: string;
  target_id: string;
  rel_type: string;
}

interface TileFeatureMapping {
  object_id: string;
  feature_id: number;
  tile_id?: string;
  glb_content_uri?: string;
  world_aabb?: {
    min?: number[];
    max?: number[];
  };
}

interface TileFeatureMap {
  mappings?: TileFeatureMapping[];
}

export interface StaticTreeNode {
  id: string;
  tag: string;
  name: string;
  class: string;
  children?: StaticTreeNode[];
  objectIds?: string[];
}

const OBJECT_PROPERTIES_PATH = "/data/tiles/metadata/object_properties.json";
const TILE_FEATURE_MAP_PATH = "/data/tiles/metadata/tile_feature_map.json";
const SYNTH_OBJECTS_PATH = "/data/synth/objects.json";
const SYNTH_RELATIONSHIPS_PATH = "/data/synth/relationships.json";

let objectPropertiesPromise: Promise<StaticObjectRecord[]> | null = null;
let objectPropertiesByIdPromise: Promise<Map<string, StaticObjectRecord>> | null = null;
let synthObjectsPromise: Promise<StaticObjectRecord[]> | null = null;
let synthRelationshipsPromise: Promise<StaticRelationshipRecord[]> | null = null;
let renderableObjectIdsPromise: Promise<Set<string>> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function loadStaticObjectProperties(): Promise<StaticObjectRecord[]> {
  objectPropertiesPromise ??= fetchJson<StaticObjectRecord[]>(OBJECT_PROPERTIES_PATH);
  return objectPropertiesPromise;
}

async function loadStaticObjectPropertiesById(): Promise<Map<string, StaticObjectRecord>> {
  objectPropertiesByIdPromise ??= loadStaticObjectProperties().then((records) => {
    const byId = new Map<string, StaticObjectRecord>();
    for (const record of records) {
      byId.set(record.object_id, record);
    }
    return byId;
  });
  return objectPropertiesByIdPromise;
}

export async function fetchStaticObjectProperties(
  objectId: string
): Promise<StaticObjectRecord | null> {
  const byId = await loadStaticObjectPropertiesById();
  return byId.get(objectId) ?? null;
}

async function loadSynthObjects(): Promise<StaticObjectRecord[]> {
  synthObjectsPromise ??= fetchJson<StaticObjectRecord[]>(SYNTH_OBJECTS_PATH);
  return synthObjectsPromise;
}

async function loadSynthRelationships(): Promise<StaticRelationshipRecord[]> {
  synthRelationshipsPromise ??= fetchJson<StaticRelationshipRecord[]>(SYNTH_RELATIONSHIPS_PATH);
  return synthRelationshipsPromise;
}

async function loadRenderableObjectIds(): Promise<Set<string>> {
  renderableObjectIdsPromise ??= fetchJson<TileFeatureMap>(TILE_FEATURE_MAP_PATH).then((data) => {
    return new Set((data.mappings ?? []).map((mapping) => mapping.object_id));
  });
  return renderableObjectIdsPromise;
}

export async function loadStaticHierarchy(): Promise<StaticTreeNode[]> {
  const [objects, relationships, renderableObjectIds] = await Promise.all([
    loadSynthObjects(),
    loadSynthRelationships(),
    loadRenderableObjectIds(),
  ]);

  const childrenByParentId = buildChildrenIndex(objects, relationships);
  const objectById = new Map(objects.map((object) => [object.object_id, object]));
  const rootObjects = objects.filter((object) => {
    const parentIds = childrenByParentId.parentIdsByChildId.get(object.object_id);
    return !object.parent_id && (!parentIds || parentIds.size === 0);
  });

  const roots = rootObjects.length > 0 ? rootObjects : objects.filter((object) => object.class === "Plant");
  return roots
    .map((object) => buildTreeNode(object, objectById, childrenByParentId.childrenByParentId, renderableObjectIds))
    .filter((node): node is StaticTreeNode => node !== null);
}

function buildChildrenIndex(
  objects: StaticObjectRecord[],
  relationships: StaticRelationshipRecord[]
): {
  childrenByParentId: Map<string, Set<string>>;
  parentIdsByChildId: Map<string, Set<string>>;
} {
  const knownIds = new Set(objects.map((object) => object.object_id));
  const childrenByParentId = new Map<string, Set<string>>();
  const parentIdsByChildId = new Map<string, Set<string>>();

  const addParentChild = (parentId: string, childId: string): void => {
    if (!knownIds.has(parentId) || !knownIds.has(childId)) return;

    let children = childrenByParentId.get(parentId);
    if (!children) {
      children = new Set<string>();
      childrenByParentId.set(parentId, children);
    }
    children.add(childId);

    let parents = parentIdsByChildId.get(childId);
    if (!parents) {
      parents = new Set<string>();
      parentIdsByChildId.set(childId, parents);
    }
    parents.add(parentId);
  };

  for (const object of objects) {
    if (object.parent_id) addParentChild(object.parent_id, object.object_id);
  }

  for (const relationship of relationships) {
    if (relationship.rel_type === "PART_OF") {
      addParentChild(relationship.target_id, relationship.source_id);
    }
  }

  return { childrenByParentId, parentIdsByChildId };
}

function buildTreeNode(
  object: StaticObjectRecord,
  objectById: Map<string, StaticObjectRecord>,
  childrenByParentId: Map<string, Set<string>>,
  renderableObjectIds: Set<string>
): StaticTreeNode | null {
  const childIds = Array.from(childrenByParentId.get(object.object_id) ?? []);
  const children = childIds
    .map((childId) => objectById.get(childId))
    .filter((child): child is StaticObjectRecord => Boolean(child))
    .sort(compareObjectsForTree)
    .map((child) => buildTreeNode(child, objectById, childrenByParentId, renderableObjectIds))
    .filter((node): node is StaticTreeNode => node !== null);

  const objectIds = collectRenderableObjectIds(object.object_id, children, renderableObjectIds);
  return {
    id: object.object_id,
    tag: object.tag ?? object.name ?? object.object_id,
    name: object.name ?? object.tag ?? object.object_id,
    class: object.class ?? "EngObject",
    children: children.length > 0 ? children : undefined,
    objectIds: objectIds.length > 0 ? objectIds : undefined,
  };
}

function collectRenderableObjectIds(
  objectId: string,
  children: StaticTreeNode[],
  renderableObjectIds: Set<string>
): string[] {
  const ids = new Set<string>();
  if (renderableObjectIds.has(objectId)) ids.add(objectId);

  for (const child of children) {
    for (const childObjectId of child.objectIds ?? []) {
      ids.add(childObjectId);
    }
  }

  return Array.from(ids);
}

function compareObjectsForTree(a: StaticObjectRecord, b: StaticObjectRecord): number {
  const classOrder = classSortIndex(a.class) - classSortIndex(b.class);
  if (classOrder !== 0) return classOrder;
  return String(a.tag ?? a.name ?? a.object_id).localeCompare(String(b.tag ?? b.name ?? b.object_id));
}

function classSortIndex(className: string | undefined): number {
  const order = ["Plant", "Area", "System", "Line"];
  const index = order.indexOf(className ?? "");
  return index === -1 ? order.length : index;
}
