import { backup } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { isolatedWorld, loadWorldWorker } from "./isolated-world.mjs";

const mode=process.argv[2];
const output=process.argv[3];
assert.ok(["profile","paid"].includes(mode)&&output);
const paid=mode==="paid";
assert.ok(!paid||process.env.OPENAI_API_KEY,"Missing API key");
const {DB,sqlite}=isolatedWorld();
const {tick,researchOracleQuestion}=await loadWorldWorker();
sqlite.exec(`DROP TRIGGER nimo_oracle_charge_on_insert; DROP TRIGGER nimo_oracle_daily_limit; CREATE TRIGGER experiment_oracle_limit BEFORE INSERT ON oracle_queries WHEN (SELECT COUNT(*) FROM oracle_queries)>=3 BEGIN SELECT RAISE(ABORT,'Three questions per run'); END;`);
const env={DB,OPENAI_API_KEY:paid?process.env.OPENAI_API_KEY:"offline-no-key",
  EXPERIMENT_ACCESS:"true",OPENAI_MODEL:"gpt-6-luna",MEMORY_CONSOLIDATION_ENABLED:"true",STRUCTURED_THINKING:"true",INTENTION_PROGRESS:"true"};
const calls=[];
const telemetry=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
  const request=JSON.parse(init?.body??'{}');
  if(!paid){
    calls.push({request});
    return Response.json({output:[{type:"function_call",name:"think",
      arguments:JSON.stringify({purpose:"reflection",assessment:"I can see grass around me.",nextStep:null,evidenceEventIds:[],intentDisposition:"keep"})}]});
  }
  assert.ok(String(url).startsWith("https://api.openai.com/v1/"),"Unexpected outbound request");
  const response=await originalFetch(url,init);
  const body=await response.clone().json().catch(()=>null);
  calls.push({endpoint:new URL(url).pathname,model:request.model,status:response.status,usage:body?.usage,responseStatus:body?.status,outputTypes:body?.output?.map(item=>item.type),functionNames:body?.output?.filter(item=>item.type==="function_call").map(item=>item.name),errorCode:body?.error?.code});
  return response;
};
const originalLog=console.log;
console.log=(tag,data,...extra)=>{
  if(typeof tag==="string" && tag.startsWith("NIMO_")){
    telemetry.push({tag,data:JSON.parse(data)});
  } else originalLog(tag,data,...extra);
};
const traces=()=>sqlite.prepare("SELECT * FROM action_trace ORDER BY id").all();
const rows=table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
const initial={world:rows("world"),position:rows("world_position"),foodTrees:rows("world_food_trees"),
  settings:rows("world_settings"),events:rows("events"),vending:rows("vending_state"),
  acquiredMemoryCount:rows("consolidated_memories_v2").length,physicalWorld:"fresh schema and migrations",
  oracle:"Three free questions per run; research resolved before the next decision."};
mkdirSync(output,{recursive:true});
const attempts=[];
let successful=0, errors=0, consecutiveErrors=0;
try {
  const target=paid?200:1;
  while(successful<target){
    const result=await tick(env,true);
    if(result.status==="action_in_progress"){
      await setTimeout(750);
      continue;
    }
    assert.ok(["ok","model_error"].includes(result.status),JSON.stringify(result));
    attempts.push(result);
    if(result.status==="ok"){successful++;consecutiveErrors=0;}else{errors++;consecutiveErrors++;}
    originalLog(`${successful}/${target} successful; ${attempts.length} attempts; ${errors} errors; ${result.status}`);
    if(paid){
      const pending=()=>sqlite.prepare("SELECT COUNT(*) AS n FROM oracle_queries WHERE status IN ('pending','researching')").get().n;
      const deadline=Date.now()+10*60_000;
      while(pending()&&Date.now()<deadline){await researchOracleQuestion(env);if(pending())await setTimeout(3000);}
      assert.equal(pending(),0,'Oracle research did not resolve within deadline');
    }
    if(result.status==="model_error" && (!paid || consecutiveErrors>=3 || errors>=10))throw Error("Model error budget reached; partial results preserved.");
  }
  if(paid){
    // Finish the last physical journey without making a 201st decision.
    const {advanceJourney}=await loadWorldWorker();
    while((await advanceJourney(DB,new Date(),true)).status==="travelling")await setTimeout(750);
    // Consolidation is observed, not required for success.
  }
} finally {
  const final={successful,errors,consecutiveErrors,attempts,calls,telemetry,traces:traces(),events:rows("events"),
    oracle:rows("oracle_queries"),episodes:rows("episodic_memory"),memories:rows("consolidated_memories_v2"),evidence:rows("memory_evidence_v2")};
  if(paid)await backup(sqlite,`${output}/final-world.sqlite`);
  writeFileSync(`${output}/${mode}.json`,JSON.stringify({initial,...final},null,2));
}
