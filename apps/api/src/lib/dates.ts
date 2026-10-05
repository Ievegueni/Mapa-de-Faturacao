/** "aaaa-mm-dd" → Date (UTC, meia-noite). */
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Date → "aaaa-mm-dd". */
export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
