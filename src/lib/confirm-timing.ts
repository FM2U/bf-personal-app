/**
 * How long a row's one-line confirmation stays before the row leaves or updates (Bram, 2026-11-07: 50% longer than
 * before). CONFIRM_MS after Pass, Interested, Done, Later and the like (was 1.5 to 1.6 s); CONFIRM_SHORT_MS after a
 * ticked to-do or a logged call (was 1.2 s).
 */
export const CONFIRM_MS = 2400;
export const CONFIRM_SHORT_MS = 1800;
