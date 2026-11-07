/**
 * Observation-only experience evaluator.
 *
 * Evaluates verified world outcomes, NOT LLM commentary or arbitrary object
 * excitement values. "unknown" is intentional when there is no pre-action
 * expectation or objective. These records never affect needs or action choice.
 */
export type Signal = "none" | "low" | "high" | "unknown";
export type VerifiedOutcome =
  | {type:"inspection";subject:string;comparison:"first"|"changed"|"unchanged";fruitRevealed?:boolean}
  | {type:"eating";subject:string;priorInformativeTrials:number;before:number;after:number;censored:boolean}
  | {type:"picking";subject:string;fruit:string;inventoryBefore:number;inventoryAfter:number}
  | {type:"writing";subject:string;revision:number}
  | {type:"object_note";subject:string;first:boolean}
  | {type:"travel";subject:string;firstVisit:boolean}
  | {type:"failure";subject:string;reason:string};

export type Assessment = {
  action:string;subject:string;
  repetition:Signal;learning:Signal;surprise:Signal;progress:Signal;
  evidence:string;
};
export function evaluateExperience(o:VerifiedOutcome):Assessment {
  const base={action:o.type,subject:o.subject,repetition:"unknown" as Signal,
    learning:"unknown" as Signal,surprise:"unknown" as Signal,progress:"unknown" as Signal};
  switch(o.type) {
    case "inspection":
      return {...base,
        repetition:o.comparison==="unchanged"?"high":"none",
        learning:o.comparison==="unchanged"?"none":"high",
        // Changed does not prove surprise without a recorded prediction.
        surprise:"unknown",
        evidence:`Verified ${o.comparison} inspection of ${o.subject}${o.fruitRevealed?"; fruit observed":""}.`};
    case "eating":{
      const difference=Math.round((o.after-o.before)*100)/100;
      return {...base,repetition:o.priorInformativeTrials>0?"high":"none",
        learning:o.censored?"unknown":o.priorInformativeTrials===0?"high":"low",
        progress:difference<0?"high":"none",
        evidence:`Verified ${o.subject} eating: hunger ${o.before}% -> ${o.after}% (change ${difference} points); ${o.priorInformativeTrials} prior informative trials; ${o.censored?"censored boundary":"uncensored"}.`};
    }
    case "picking":
      return {...base,learning:"none",progress:o.inventoryAfter>o.inventoryBefore?"high":"none",
        evidence:`Picked ${o.fruit} at ${o.subject}; inventory ${o.inventoryBefore} -> ${o.inventoryAfter}. Resource acquisition verified; goal relevance unknown.`};
    case "writing":
      return {...base,repetition:o.revision>1?"high":"none",learning:"unknown",
        evidence:`Saved ${o.subject}, revision ${o.revision}. A document save does not prove learning or goal progress.`};
    case "object_note":
      return {...base,repetition:o.first?"none":"high",learning:"unknown",
        evidence:`Saved ${o.first?"first":"revised"} note for ${o.subject}; note content alone does not establish a discovery.`};
    case "travel":
      return {...base,repetition:o.firstVisit?"none":"high",learning:"unknown",
        progress:"unknown",evidence:`Verified arrival at ${o.subject}; ${o.firstVisit?"first recorded visit":"revisited tile"}. Arrival alone does not establish learning or goal progress.`};
    case "failure":
      return {...base,learning:"unknown",progress:"none",
        evidence:`Verified failure for ${o.subject}: ${o.reason.slice(0,160)}`};
  }
}

export type ExperienceRow=Assessment&{id:number;created_at:string;source_key:string;event_id:number|null};
export async function recordExperience(db:D1Database,sourceKey:string,outcome:VerifiedOutcome,eventId:number|null=null) {
  const v=evaluateExperience(outcome);
  await db.prepare(`INSERT OR IGNORE INTO experience_evaluations
    (source_key,event_id,action,subject,repetition,learning,surprise,progress,evidence)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(sourceKey,eventId,v.action,v.subject,v.repetition,v.learning,v.surprise,v.progress,v.evidence.slice(0,500)).run();
}
export async function recentExperiences(db:D1Database,limit=30):Promise<ExperienceRow[]> {
  const result=await db.prepare(`SELECT id,created_at,source_key,event_id,action,subject,
    repetition,learning,surprise,progress,evidence
    FROM experience_evaluations ORDER BY id DESC LIMIT ?`).bind(Math.max(1,Math.min(100,limit))).all<ExperienceRow>();
  return result.results;
}
