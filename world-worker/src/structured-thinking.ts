const purposes = ["planning","evaluation","problem_solving","curiosity","reflection"] as const;
export type StructuredThought = {
  purpose:typeof purposes[number];
  assessment:string;
  nextStep:string|null;
  evidenceEventIds:number[];
};

export const thoughtFields = {
  purpose:{type:"string",enum:purposes},
  assessment:{type:"string",description:"Brief assessment of what is known, uncertain, or changed (1–500 characters)."},
  nextStep:{type:["string","null"],description:"Optional suggestion (1–200 characters), with no commitment."},
  evidenceEventIds:{type:"array",items:{type:"integer"},description:"Up to four distinct verified recent outcome event IDs, or []."},
};

export function validateThought(args:Record<string,unknown>, eligibleIds:ReadonlySet<number>):StructuredThought {
  const {purpose,assessment,nextStep,evidenceEventIds,intentDisposition}=args;
  if(Object.keys(args).length!==5 || !purposes.includes(purpose as StructuredThought["purpose"]) ||
     (intentDisposition!=="keep"&&intentDisposition!=="abandon"))throw Error("Invalid THINK fields");
  const checkedText=(value:unknown,max:number)=>{
    if(typeof value!=="string" || !value.trim() || value.trim().length>max)throw Error("Invalid THINK text");
    return value.trim();
  };
  if(!Array.isArray(evidenceEventIds)||evidenceEventIds.length>4||
     new Set(evidenceEventIds).size!==evidenceEventIds.length||
     !evidenceEventIds.every(id=>Number.isSafeInteger(id)&&id>0&&eligibleIds.has(id))){
    throw Error("THINK must cite distinct verified outcome IDs from the submitted request");
  }
  return {purpose:purpose as StructuredThought["purpose"],assessment:checkedText(assessment,500),
    nextStep:nextStep===null?null:checkedText(nextStep,200),evidenceEventIds};
}
