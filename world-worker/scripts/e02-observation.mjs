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
const {tick}=await loadWorldWorker();
const env={DB,OPENAI_API_KEY:paid?process.env.OPENAI_API_KEY:"offline-no-key",
  OPENAI_MODEL:"gpt-6-luna",MEMORY_CONSOLIDATION_ENABLED:"true",STRUCTURED_THINKING:"true",INTENTION_PROGRESS:"true"};
const calls=[];
const telemetry=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
  const request=JSON.parse(init.body);
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
  oracle:"Questions can be queued. Background Oracle research is disabled in this isolated experiment."};
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
    if(result.status==="model_error" && (!paid || consecutiveErrors>=3 || errors>=10))throw Error("Model error budget reached; partial results preserved.");
  }
  if(paid){
    // Finish the last physical journey without making a 201st decision.
    const {advanceJourney}=await loadWorldWorker();
    while((await advanceJourney(DB)).status==="travelling")await setTimeout(750);
    // Consolidation is observed, not required for success.
  }
} finally {
  const final={successful,errors,consecutiveErrors,attempts,calls,telemetry,traces:traces(),events:rows("events"),
    episodes:rows("episodic_memory"),memories:rows("consolidated_memories_v2"),evidence:rows("memory_evidence_v2")};
  writeFileSync(`${output}/${mode}.json`,JSON.stringify({initial,...final},null,2));
}
