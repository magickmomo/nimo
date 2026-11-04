import { WORLD_OBJECTS, objectById, observableProperties, type WorldObject } from "../../web/lib/world-map";

type ObservationRow = { id:number; object_id:string; observed_at:string; properties_json:string; comparison:string; changed_properties:string };
type NoteRow = { object_id:string; label:string; note:string; updated_at:string };

export function compareObservations(previous: Record<string,unknown> | null, current: Record<string,unknown>) {
  if (!previous) return { comparison:"first" as const, changedProperties:[] as string[] };
  const changedProperties = [...new Set([...Object.keys(previous),...Object.keys(current)])]
    .filter(key => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
    .sort();
  return {comparison: changedProperties.length ? "changed" as const : "unchanged" as const, changedProperties};
}

export async function inspectAndRemember(db:D1Database, object:WorldObject) {
  // A single object ID identifies the same piece of scenery across all visits.
  const properties = observableProperties(object);
  const last = await db.prepare("SELECT properties_json FROM object_observations WHERE object_id=? ORDER BY id DESC LIMIT 1")
    .bind(object.id).first<{properties_json:string}>();
  const comparison = compareObservations(last ? JSON.parse(last.properties_json) : null, properties);
  await db.batch([
    db.prepare("INSERT INTO object_observations(object_id,properties_json,comparison,changed_properties) VALUES(?,?,?,?)")
      .bind(object.id,JSON.stringify(properties),comparison.comparison,JSON.stringify(comparison.changedProperties)),
    db.prepare(`INSERT INTO world_inspected(x,y,kind,description,inspection_count) VALUES(?,?,?,?,1)
      ON CONFLICT(x,y) DO UPDATE SET inspection_count=world_inspected.inspection_count+1,
      last_inspected=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(object.x,object.y,object.kind,properties.appearance),
  ]);
  const total = await db.prepare("SELECT COUNT(*) AS n FROM object_observations WHERE object_id=?")
    .bind(object.id).first<{n:number}>();
  return {objectId:object.id,description:properties.appearance,properties,
    comparison:comparison.comparison,changedProperties:comparison.changedProperties,
    recordedObservations:total?.n??1};
}

export async function saveObjectNote(db:D1Database,id:string,label:string,note:string) {
  const object = objectById(id);
  if (!object) throw new Error("Unknown object ID");
  if (label.length>80 || note.length>500 || (!label.trim()&&!note.trim()))
    throw new Error("Provide a label or note within the length limits");
  await db.prepare(`INSERT INTO object_notes(object_id,label,note) VALUES(?,?,?)
    ON CONFLICT(object_id) DO UPDATE SET label=excluded.label,note=excluded.note,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(id,label.trim(),note.trim()).run();
  return {objectId:id,label:label.trim(),note:note.trim()};
}

export async function objectMemory(db:D1Database) {
  const [observations,notes] = await Promise.all([
    db.prepare(`SELECT id,object_id,observed_at,properties_json,comparison,changed_properties
      FROM object_observations ORDER BY id DESC LIMIT 500`).all<ObservationRow>(),
    db.prepare("SELECT object_id,label,note,updated_at FROM object_notes").all<NoteRow>(),
  ]);
  return WORLD_OBJECTS.map(object => {
    const history=observations.results.filter(o=>o.object_id===object.id);
    const note=notes.results.find(n=>n.object_id===object.id);
    return { id:object.id,kind:object.kind,x:object.x,y:object.y,
      label:note?.label??"",note:note?.note??"",notesUpdatedAt:note?.updated_at??null,
      inspectionCount:history.length,latestComparison:history[0]?.comparison??null,
      // Historical world_inspected rows may predate 007; only report comparisons actually recorded.
      observations:history.map(h=>({id:h.id,at:h.observed_at,comparison:h.comparison,
        properties:JSON.parse(h.properties_json),changedProperties:JSON.parse(h.changed_properties)})),
    };
  });
}
