/** Nimo's UK-local day/night rhythm. Manual owner pause remains independent. */
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23",minute:"2-digit",
});
export function londonHour(at:Date):number {
  const part=formatter.formatToParts(at).find(p=>p.type==="hour")?.value;
  const hour=Number(part);
  if(!Number.isInteger(hour))throw Error("Cannot determine UK hour");
  return hour;
}
export function scheduledAsleep(at:Date):boolean {
  const hour=londonHour(at);
  return hour>=22 || hour<6;
}
export const SLEEP_START="22:00";
export const WAKE_TIME="06:00";

/** Only awake time counts toward hunger after an overnight sleep.
 * Iterate minute boundaries so DST transitions are treated in real elapsed time.
 */
export function awakeElapsedSeconds(start:Date,end:Date):number {
  const from=start.getTime(),to=end.getTime();
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return 0;
  let cursor=Math.max(from,to-86_400_000),seconds=0;
  while(cursor<to){
    const next=Math.min(to,Math.floor(cursor/60000)*60000+60000);
    if(!scheduledAsleep(new Date(cursor)))seconds+=(next-cursor)/1000;
    cursor=next;
  }
  return seconds;
}
