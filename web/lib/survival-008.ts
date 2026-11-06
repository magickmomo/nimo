/** Nimo 008: isolated, seeded hunger simulation. No D1. */
export type Fruit008="amber"|"blue"|"red";
export type Action008={type:"travel";treeId:string}|{type:"inspect";treeId:string}|{type:"pick";treeId:string}|{type:"eat";fruit:Fruit008}|{type:"discard";fruit:Fruit008}|{type:"wait";seconds:1|5|10|20};
export type Tree008={id:string;x:number;y:number;fruit:Fruit008;stock:number;capacity:number;regrowAt:number;seenFruit:Fruit008|null;seenStock:number|null;seenAt:number|null};
export type Memory008={count:number;informative:number;mean:number|null;minimumRelief:number;helpful:number;harmful:number};
export type Event008={step:number;start:number;end:number;action:Action008;reason:string;source:"local"|"llm"|"manual";before:number;after:number;observation:string;trueEffect:number|null};
export type State008={seed:number;x:number;y:number;hunger:number;seconds:number;inventory:Fruit008[];trees:Tree008[];memory:Partial<Record<Fruit008,Memory008>>;events:Event008[]};
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
const round=(v:number)=>Math.round(v*100)/100;
const tiles:[string,number,number,Fruit008][]=[["tree_a",2,2,"amber"],["tree_b",6,2,"blue"],["tree_c",2,6,"red"],["tree_d",6,6,"amber"],["tree_e",4,1,"blue"]];
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const directions=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
function pseudo(seed:number,salt:number){let n=(seed^Math.imul(salt+1,2654435761))>>>0;n^=n>>>16;n=Math.imul(n,2246822507);n^=n>>>13;return(n>>>0)/4294967296}
export function hiddenEffects008(seed:number):Record<Fruit008,number>{
 const perms=[[-35,0,18],[-35,18,0],[0,-35,18],[0,18,-35],[18,-35,0],[18,0,-35]];
 const v=perms[Math.abs(Math.trunc(seed))%6];return{amber:v[0],blue:v[1],red:v[2]};
}
export function initial008(seed=48162):State008{return{seed,x:4,y:4,hunger:38,seconds:0,inventory:[],memory:{},events:[],
 trees:tiles.map(([id,x,y,fruit],i)=>({id,x,y,fruit,stock:2+i%2,capacity:2+i%2,regrowAt:-1,seenFruit:null,seenStock:null,seenAt:null}))};}
function path008(s:State008,t:Tree008){
 const q=[{x:s.x,y:s.y,path:[] as {x:number;y:number}[]}],seen=new Set([s.x+","+s.y]);
 while(q.length){const cur=q.shift()!;if(distance(cur,t)===1)return cur.path;
  for(const d of directions){const x=cur.x+d.x,y=cur.y+d.y,k=x+","+y;
   if(x<0||y<0||x>=9||y>=9||seen.has(k)||s.trees.some(t=>t.x===x&&t.y===y))continue;
   seen.add(k);q.push({x,y,path:[...cur.path,{x,y}]});}}
 return [] as {x:number;y:number}[];
}
export const travelCost008=(s:State008,t:Tree008)=>distance(s,t)===1?0:path008(s,t).length||Infinity;
export const key008=(a:Action008)=>a.type==="wait"?"wait:"+a.seconds:
 a.type==="eat"||a.type==="discard"?a.type+":"+a.fruit:a.type+":"+a.treeId;
export function actions008(s:State008):Action008[]{
 const out:Action008[]=[];
 for(const t of s.trees){if(distance(s,t)>1&&Number.isFinite(travelCost008(s,t)))out.push({type:"travel",treeId:t.id});
  if(distance(s,t)===1){out.push({type:"inspect",treeId:t.id});
   if(t.seenFruit&&t.seenStock!==null&&t.seenStock>0&&s.inventory.length<3)out.push({type:"pick",treeId:t.id});}}
 for(const f of new Set(s.inventory))out.push({type:"eat",fruit:f},{type:"discard",fruit:f});
 for(const seconds of [1,5,10,20] as const)out.push({type:"wait",seconds});
 return out;
}
export function view008(s:State008){return{position:{x:s.x,y:s.y},hunger:s.hunger,seconds:s.seconds,inventory:[...s.inventory],
 trees:s.trees.map(t=>({id:t.id,x:t.x,y:t.y,fruit:t.seenFruit,lastSeenStock:t.seenStock,seenAt:t.seenAt,distance:travelCost008(s,t)})),
 memory:structuredClone(s.memory),availableActions:actions008(s)};}
