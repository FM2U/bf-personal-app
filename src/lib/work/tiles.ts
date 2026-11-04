/**
 * The status tiles that work like tabs (approved 2026-11-04) on Work on now, Contacts (Follow-ups) and To-dos: one
 * tile per list, each with its number; exactly one tile is selected and the card under them shows only its list.
 * Pure and tested in src/lib/work/tiles.test.ts.
 *  - At the start the first tile with items is selected (Overdue, else Due today, and so on; the first tile when all
 *    are empty).
 *  - When a Filter tick drops the selected tile to 0, the first tile with items is selected.
 *  - Clicking the selected tile does nothing; clicking another selects it.
 *  - On Work on now, while Next actions is ordered By the AI, no tile is selected (the tiles still show their
 *    numbers); clicking a tile goes back to Soonest first with that tile's list.
 */
import type { OrderChoice } from "@/lib/work/lanes";

export type Tile<K extends string> = { key: K; label: string; count: number; /** The red number and dot (Overdue). */ red?: boolean };

/** The first tile with items, or the first tile when every tile is empty. */
export function defaultTile<K extends string>(tiles: readonly Pick<Tile<K>, "key" | "count">[]): K {
  return (tiles.find((t) => t.count > 0) ?? tiles[0]).key;
}

/** After a Filter change: the selected tile stays while it has items; at 0 the first tile with items is selected. */
export function tileAfterFilter<K extends string>(selected: K, tiles: readonly Pick<Tile<K>, "key" | "count">[]): K {
  const t = tiles.find((x) => x.key === selected);
  return t && t.count > 0 ? selected : defaultTile(tiles);
}

/** The tile shown as selected: none while ordered By the AI; the chosen one; otherwise the default. */
export function selectedTile<K extends string>(chosen: K | null, tiles: readonly Pick<Tile<K>, "key" | "count">[], order: OrderChoice = "soonest"): K | null {
  if (order === "ai") return null;
  return chosen ?? defaultTile(tiles);
}

/** A click on a tile: the order goes back to Soonest first and the tile is selected. `changed` is false for a click on the selected tile. */
export function clickTile<K extends string>(state: { order: OrderChoice; selected: K | null }, key: K): { order: OrderChoice; selected: K; changed: boolean } {
  if (state.order === "soonest" && state.selected === key) return { order: "soonest", selected: key, changed: false };
  return { order: "soonest", selected: key, changed: true };
}
