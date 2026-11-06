/** Nimo 007 isolated in-browser hunger world, no D1 or production imports. */
export const SIZE007=9;
export const FRUITS007=["amber","blue","red"] as const;
export type Fruit007=typeof FRUITS007[number];
export type Direction007="north"|"south"|"east"|"west";
export type Tree007={id:string;x:number;y:number;fruit:Fruit007;readyAt:number};
export type Effects007=Record<Fruit007,number>;
export type Learning007={count:number;uncensored:number;mean:number|null;minimumRelief:number;helpful:number;harmful:number};
export type Action007={type:"move";direction:Direction007}|{type:"inspect"|"pick";treeId:string}|{type:"eat"|"wait"};
export type Event007={step:number;action:Action007;source:"local"|"llm"|"manual";reason:string;before:number;after:number;effect:number|null;result:string};
export type State007={x:number;y:number;hunger:number;seconds:number;step:number;inventory:Fruit007|null;
 trees:Tree007[];inspected:string[];learning:Partial<Record<Fruit007,Learning007>>;events:Event007[]};
const round=(n:number)=>Math.round(n*100)/100;
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const trees:Tree007[]=[
  {id:"tree_a",x:2,y:2,fruit:"amber",readyAt:0},
  {id:"tree_b",x:6,y:2,fruit:"blue",readyAt:0},
  {id:"tree_c",x:2,y:6,fruit:"red",readyAt:0},
  {id:"tree_d",x:6,y:6,fruit:"amber",readyAt:0},
  {id:"tree_e",x:4,y:1,fruit:"blue",readyAt:0},
];
export function effects007(seed:number):Effects007{
  const cases=[[-35,0,18],[-35,18,0],[0,-35,18],[0,18,-35],[18,-35,0],[18,0,-35]];
  const v=cases[Math.abs(Math.trunc(seed))%6];
  return {amber:v[0],blue:v[1],red:v[2]};
}
export function initial007():State007{
  return {x:4,y:4,hunger:38,seconds:0,step:0,inventory:null,
    trees:trees.map(t=>({...t})),inspected:[],learning:{},events:[]};
}
export const distance007=(x:number,y:number,t:{x:number;y:number})=>Math.abs(x-t.x)+Math.abs(y-t.y);
const moved=(x:number,y:number,d:Direction007)=>d==="north"?{x,y:y-1}:
  d==="south"?{x,y:y+1}:d==="west"?{x:x-1,y}:{x:x+1,y};
export const key007=(a:Action007)=>a.type==="move"?"move:"+a.direction:
  a.type==="inspect"||a.type==="pick"?a.type+":"+a.treeId:a.type;
