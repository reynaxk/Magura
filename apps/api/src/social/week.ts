/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  return new Date(x.getTime() - dow * 86_400_000);
}
