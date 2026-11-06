/** Nimo 007 isolated in-browser hunger world, no D1 or production imports. */
export const SIZE007=9;
export const FRUITS007=["amber","blue","red"] as const;
export type Fruit007=typeof FRUITS007[number];
export type Direction007="north"|"south"|"east"|"west";
export type Tree007={id:string;x:number;y:number;fruit:Fruit007;readyAt:number};
export type Effects007=Record<Fruit007,number>;
export type Learning007={count:number;uncensored:number;mean:number|null;minimumRelief:number;helpful:number;harmful:number};
export type Action007={type:"move";direction:Direction007}|{type:"inspect"|"pick";treeId:string}|{type:"eat"|"wait"|"discard"};
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
  if(s.inventory!==null)out.push({type:"eat"},{type:"discard"});
  out.push({type:"wait"});
  return out;
}
export function view007(s:State007){
  return {position:{x:s.x,y:s.y},hunger:s.hunger,seconds:s.seconds,inventory:s.inventory,
    trees:s.trees.map(t=>({id:t.id,x:t.x,y:t.y,fruit:s.inspected.includes(t.id)?t.fruit:null,
      ready:t.readyAt<=s.seconds,readyIn:Math.max(0,t.readyAt-s.seconds)})),
    learning:structuredClone(s.learning),availableActions:actions007(s)};
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
    result="Ate "+fruit+" fruit. Hunger visibly changed from "+before+"% to "+after+"%.";
  }else if(a.type==="discard"){
    result="Discarded carried "+s.inventory+" fruit.";next.inventory=null;
  }else result="Waited one simulated second.";
  next.hunger=round(clamp(before+rate+effect));
  next.events.push({step:next.step,action:a,source,reason,before,after:next.hunger,effect:fruitEffect,result});
  return next;
}
/** Shortest-path first movement to a tile adjacent to the target tree. */
export function routeSteps007(s:State007,target:Tree007):Direction007[]{
  const q:{x:number;y:number;path:Direction007[]}[]=[{x:s.x,y:s.y,path:[]}];
  const seen=new Set([s.x+","+s.y]);
  while(q.length){
    const p=q.shift()!;
    if(distance007(p.x,p.y,target)===1)return p.path;
    for(const d of ["north","south","east","west"] as const){
      const n=moved(p.x,p.y,d),key=n.x+","+n.y;
      if(n.x<0||n.y<0||n.x>=SIZE007||n.y>=SIZE007||seen.has(key)||
        s.trees.some(t=>t.x===n.x&&t.y===n.y))continue;
      seen.add(key);q.push({...n,path:[...p.path,d]});
    }
  }
  return [];
}
export function route007(s:State007,target:Tree007):Direction007|null{
  return routeSteps007(s,target)[0]??null;
}
/** Free baseline planner: prioritise survival, avoid waste and minimise travel.
 * Decisions use only inspected tree identities and observed effects, never the hidden map.
 * The simulator's clock advances once for each action, including waiting.
 */
export function localDecision007(s:State007,rate=2):{action:Action007;reason:string}{
  const legal=actions007(s);
  const can=(a:Action007)=>legal.some(b=>key007(a)===key007(b));
  const wait=(reason:string)=>({action:{type:"wait"} as Action007,reason});
  const observed=(t:Tree007)=>s.inspected.includes(t.id)?s.learning[t.fruit]:undefined;
  const beneficial=(t:Tree007)=> {
    const l=observed(t);
    return l!==undefined&&(l.mean!==null?l.mean<0:l.minimumRelief>0);
  };
  // When an estimate is censored, minimumRelief is the only justified estimate.
  const relief=(fruit:Fruit007)=>{
    const l=s.learning[fruit];
    return l?.mean!==null&&l?.mean!==undefined?
      Math.max(0,-l.mean):l?.minimumRelief??0;
  };
  if(s.inventory!==null){
    const learned=s.learning[s.inventory];
    if((learned?.harmful??0)>0&&relief(s.inventory)===0)
      return {action:{type:"discard"},reason:"Discard fruit with previously observed harmful effects."};
    // Preserve fruit until it would provide its expected benefit. For an
    // untested fruit, leave room for a non-censored reading whenever possible.
    const target=relief(s.inventory)>0?
      Math.max(12,Math.ceil(relief(s.inventory)-rate)):38;
    if(s.hunger<target&&rate>0)
      return wait("Save carried "+s.inventory+" fruit until hunger makes eating worthwhile.");
    return {action:{type:"eat"},reason:learned?
      "Eat using the observed "+s.inventory+" effect.":
      "Try this fruit at an informative hunger level and learn its consequence."};
  }
  // If a known helpful fruit is available, plan for it even if it needs to
  // regrow. Never cross the whole map just because another tree is ripe now.
  const good=s.trees.filter(beneficial);
  if(good.length){
    // Route distance is measured in actual navigable tiles, not just Manhattan distance.
    const ranked=good.map(t=>{
      const path=routeSteps007(s,t);
      const waitForRipe=Math.max(0,t.readyAt-s.seconds);
      // Include travel effort: an adjacent tree regrowing shortly beats a
      // distant ripe tree when both can feed Nimo safely.
      return {t,path,arrival:Math.max(path.length,waitForRipe)+2*path.length};
    }).filter(x=>Number.isFinite(x.arrival))
      .sort((a,b)=>a.arrival-b.arrival||a.path.length-b.path.length||a.t.id.localeCompare(b.t.id));
    if(ranked.length){
      const best=ranked[0];
      if(best.path.length){
        return {action:{type:"move",direction:best.path[0]},
          reason:"Head to "+best.t.id+" for known beneficial fruit; "+best.path.length+" moves remain."};
      }
      if(best.t.readyAt>s.seconds)
        return wait("Stay beside "+best.t.id+" until its beneficial fruit regrows.");
      const pick:Action007={type:"pick",treeId:best.t.id};
      if(can(pick))return {action:pick,reason:"Collect reliable food to save for when hunger increases."};
    }
  }
  // If nothing beneficial is known, gather evidence while hunger remains manageable.
  // Fruit identity is not used for uninspected trees.
  const unknown=s.trees.filter(t=>{
    const learning=observed(t);
    return !learning||(!learning.count&&!learning.minimumRelief);
  }).map(t=>({t,path:routeSteps007(s,t)}))
    .filter(x=>Number.isFinite(x.path.length))
    .sort((a,b)=>a.path.length-b.path.length||a.t.id.localeCompare(b.t.id));
  for(const {t,path} of unknown){
    if(path.length)return {action:{type:"move",direction:path[0]},
      reason:"Explore "+t.id+" to discover which fruit relieves hunger."};
    const inspect:Action007={type:"inspect",treeId:t.id};
    if(can(inspect))return {action:inspect,reason:"Inspect "+t.id+" to identify its fruit."};
    const pick:Action007={type:"pick",treeId:t.id};
    if(can(pick))return {action:pick,reason:"Test an untried fruit to learn its hunger effect."};
    if(t.readyAt>s.seconds)return wait("Wait near an untested tree for its fruit to regrow.");
  }
  return wait("No known beneficial food or unexplored ripe fruit; conserve movement.");
}
