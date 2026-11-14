import {readFileSync} from "node:fs";

const config=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
const section=(name)=>config.match(new RegExp("^\\["+name+"\\]\\s*([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))","m"))?.[1]??"";
const triggers=section("triggers");
const cronMatches=[...triggers.matchAll(/^\s*crons\s*=\s*\[\s*"([^"]+)"\s*\]\s*$/gm)];
if(cronMatches.length!==1||cronMatches[0][1]!=="* * * * *"){
 console.error("Deployment blocked: wrangler.toml must configure [triggers] crons = [\"* * * * *\"].");
 process.exit(1);
}
if(!/^name\s*=\s*"nimo-world"\s*$/m.test(config) ||
   !/^binding\s*=\s*"DB"\s*$/m.test(config) ||
   !/^database_name\s*=\s*"nimo-world"\s*$/m.test(config) ||
   !/^database_id\s*=\s*"[0-9a-fA-F-]{36}"\s*$/m.test(config)){
 console.error("Deployment blocked: verify Worker name and D1 database binding in wrangler.toml.");
 process.exit(1);
}
console.log("Verified Nimo cron and D1 configuration before deployment.");
