import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {isolatedWorld} from "../scripts/isolated-world.mjs";

test("HTTP-200 rejected function calls keep the private diagnostic and stop after the first attempt",t=>{
  const dir=mkdtempSync(join(tmpdir(),"nimo-snapshot-failure-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const {sqlite}=isolatedWorld();
  const database=join(dir,"fixture.sqlite"), snapshot=join(dir,"fixture.sql");
  sqlite.prepare("VACUUM INTO ?").run(database);
  sqlite.close();
  const dump=spawnSync("python3",["-c",
    "import sqlite3,sys; from pathlib import Path; Path(sys.argv[2]).write_text('\\n'.join(sqlite3.connect(sys.argv[1]).iterdump()))",
    database,snapshot],{encoding:"utf8"});
  assert.ifError(dump.error);
  assert.equal(dump.status,0,dump.stderr);

  const args=JSON.stringify({operation:"set",goal:"private-sentinel-goal",reason:"Private reasoning",evidenceEventIds:[99999]});
  const mock=`
    globalThis.fetch=async (url)=>{
      if(String(url)!=="https://api.openai.com/v1/responses")throw Error("Unexpected request");
      return Response.json({status:"completed",output:[
        {type:"reasoning",content:"exclude-reasoning-sentinel"},
        {type:"function_call",name:"update_intention",arguments:${JSON.stringify(args)}}
      ],usage:{input_tokens:100,output_tokens:20}});
    };
  `;
  const output=join(dir,"results.json"), evidence=join(dir,"evidence.json");
  const runner=fileURLToPath(new URL("../scripts/snapshot-experiment.mjs",import.meta.url));
  const run=spawnSync(process.execPath,["--import",`data:text/javascript,${encodeURIComponent(mock)}`,
    runner,snapshot,output,new Date().toISOString(),evidence],{
    env:{...process.env,OPENAI_API_KEY:"mock-key",STRUCTURED_THINKING:"true",INTENTION_PROGRESS:"true"},
    encoding:"utf8",
  });
  assert.ifError(run.error);
  assert.equal(run.status,1,run.stderr);
  const publicText=readFileSync(output,"utf8");
  const results=JSON.parse(publicText);
  assert.deepEqual(results.attempts,["model_error"]);
  assert.equal(results.finished,false);
  assert.equal(results.calls.length,1);
  assert.equal(results.calls[0].status,200);
  assert.ok(results.failedDecision.traceId>0);
  const privateText=readFileSync(evidence,"utf8");
  const failure=JSON.parse(privateText).find(row=>row.kind==="decision-failure");
  assert.equal(failure.ordinal,1);
  assert.equal(failure.traceId,results.failedDecision.traceId);
  assert.deepEqual(failure.response.functionCalls,[{name:"update_intention",args}]);
  assert.match(failure.diagnostic,/Intention evidence must cite verified request outcomes/);
  assert.doesNotMatch(privateText,/mock-key|exclude-reasoning-sentinel/);
  assert.doesNotMatch(publicText+run.stdout+run.stderr,/private-sentinel-goal|Intention evidence/);
});
