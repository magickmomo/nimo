import type {PendingIntent} from "../../web/lib/world";

/** A reply never executes an action. Only Nimo's explicit acceptance creates a
 * persisted intention; successful subsequent tools or his own decision can
 * resolve it. Visitor messages are not commands.
 */
export function nextVisitorIntent(
 previous:PendingIntent|null|undefined,
 sourceEventId:number|null,
 acceptedText:string|null,
 disposition:"keep"|"complete"|"abandon",
 verifiedAction:boolean,
 now:string,
):PendingIntent|null {
 if(disposition==="abandon")return null;
 if(sourceEventId!==null && acceptedText?.trim())
   return {text:acceptedText.trim().slice(0,250),sourceEventId,acceptedAt:now};
 if(sourceEventId===null && disposition==="complete" && verifiedAction)return null;
 return previous??null;
}
