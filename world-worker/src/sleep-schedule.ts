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