function nextRegrow(s:State008,t:Tree008,now:number){return now+75+Math.floor(pseudo(s.seed,t.id.charCodeAt(5)*31+now*7)*46)}
function regrow(s:State008){for(const t of s.trees){
 while(t.regrowAt>=0&&t.regrowAt<=s.seconds){const at=t.regrowAt;t.stock=Math.min(t.capacity,t.stock+1);
  t.regrowAt=t.stock<t.capacity?nextRegrow(s,t,at):-1;}}}
export function apply008(s:State008,a:Action008,rate=1,source:Event008["source"]="local",reason=""):State008{
 if(!Number.isFinite(rate)||rate<0||rate>5)throw Error("Invalid hunger rate");
 if(!actions008(s).some(v=>key008(v)===key008(a)))throw Error("Unavailable action");
 const n:State008={...s,inventory:[...s.inventory],trees:s.trees.map(t=>({...t})),memory:structuredClone(s.memory),events:[...s.events]};
 const before=n.hunger,start=n.seconds;let duration=1,effect=0,trueEffect:number|null=null,observation="";
 if(a.type==="travel"){const t=n.trees.find(t=>t.id===a.treeId)!;const route=path008(n,t);
  if(!route.length)throw Error("Tree unreachable");duration=route.length;
  const last=route[route.length-1];n.x=last.x;n.y=last.y;observation="Traveled "+duration+" tiles toward "+t.id+".";
 }else if(a.type==="inspect"){const t=n.trees.find(t=>t.id===a.treeId)!;
  t.seenFruit=t.fruit;t.seenStock=t.stock;t.seenAt=start;observation="Inspected "+t.id+": "+t.fruit+" fruit, "+t.stock+" available.";
 }else if(a.type==="pick"){const t=n.trees.find(t=>t.id===a.treeId)!;
  if(t.stock===0)throw Error("Tree has no fruit; inspect again");
  n.inventory.push(t.fruit);t.stock--;t.seenStock=t.stock;t.seenAt=start;
  if(t.regrowAt<0)t.regrowAt=nextRegrow(n,t,start+1);observation="Picked "+t.fruit+" fruit from "+t.id+".";
 }else if(a.type==="eat"){const i=n.inventory.indexOf(a.fruit);n.inventory.splice(i,1);
  effect=hiddenEffects008(s.seed)[a.fruit];trueEffect=effect;
  const after=round(clamp(before+rate+effect)),without=round(clamp(before+rate));
  const diff=round(after-without),old=n.memory[a.fruit],censored=after===0||after===100;
  const informative=(old?.informative??0)+(censored?0:1),observed=round(after-before-rate);
  n.memory[a.fruit]={count:(old?.count??0)+1,informative,
   mean:censored?old?.mean??null:round(((old?.mean??0)*(old?.informative??0)+observed)/informative),
   minimumRelief:Math.max(old?.minimumRelief??0,-diff,0),
   helpful:(old?.helpful??0)+(diff<0?1:0),harmful:(old?.harmful??0)+(diff>0?1:0)};
  observation="Ate "+a.fruit+" fruit; observed hunger "+before+"% to "+after+"%.";
 }else if(a.type==="discard"){n.inventory.splice(n.inventory.indexOf(a.fruit),1);observation="Discarded "+a.fruit+" fruit.";
 }else{duration=a.seconds;observation="Waited "+duration+" simulated seconds.";}
 n.seconds+=duration;n.hunger=round(clamp(before+rate*duration+effect));regrow(n);
 n.events.push({step:n.events.length+1,start,end:n.seconds,action:a,reason,source,before,after:n.hunger,observation,trueEffect});
 return n;
}
