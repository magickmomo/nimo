import {readFileSync} from "node:fs";
const path=new URL("../wrangler.world-004.toml",import.meta.url);
const config=readFileSync(path,"utf8");
const assert=(ok,message)=>{if(!ok){console.error("Unsafe World 004 config: "+message);process.exitCode=1;}};
assert(/^name = "nimo-world-004"$/m.test(config),"expected dedicated Worker name");
assert(/database_name = "nimo-world-004"/.test(config),"expected separate D1 database");
assert(/bucket_name = "nimo-world-004-archives"/.test(config),"expected separate archive bucket");
assert(!config.includes("adf7b04a-0a03-40b7-8389-b02d7339a31f"),"production D1 ID is forbidden");
assert(!config.includes('bucket_name = "nimo-daily-archives"'),"production R2 bucket is forbidden");
assert(/WORLD_004_MODE = "strategy-e"/.test(config),"World 004 strategy must be explicit");
const state=config.match(/^WORLD_004_ENABLED = "(true|false)"$/m)?.[1];
assert(!!state,"canary enable flag must be true or false");
const id=config.match(/database_id = "([^"]+)"/)?.[1];
assert(id!==undefined&&/^[0-9a-f-]{36}$/.test(id),"database UUID must be valid");
assert(id!=="00000000-0000-0000-0000-000000000000","replace placeholder D1 UUID before deploy");
const cap=Number(config.match(/^WORLD_004_MAX_DAILY_DECISIONS = "(\\d+)"$/m)?.[1]);
assert(Number.isSafeInteger(cap)&&cap>0&&cap<=1000,"invalid cap");
const hasCron=/^crons\\s*=\\s*\\["\\* \\* \\* \\* \\*"\\]$/m.test(config);
if(state==="false")assert(!/^crons\\s*=/m.test(config),"no cron before data bootstrap and approval");
if(state==="true"){
 const begin=Date.parse(config.match(/^WORLD_004_START_AT = "([^"]+)"$/m)?.[1]??"");
 const stop=Date.parse(config.match(/^WORLD_004_STOP_AT = "([^"]+)"$/m)?.[1]??"");
 assert(Number.isFinite(begin)&&Number.isFinite(stop)&&begin<=Date.now()&&stop>Date.now()&&stop-begin<=86400000,"active run needs a valid current 24h window");
 assert(hasCron,"active World 004 must have a minute cron");
}
if(!process.exitCode)console.log("World 004 isolated deployment configuration is safe.");
