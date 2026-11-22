import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const source=readFileSync(new URL("../lib/movement-timeline.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {movementFrame,eligibleJourneyReplay}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const start="2026-11-22T10:00:00.000Z",t=Date.parse(start),p={x:4,y:4};
const trip={status:"travelling",path:[p,{x:5,y:4}],stepIndex:0,stepMs:1500,startedAt:start,pausedAt:null};
const frame=(journey,at,rest)=>movementFrame({position:p,journey,now:at,lastRestedAt:rest});

test("single tile: position and limb pose share the same progress; arrival stands still",()=>{
 const beginning=frame(trip,t);
 assert.deepEqual(beginning.position,p);
 assert.equal(beginning.walking,true);
 assert.equal(beginning.legSwing,0);
 const quarter=frame(trip,t+375);
 assert.equal(quarter.position.x,4.25);
 assert.equal(quarter.progress,0.25);
 assert.equal(quarter.legSwing,16);
 assert.ok(quarter.bodyBob>0);
 const halfway=frame(trip,t+750);
 assert.equal(halfway.position.x,4.5);
 assert.ok(Math.abs(halfway.legSwing)<1e-10);
 const end=frame(trip,t+1500);
 assert.deepEqual(end.position,{x:5,y:4});
 assert.equal(end.walking,false);
 assert.equal(end.bodyBob,0);
 assert.equal(end.legSwing,0);
 assert.equal(frame(trip,t+25000).walking,false,"stale travelling status must not loop");
});
test("multi-step movement keeps accurate interpolation and stands at final waypoint",()=>{
 const route={...trip,path:[p,{x:5,y:4},{x:5,y:5}],stepIndex:1};
 assert.deepEqual(frame(route,t+2250).position,{x:5,y:4.5});
 assert.equal(frame(route,t+2250).walking,true);
 assert.deepEqual(frame(route,t+3000).position,{x:5,y:5});
 assert.equal(frame(route,t+3000).walking,false);
});
test("paused snapshots freeze their route positions and disable walking",()=>{
 const paused={...trip,status:"paused",pausedAt:new Date(t+750).toISOString()};
 const a=frame(paused,t+1000),b=frame(paused,t+500000);
 assert.equal(a.position.x,4.5);
 assert.deepEqual(a.position,b.position);
 assert.equal(a.walking,false);
 assert.equal(a.legSwing,0);
});
test("completed one-step trip missed by polling can replay once, then finishes cleanly",()=>{
 const done={...trip,status:"idle",stepIndex:1};
 assert.equal(eligibleJourneyReplay(done,t+5000),true);
 assert.equal(eligibleJourneyReplay(done,t+16000),false);
 assert.equal(eligibleJourneyReplay({...done,startedAt:null},t+5000),false);
 const replay={journeyStart:start,playbackStartedAt:t+5000};
 const a=movementFrame({position:{x:5,y:4},journey:done,now:t+5375,replay});
 assert.equal(a.replaying,true);
 assert.equal(a.walking,true);
 assert.equal(a.position.x,4.25);
 const b=movementFrame({position:{x:5,y:4},journey:done,now:t+6500,replay});
 assert.equal(b.replaying,false);
 assert.equal(b.walking,false);
 assert.deepEqual(b.position,{x:5,y:4});
});
test("idle, invalid and sleeping states cannot animate walking",()=>{
 assert.equal(frame({...trip,status:"idle"},t+500).walking,false);
 assert.equal(frame({...trip,startedAt:null},t+500).walking,false);
 assert.equal(movementFrame({position:p,journey:trip,now:t+500,sleeping:true}).walking,false);
});
test("rest appears near bench and expires on the same timeline",()=>{
 const restTime=new Date(t).toISOString();
 const near={x:4,y:12};
 assert.equal(movementFrame({position:near,now:t+100,lastRestedAt:restTime}).seated,true);
 assert.equal(movementFrame({position:near,now:t+60000,lastRestedAt:restTime}).seated,false);
 assert.equal(movementFrame({position:p,now:t+100,lastRestedAt:restTime}).seated,false);
});
test("late travelling snapshots advance the clock before checking if a timer is needed",()=>{
 const renderer=readFileSync(new URL("../app/world/isometric-world.tsx",import.meta.url),"utf8");
 const effect=renderer.slice(renderer.indexOf("const startsAt=journey?.startedAt"),renderer.indexOf("// D1 owns the route"));
 assert.ok(effect.indexOf("setClock(Date.now());")>=0,"A new journey snapshot must cause an immediate frame");
 assert.ok(effect.indexOf("setClock(Date.now());")<effect.indexOf("if(!travelling&&!replaying&&!resting)return;"),"Refresh must happen before short-circuiting expired journeys");
 const arrived=frame(trip,t+2000);
 assert.equal(arrived.walking,false);
 assert.deepEqual(arrived.position,{x:5,y:4});
});
test("reduced motion preserves positional interpolation but disables pose motion",()=>{
 const renderer=readFileSync(new URL("../app/world/isometric-world.tsx",import.meta.url),"utf8");
 assert.match(renderer,/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
 assert.match(renderer,/legSwing=\{reducedMotion\?0:frame\.legSwing\}/);
 assert.match(renderer,/bodyBob=\{reducedMotion\?0:frame\.bodyBob\}/);
 assert.equal(frame(trip,t+375).position.x,4.25);
});
test("walking CSS must not have a free-running animation and the worker retains completion metadata",()=>{
 const css=readFileSync(new URL("../app/world/world.css",import.meta.url),"utf8");
 const renderer=readFileSync(new URL("../app/world/isometric-world.tsx",import.meta.url),"utf8");
 const worker=readFileSync(new URL("../../world-worker/src/journeys.ts",import.meta.url),"utf8");
 assert.doesNotMatch(css,/@keyframes nimo-leg-left|@keyframes nimo-walk-bob/);
 assert.match(renderer,/frame\.legSwing/);
 assert.match(renderer,/const focalPoint = project\(current\)/);
 assert.match(renderer,/eligibleJourneyReplay\(journey,Date\.now\(\)\)/);
 assert.match(worker,/SET status='idle', paused_at=NULL/);
});
