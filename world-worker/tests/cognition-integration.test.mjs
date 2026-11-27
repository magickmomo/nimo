import test from "node:test";
import assert from "node:assert/strict";
import { isolatedWorld, loadWorldWorker } from "../scripts/isolated-world.mjs";

const worker=await loadWorldWorker();
const envFor=DB=>({DB,OPENAI_API_KEY:"mock",MEMORY_CONSOLIDATION_ENABLED:"true"});
const decision=(name,args)=>Response.json({output:[{type:"function_call",name,
  arguments:JSON.stringify({intentDisposition:"keep",...args})}]});
const review=memories=>Response.json({choices:[{message:{content:JSON.stringify({reviewSummary:"Mock review",memories})}}]});

test("verified eating travels through the shared experience, consolidation and recall path",async t=>{
  const {DB,sqlite}=isolatedWorld();
  sqlite.exec(`INSERT INTO world_food_inventory(fruit) VALUES('amber');
    INSERT INTO world_food_memory(fruit,count,informative,mean,minimum_relief,helpful,harmful)
    VALUES('amber',10,10,18,0,0,10);`);
  const requests=[];
  let primary=0, reviews=0;
  t.mock.method(globalThis,"fetch",async (url,init)=>{
    const request=JSON.parse(init.body);
    requests.push(request);
    if(String(url).endsWith("/responses")){
      primary++;
      if(primary===1)return decision("eat_fruit",{fruit:"amber"});
      if(primary===7)return decision("search_memory",{query:"amber fullness"});
      return decision("think",{text:"I am considering what to explore."});
    }
    reviews++;
    const batch=JSON.parse(request.messages[1].content);
    const eaten=batch.experiences.find(e=>e.action==="EAT_OK");
    assert.ok(eaten?.verified);
    return review([{operation:"create",kind:"semantic",subject:"fruit:amber",category:"food",
      statement:"Amber fruit increased my fullness by about 35 points.",confidence:0.65,
      evidenceIds:[eaten.id],contradicts:[]}]);
  });
  const env=envFor(DB);
  for(let i=0;i<6;i++)assert.equal((await worker.tick(env,true)).status,"ok");
  assert.equal(reviews,1);
  const episode=sqlite.prepare("SELECT * FROM episodic_memory WHERE subject='amber'").get();
  const outcome=JSON.parse(episode.outcome_json);
  assert.equal(outcome.fruit,"amber");
  assert.ok(Math.abs(outcome.afterFullness-outcome.beforeFullness-35)<0.01);
  assert.equal(outcome.censored,false);
  assert.equal(sqlite.prepare("SELECT event_id FROM memory_evidence_v2").get().event_id,episode.event_id);
  assert.equal(sqlite.prepare("SELECT count FROM world_food_memory").get().count,10);
  assert.equal(sqlite.prepare("SELECT memory_kind FROM consolidated_memories_v2").get().memory_kind,"semantic");
  assert.equal(await worker.consolidatePersonalExperiences(env),undefined);
  sqlite.exec("UPDATE world SET state=json_set(state,'$.emotions.hunger',0.6) WHERE id=1");
  await worker.tick(env,true);
  assert.match(requests.at(-1).input,/"recentMemories":\[\{"id":1/);
  const hits=await worker.searchHistoricalMemory(DB,"amber fullness");
  assert.ok(hits.some(hit=>hit.source==="episodic"&&hit.id===episode.event_id));
  assert.ok(hits.some(hit=>hit.source==="memory"&&hit.id===1));
  await worker.tick(env,true);
  assert.match(requests.at(-1).input,/"retrieved":/);
  await worker.tick(env,true);
  assert.doesNotMatch(requests.at(-1).input,/"retrieved":/);
  assert.equal(reviews,1);
});

test("concurrent reviews deduplicate and failed reviews retain their cursor",async t=>{
  const {DB,sqlite}=isolatedWorld();
  const env=envFor(DB);
  const write=sqlite.prepare("INSERT INTO events(kind,action,content) VALUES(?,?,?)");
  const addBatch=()=>{
    for(let i=0;i<6;i++)write.run("tool","SELL_ITEM_OK","Verified sale for coins");
  };
  addBatch();
  let fail=true, calls=0;
  t.mock.method(globalThis,"fetch",async (_url,init)=>{
    calls++;
    if(fail)return Response.json({}, {status:503});
    const {experiences}=JSON.parse(JSON.parse(init.body).messages[1].content);
    const id=experiences[0].id;
    return review([{operation:"update",kind:"semantic",subject:"store:sale",category:"experience",
      statement:calls===2?"A sale earned coins on this visit.":"A sale depends on the item offered.",
      confidence:0.55,evidenceIds:[id],contradicts:calls===2?[]:[id]}]);
  });
  const cursor=()=>sqlite.prepare("SELECT last_event_id FROM personal_memory_cursor").get().last_event_id;
  const before=cursor();
  await assert.rejects(worker.consolidatePersonalExperiences(env),/HTTP 503/);
  assert.equal(cursor(),before);
  fail=false;
  await Promise.all([worker.consolidatePersonalExperiences(env),worker.consolidatePersonalExperiences(env)]);
  assert.equal(calls,2);
  assert.ok(cursor()>before);
  addBatch();
  await worker.consolidatePersonalExperiences(env);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM consolidated_memories_v2").get().n,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM memory_evidence_v2 WHERE relationship='contradicts_prior'").get().n,1);
});

test("journey distinguishes invalid and blocked coordinates and resumes to an accessible object tile",async t=>{
  const {DB,sqlite}=isolatedWorld();
  const now=new Date();
  const from={x:4,y:4};
  assert.throws(()=>worker.travelDestination(0,1),/invalid_coordinates/);
  assert.throws(()=>worker.travelDestination(17,1),/invalid_coordinates/);
  assert.deepEqual(worker.travelDestination(1,16),{x:0,y:15});
  await assert.rejects(worker.beginJourney(DB,from,{x:-1,y:0}),/invalid_coordinates/);
  await assert.rejects(worker.beginJourney(DB,from,{x:1,y:1}),/blocked_destination/);
  await assert.rejects(worker.beginJourney(DB,from,{x:1,y:1}),/blocked_destination/);
  await assert.rejects(worker.beginJourney(DB,from,from),/already_at_destination/);
  await assert.rejects(worker.beginJourney(DB,{x:1,y:1},from),/unreachable_destination/);
  const adjacent=await worker.beginJourney(DB,from,{x:4,y:3},now);
  assert.equal(adjacent.length,2);
  await assert.rejects(worker.beginJourney(DB,from,{x:3,y:4}),/conflicting_journey_state/);
  const after=ms=>new Date(+now+ms);
  assert.equal((await worker.advanceJourney(DB,after(1500))).status,"completed");
  const route=await worker.beginJourney(DB,{x:4,y:3},{x:1,y:2},after(1500));
  assert.ok(route.length>2);
  await worker.pauseJourney(DB,after(3000));
  assert.equal((await worker.advanceJourney(DB,after(8000))).status,"paused");
  await worker.resumeJourney(DB,after(8000));
  assert.equal((await worker.advanceJourney(DB,after(30000))).status,"completed");
  assert.deepEqual({...sqlite.prepare("SELECT x,y FROM world_position").get()},{x:1,y:2});
  t.mock.method(globalThis,"fetch",async()=>decision("inspect",{direction:"north"}));
  assert.match((await worker.tick(envFor(DB),true)).toolOutcome,/INSPECT OK: tree_001/);
});