export function actions007(s:State007):Action007[]{
  const out:Action007[]=[];
  for(const direction of ["north","south","east","west"] as const){
    const p=moved(s.x,s.y,direction);
    if(p.x>=0&&p.y>=0&&p.x<SIZE007&&p.y<SIZE007&&!s.trees.some(t=>t.x===p.x&&t.y===p.y))
      out.push({type:"move",direction});
  }
  for(const t of s.trees){
    if(distance007(s.x,s.y,t)!==1)continue;
    if(!s.inspected.includes(t.id))out.push({type:"inspect",treeId:t.id});
    if(s.inspected.includes(t.id)&&s.inventory===null&&t.readyAt<=s.seconds)
      out.push({type:"pick",treeId:t.id});
  }
  if(s.inventory!==null)out.push({type:"eat"});
  out.push({type:"wait"});
  return out;
}
export function view007(s:State007){
  return {position:{x:s.x,y:s.y},hunger:s.hunger,seconds:s.seconds,inventory:s.inventory,
    trees:s.trees.map(t=>({id:t.id,x:t.x,y:t.y,fruit:s.inspected.includes(t.id)?t.fruit:null,
      ready:t.readyAt<=s.seconds})),learning:structuredClone(s.learning),availableActions:actions007(s)};
}
export function apply007(s:State007,a:Action007,effects:Effects007,rate=2,
  source:Event007["source"]="local",reason=""):State007{
  if(!Number.isFinite(rate)||rate<0||rate>10)throw Error("Invalid hunger rate");
  if(!actions007(s).some(opt=>key007(opt)===key007(a)))throw Error("Unavailable action");
  const before=s.hunger;
  const next:State007={...s,step:s.step+1,seconds:s.seconds+1,trees:s.trees.map(t=>({...t})),
    inspected:[...s.inspected],learning:structuredClone(s.learning),events:[...s.events]};
  let effect=0;let fruitEffect:number|null=null;let result="";
  if(a.type==="move"){
    const p=moved(s.x,s.y,a.direction);
    next.x=p.x;next.y=p.y;result="Moved "+a.direction+".";
  }else if(a.type==="inspect"){
    const tree=next.trees.find(t=>t.id===a.treeId)!;
    next.inspected.push(tree.id);
    result="Inspected "+tree.id+": it has "+tree.fruit+" fruit. Eating effect is unknown.";
  }else if(a.type==="pick"){
    const tree=next.trees.find(t=>t.id===a.treeId)!;
    next.inventory=tree.fruit;tree.readyAt=next.seconds+9;
    result="Picked one "+tree.fruit+" fruit from "+tree.id+".";
  }else if(a.type==="eat"){
    const fruit=s.inventory!;
    effect=effects[fruit];fruitEffect=effect;next.inventory=null;
    const old=next.learning[fruit];
    const after=round(clamp(before+rate+effect));
    // Only the before/after readings and the public time cost may inform learning.
    // At 100%, the time increase itself is clipped. Subtracting it from the
    // observed 0-point change would falsely suggest that fruit relieved hunger.
    const withoutFruit=round(clamp(before+rate));
    const difference=round(after-withoutFruit);
    const censored=after===0||after===100;
    const uncensored=(old?.uncensored??0)+(censored?0:1);
    const observed=round(after-before-rate);
    next.learning[fruit]={
      count:(old?.count??0)+1,uncensored,
      mean:censored?old?.mean??null:round(((old?.mean??0)*(old?.uncensored??0)+observed)/uncensored),
      // This is a conservative observed lower bound, never hidden fruit truth.
      minimumRelief:Math.max(old?.minimumRelief??0,Math.max(0,-difference)),
      // An unchanged reading at a clamp boundary proves neither sign.
      helpful:(old?.helpful??0)+(difference<0?1:0),
      harmful:(old?.harmful??0)+(difference>0?1:0),
    };
    result="Ate "+fruit+" fruit: hunger changed "+round(rate+effect)+" points including time.";
  }else result="Waited one simulated second.";
  next.hunger=round(clamp(before+rate+effect));
  next.events.push({step:next.step,action:a,source,reason,before,after:next.hunger,effect:fruitEffect,result});
  return next;
}
/** Shortest-path first movement to a tile adjacent to the target tree. */
export function route007(s:State007,target:Tree007):Direction007|null{
  const q:{x:number;y:number;first:Direction007|null}[]=[{x:s.x,y:s.y,first:null}];
  const seen=new Set([s.x+","+s.y]);
  while(q.length){
    const p=q.shift()!;
    if(distance007(p.x,p.y,target)===1)return p.first;
    for(const d of ["north","south","east","west"] as const){
      const n=moved(p.x,p.y,d),key=n.x+","+n.y;
      if(n.x<0||n.y<0||n.x>=SIZE007||n.y>=SIZE007||seen.has(key)||
        s.trees.some(t=>t.x===n.x&&t.y===n.y))continue;
      seen.add(key);q.push({...n,first:p.first??d});
    }
  }
  return null;
}
/** Free baseline: learns from observations, never reads the hidden effects. */
export function localDecision007(s:State007):{action:Action007;reason:string}{
  const legal=actions007(s),can=(a:Action007)=>legal.some(b=>key007(a)===key007(b));
  if(s.inventory!==null)return {action:{type:"eat"},reason:"Test or use the carried fruit and record its consequence."};
  function approach(trees:Tree007[],reason:string):{action:Action007;reason:string}|null{
    const sorted=[...trees].sort((a,b)=>distance007(s.x,s.y,a)-distance007(s.x,s.y,b)||a.id.localeCompare(b.id));
    for(const t of sorted){
      const inspect:Action007={type:"inspect",treeId:t.id};
      if(can(inspect))return {action:inspect,reason:"Identify fruit on "+t.id+"."};
      const pick:Action007={type:"pick",treeId:t.id};
      if(can(pick))return {action:pick,reason};
      const dir=route007(s,t);
      if(dir&&can({type:"move",direction:dir}))return {action:{type:"move",direction:dir},reason:"Travel to "+t.id+": "+reason};
    }
    return null;
  }
  const ready=s.trees.filter(t=>t.readyAt<=s.seconds);
  // Uninspected trees have UNKNOWN fruit. The policy must not use the
  // environment's hidden fruit identity until an inspect action reveals it.
  const known=(t:Tree007)=>s.inspected.includes(t.id)?s.learning[t.fruit]:undefined;
  const good=ready.filter(t=>(known(t)?.mean??0)<0);
  const novel=ready.filter(t=>!known(t)?.count);
  // The only objective is low hunger: seek safe relief when hungry,
  // otherwise experiment with previously untested fruit.
  const targets=s.hunger>=50&&good.length?good:novel;
  return approach(targets,"Learn or reduce hunger.")||
    approach(good,"Return to a reliably beneficial fruit.")||
    {action:{type:"wait"},reason:"Wait for fruit to regrow."};
}
