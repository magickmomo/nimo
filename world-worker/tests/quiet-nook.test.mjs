import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
async function fromTs(src) {
 const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
}
const world=await fromTs(read("../../web/lib/world-map.ts"));
const curiosity=await fromTs(read("../src/curiosity.ts"));

test("garden nook at (6,13) is a discoverable, non-walkable bench landmark",()=>{
 const nook=world.WORLD_OBJECTS.find(o=>o.id==="garden_nook_001");
 assert.deepEqual({x:nook?.x,y:nook?.y,kind:nook?.kind},{x:5,y:12,kind:"garden_nook"});
 assert.equal(world.isWalkable(nook),false);
 assert.match(world.inspectedDescription("garden_nook"),/bench/);
 for(const p of [{x:4,y:12},{x:6,y:12},{x:5,y:11},{x:5,y:13}])
  assert.equal(world.isWalkable(p),true,"The surrounding grass remains accessible");
});
test("rest is offered only at a cardinally adjacent tile and validated again by Worker",()=>{
 const worker=read("../src/index.ts"),menu=read("../src/action-menu.ts"),schema=read("../src/decision-schema.ts");
 assert.match(worker,/nearObject\(position,"garden_nook_001"\)\);/);
 assert.match(menu,/if\(restAtNook\)tools\.push\("rest"\)/);
 assert.match(menu,/if\(menu\.restAtNook\)variants\.push\(obj\(\{name:/);
 assert.match(schema,/toolCall=\{name:"rest"\}/);
 assert.match(worker,/if\(!menu\.restAtNook\|\|!nearObject\(position,"garden_nook_001"\)\)/);
 assert.match(worker,/await recordToolEvent\(env\.DB,"tool",toolOutcome,"RESTED"\)/);
});
test("rest is passive and does not change curiosity; Worker records no meter adjustment",()=>{
 const {activityFor,curiosityStep}=curiosity;
 assert.equal(activityFor("rest").phase,"passive");
 const result=curiosityStep(0.91,["drawing","drawing"],"rest");
 assert.equal(result.value,0.91);
 assert.equal(result.counted,false);
 assert.deepEqual(result.history,["drawing","drawing"]);
 const worker=read("../src/index.ts");
 assert.match(worker,/lastRestedAt: !toolFailed&&d\.toolCall\?\.name==="rest"/);
 assert.match(worker,/toolOutcome="RESTED: Sat quietly on the garden nook bench\."/);
});
test("map uses shared position and pose timeline with accessible motion",()=>{
 const map=read("../../web/app/world/isometric-world.tsx");
 const css=read("../../web/app/world/world.css");
 const timeline=read("../../web/lib/movement-timeline.ts");
 assert.match(map,/function GardenNook/);
 assert.match(map,/function SeatedCharacter/);
 assert.match(map,/const frame=movementFrame\(/);
 assert.match(map,/const current=frame\.position/);
 assert.match(map,/walking=\{moving\}/);
 assert.match(map,/withNimo=\{seated\}/);
 assert.match(timeline,/REST_POSE_MS=60000/);
 assert.match(timeline,/const seated=!sleeping&&!walking/);
 assert.match(timeline,/journey!.status==="paused"/);
 assert.match(css,/@keyframes nimo-sit-breathe/);
 assert.doesNotMatch(css,/@keyframes nimo-walk-bob/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
