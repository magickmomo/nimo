import assert from "node:assert/strict";
import {test} from "node:test";
import {isolatedWorld,loadWorldWorker} from "../scripts/isolated-world.mjs";

const payloadContext=request=>JSON.parse(request.input.split("\n\n",3)[1]);
const result=(name,args)=>Response.json({output:[{type:"function_call",name,arguments:JSON.stringify(args)}]});
const env=(DB,enabled=true)=>({DB,OPENAI_API_KEY:"offline",STRUCTURED_THINKING:"true",INTENTION_PROGRESS:String(enabled)});
const update=(operation,goal,reason,evidenceEventIds=[])=>({operation,goal,reason,evidenceEventIds});

test("E02 adds only the progress context and a voluntary tool",async t=>{
  const {tick}=await loadWorldWorker();
  const payloads=[];
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    payloads.push(JSON.parse(init.body));
    return result("think",{purpose:"reflection",assessment:"Look around.",nextStep:null,evidenceEventIds:[],intentDisposition:"keep"});
  });
  for(const enabled of [false,true]){
    const {DB,sqlite}=isolatedWorld();
    sqlite.exec("UPDATE events SET created_at='2026-11-27T08:00:00Z'");
    assert.equal((await tick(env(DB,enabled),true)).action,"THINK");
  }
  const [control,experiment]=payloads;
  const {intentionProgress,...context}=payloadContext(experiment);
  assert.deepEqual(context,payloadContext(control));
  assert.deepEqual(intentionProgress,{goal:null,since:null,lastTransition:null,attempts:[],progressSignals:{}});
  assert.deepEqual(experiment.tools.filter(tool=>tool.name!=="update_intention"),control.tools);
  const {input:_a,tools:_b,...cfg}=control;
  const {input:_c,tools:_d,...candidateCfg}=experiment;
  assert.deepEqual(cfg,candidateCfg);
});

test("tracks pending and arrived journeys, voluntarily revises, completes, and abandons",async t=>{
  const {DB,sqlite}=isolatedWorld();
  const {tick}=await loadWorldWorker();
  let fn="update_intention", args=update("set","Reach a nearby tile","Explore a new position.");
  const contexts=[];
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    contexts.push(payloadContext(JSON.parse(init.body)));
    return result(fn,args);
  });
  const run=()=>tick(env(DB),true);
  assert.equal((await run()).status,"ok");
  fn="travel_to"; args={x:6,y:5,goal:null,intentDisposition:"keep"};
  assert.equal((await run()).status,"ok");
  const getState=()=>JSON.parse(sqlite.prepare("SELECT state FROM world WHERE id=1").get().state);
  assert.equal(getState().intentionProgress.attempts[0].status,"pending");
  sqlite.exec("UPDATE world_journey SET started_at='2026-11-26T08:00:00Z'");
  fn="update_intention";args=update("revise","Explore the adjacent terrain","The previous move established a new location.");
  assert.equal((await run()).status,"ok");
  const observed=contexts.at(-1).intentionProgress.attempts[0];
  assert.equal(observed.status,"observed");
  assert.match(observed.outcome,/arrived at \(6, 5\)/);
  assert.equal(observed.forCurrentIntention,true);
  args=update("complete",null,"Arrival evidence is present.",[999999]);
  assert.equal((await run()).status,"model_error");
  args=update("complete",null,"Arrival evidence is present.",[observed.eventId]);
  assert.equal((await run()).status,"ok");
  assert.equal(contexts.at(-1).intentionProgress.attempts[0].forCurrentIntention,false);
  assert.equal(getState().currentGoal,null);
  args=update("set","Try a different activity","I can choose a direction later.");
  await run();
  args=update("abandon",null,"This aim is no longer wanted.");
  await run();
  assert.equal(getState().currentGoal,null);
  assert.equal(getState().intentionProgress.lastTransition.operation,"abandon");
});

test("recent attempts stay bounded and label failed and unchanged outcomes",async t=>{
  const {DB,sqlite}=isolatedWorld();
  const {tick}=await loadWorldWorker();
  // Start beside an inspectable tree and make one unambiguous failed movement.
  sqlite.exec("UPDATE world_position SET x=4,y=2");
  let fn="travel_to", args={x:5,y:3,goal:"Inspect the same area",intentDisposition:"keep"};
  const inputs=[];
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    inputs.push(payloadContext(JSON.parse(init.body)));
    return result(fn,args);
  });
  const run=()=>tick(env(DB),true);
  assert.equal((await run()).status,"ok");
  fn="inspect";args={direction:"north",goal:null,intentDisposition:"keep"};
  for(let i=0;i<7;i++)assert.equal((await run()).status,"ok");
  assert.equal(inputs[1].intentionProgress.attempts[0].status,"failed");
  const view=inputs.at(-1).intentionProgress;
  assert.equal(view.attempts.length,5);
  assert.equal(view.progressSignals.unchanged,5);
  assert.ok(view.attempts.every(a=>a.eventId>0&&a.forCurrentIntention));
});
