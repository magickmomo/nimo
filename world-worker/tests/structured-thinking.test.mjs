import assert from "node:assert/strict";
import {test} from "node:test";
import {isolatedWorld,loadWorldWorker} from "../scripts/isolated-world.mjs";

const args={purpose:"evaluation",assessment:"The observed fruit was picked.",nextStep:"Inspect the terrain.",evidenceEventIds:[2],intentDisposition:"keep"};
const response=(name,args)=>Response.json({output:[{type:"function_call",name,arguments:JSON.stringify(args)}]});
const context=request=>JSON.parse(request.input.split("\n\n",3)[1]);
const env=DB=>({DB,OPENAI_API_KEY:"offline",STRUCTURED_THINKING:"true"});

test("candidate changes only THINK in a matched first payload and keeps legacy text",async t=>{
  const {tick}=await loadWorldWorker();
  const payloads=[];
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    payloads.push(JSON.parse(init.body));
    return response("observe",{text:"Observe",intentDisposition:"keep"});
  });
  for(const enabled of [false,true]){
    const {DB,sqlite}=isolatedWorld();
    sqlite.exec(`UPDATE events SET created_at='2026-11-27T08:00:00Z';
      INSERT INTO events(id,created_at,kind,content,action)
      VALUES(2,'2026-11-27T08:00:00Z','thought','Legacy thought','THINK')`);
    assert.equal((await tick({...env(DB),STRUCTURED_THINKING:String(enabled)},true)).status,"ok");
  }
  const [control,candidate]=payloads;
  assert.deepEqual(context(control),context(candidate));
  assert.deepEqual(context(candidate).latestThinking,{id:2,text:"Legacy thought"});
  assert.deepEqual(control.tools.filter(tool=>tool.name!=="think"),candidate.tools.filter(tool=>tool.name!=="think"));
  const {input:_control,tools:_controlTools,...controlSettings}=control;
  const {input:_candidate,tools:_candidateTools,...candidateSettings}=candidate;
  assert.deepEqual(controlSettings,candidateSettings);
});

test("valid thought cites the sent request, persists, and appears after restart as advisory",async t=>{
  const {DB,sqlite}=isolatedWorld();
  const record=sqlite.prepare("INSERT INTO events(kind,content,action) VALUES(?,?,?)");
  record.run("tool","Picked a fruit.","PICK_OK");
  const first=await loadWorldWorker(), restarted=await loadWorldWorker();
  let calls=0;
  const inputs=[];
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    inputs.push(context(JSON.parse(init.body)));
    if(++calls===1){
      for(let i=0;i<5;i++)record.run("thought","Concurrent note","OBSERVE");
      return response("think",args);
    }
    return response("write_journal",{text:"A later journal entry.",intentDisposition:"keep"});
  });
  assert.equal((await first.tick(env(DB),true)).action,"THINK");
  const saved=sqlite.prepare("SELECT e.id,e.content,t.thought_json FROM events e JOIN structured_thoughts t ON t.event_id=e.id").get();
  assert.equal(saved.content,args.assessment);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM events WHERE action='INSPECT_OK'").get().n,0);
  assert.equal((await restarted.tick(env(DB),true)).action,"WRITE_JOURNAL");
  assert.deepEqual(inputs[1].latestThinking,{id:saved.id,...JSON.parse(saved.thought_json)});
  await restarted.tick(env(DB),true);
  assert.deepEqual(inputs[2].latestThinking.text,"A later journal entry.");
  assert.equal(calls,3);
});

test("invalid, duplicate, unverified and off-request evidence use existing model-error handling",async t=>{
  const {tick}=await loadWorldWorker();
  let supplied, calls=0;
  t.mock.method(globalThis,"fetch",async ()=>{
    calls++;
    return response("think",supplied);
  });
  const cases=[
    {evidenceEventIds:[2]}, {evidenceEventIds:[3,3]}, {evidenceEventIds:[999]},
    {assessment:"x".repeat(501)}, {nextStep:"x".repeat(201)}, {purpose:"invented"},
    {evidenceEventIds:[1]}, {goal:"Can the schema revise goals?"},
  ];
  for(const change of cases){
    const {DB,sqlite}=isolatedWorld();
    sqlite.exec(`INSERT INTO events(kind,content,action) VALUES('thought','Unverified thought','THINK'),('tool','A verified outcome','PICK_OK')`);
    supplied={...args,evidenceEventIds:[3],...change};
    assert.equal((await tick(env(DB),true)).status,"model_error");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM structured_thoughts").get().n,0);
  }
  const {DB,sqlite}=isolatedWorld();
  sqlite.exec(`INSERT INTO events(kind,content,action) VALUES('tool','Old outcome','PICK_OK');
    INSERT INTO events(kind,content,action) VALUES('thought','Newer','OBSERVE'),('thought','Newer','OBSERVE'),('thought','Newer','OBSERVE'),('thought','Newer','OBSERVE')`);
  supplied=args;
  assert.equal((await tick(env(DB),true)).status,"model_error");
  for(const purpose of ["planning","evaluation","problem_solving","curiosity","reflection"]){
    const {DB}=isolatedWorld();
    supplied={...args,purpose,assessment:"a".repeat(500),nextStep:null,evidenceEventIds:[]};
    assert.equal((await tick(env(DB),true)).action,"THINK");
  }
  assert.equal(calls,cases.length+6);
});
