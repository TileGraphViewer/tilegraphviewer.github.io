
// ============================================================
// TileGraphAgent — Neo4j Schema Initialization
// Run once before importing nodes/relationships.
// Neo4j 5.x / AuraDB compatible
// ============================================================

// Uniqueness constraints (also create indexes automatically)
CREATE CONSTRAINT obj_id_unique IF NOT EXISTS
  FOR (o:EngObject) REQUIRE o.object_id IS UNIQUE;

CREATE CONSTRAINT tag_pump_unique IF NOT EXISTS
  FOR (p:Pump) REQUIRE p.tag IS UNIQUE;

CREATE CONSTRAINT tag_valve_unique IF NOT EXISTS
  FOR (v:Valve) REQUIRE v.tag IS UNIQUE;

CREATE CONSTRAINT tag_tank_unique IF NOT EXISTS
  FOR (t:Tank) REQUIRE t.tag IS UNIQUE;

CREATE CONSTRAINT tag_line_unique IF NOT EXISTS
  FOR (l:Line) REQUIRE l.tag IS UNIQUE;

CREATE CONSTRAINT tag_instrument_unique IF NOT EXISTS
  FOR (i:Instrument) REQUIRE i.tag IS UNIQUE;

CREATE CONSTRAINT tag_plant_unique IF NOT EXISTS
  FOR (p:Plant) REQUIRE p.tag IS UNIQUE;

CREATE CONSTRAINT feature_id_unique IF NOT EXISTS
  FOR (f:Feature) REQUIRE f.feature_id IS UNIQUE;

// Lookup indexes
CREATE INDEX obj_class_idx IF NOT EXISTS FOR (o:EngObject) ON (o.class);
CREATE INDEX obj_status_idx IF NOT EXISTS FOR (o:EngObject) ON (o.status);
CREATE INDEX obj_tile_idx IF NOT EXISTS FOR (o:EngObject) ON (o.tile_id);
CREATE INDEX line_tag_idx IF NOT EXISTS FOR (l:Line) ON (l.tag);
CREATE INDEX pump_tag_idx IF NOT EXISTS FOR (p:Pump) ON (p.tag);
CREATE INDEX valve_tag_idx IF NOT EXISTS FOR (v:Valve) ON (v.tag);
