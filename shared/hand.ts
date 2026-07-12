import { TILE_TYPES, Tile, countTileValues, countTiles, removeOne, removeOneByValue, sortTiles, tileBase } from "./tiles";

export type Meld = {
  kind: "chi" | "pon" | "kan" | "ankan";
  tiles: Tile[];
  from?: "east" | "west";
};

export type WaitInfo = {
  waits: Tile[];
  isTenpai: boolean;
  isWinning: boolean;
};

function tileToIndex(tile: Tile): number {
  const base = tileBase(tile);
  const suit = base[0];
  const n = Number(base.slice(1)) - 1;
  if (suit === "m") return n;
  if (suit === "p") return 9 + n;
  if (suit === "s") return 18 + n;
  return 27 + n;
}

function canMakeMelds(counts: number[]): boolean {
  let first = counts.findIndex((count) => count > 0);
  if (first === -1) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canMakeMelds(counts)) {
      counts[first] += 3;
      return true;
    }
    counts[first] += 3;
  }
  const suitStart = Math.floor(first / 9) * 9;
  const inNumberSuit = first < 27;
  const position = first - suitStart;
  if (inNumberSuit && position <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first] -= 1;
    counts[first + 1] -= 1;
    counts[first + 2] -= 1;
    if (canMakeMelds(counts)) {
      counts[first] += 1;
      counts[first + 1] += 1;
      counts[first + 2] += 1;
      return true;
    }
    counts[first] += 1;
    counts[first + 1] += 1;
    counts[first + 2] += 1;
  }
  return false;
}

export function isWinningHand(closedTiles: Tile[], melds: Meld[] = []): boolean {
  const needClosedGroups = 4 - melds.length;
  if (needClosedGroups < 0) return false;
  const tiles = sortTiles(closedTiles);
  if (melds.length === 0 && tiles.length === 14) {
    const counts = countTileValues(tiles);
    if ([...counts.values()].filter((count) => count === 2).length === 7) return true;
    const terminals = ["m1", "m9", "p1", "p9", "s1", "s9", "z1", "z2", "z3", "z4", "z5", "z6", "z7"] as Tile[];
    if (terminals.every((tile) => (counts.get(tile) ?? 0) > 0) && terminals.some((tile) => (counts.get(tile) ?? 0) > 1)) return true;
  }
  if (tiles.length !== needClosedGroups * 3 + 2) return false;
  const counts = Array(34).fill(0);
  for (const tile of tiles) counts[tileToIndex(tile)] += 1;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      if (canMakeMelds(counts)) {
        counts[i] += 2;
        return true;
      }
      counts[i] += 2;
    }
  }
  return false;
}

export function waitsFor(closedTiles: Tile[], melds: Meld[] = []): WaitInfo {
  const waits: Tile[] = [];
  for (const tile of TILE_TYPES) {
    const currentCount = closedTiles.filter((candidate) => tileBase(candidate) === tile).length;
    if (currentCount >= 4) continue;
    if (isWinningHand([...closedTiles, tile], melds)) waits.push(tile);
  }
  return { waits, isTenpai: waits.length > 0, isWinning: isWinningHand(closedTiles, melds) };
}

export function isFuriten(discards: Tile[], waits: Tile[]): boolean {
  return waits.some((tile) => discards.includes(tile));
}

export function findChiOptions(hand: Tile[], tile: Tile): Tile[][] {
  if (tile.startsWith("z")) return [];
  const suit = tile[0] as "m" | "p" | "s";
  const n = Number(tile.slice(1));
  const options: Tile[][] = [];
  for (const seq of [[n - 2, n - 1], [n - 1, n + 1], [n + 1, n + 2]]) {
    if (seq.every((value) => value >= 1 && value <= 9)) {
      const needed = seq.map((value) => `${suit}${value}` as Tile);
      let remaining: Tile[] | null = hand;
      const consumed: Tile[] = [];
      for (const need of needed) {
        if (!remaining) break;
        const removed: { next: Tile[]; removed: Tile } | null = removeOneByValue(remaining, need);
        if (!removed) {
          remaining = null;
          break;
        }
        remaining = removed.next;
        consumed.push(removed.removed);
      }
      if (remaining) options.push(sortTiles([...consumed, tile]));
    }
  }
  return options;
}

export function canPon(hand: Tile[], tile: Tile): boolean {
  return hand.filter((candidate) => tileBase(candidate) === tileBase(tile)).length >= 2;
}

export function canKan(hand: Tile[], tile: Tile): boolean {
  return hand.filter((candidate) => tileBase(candidate) === tileBase(tile)).length >= 3;
}
