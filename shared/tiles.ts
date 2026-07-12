export type Suit = "m" | "p" | "s" | "z";
export type Tile = `${Suit}${number}`;

export const SUITS: Suit[] = ["m", "p", "s", "z"];
export const TILE_TYPES: Tile[] = [
  "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9",
  "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9",
  "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9",
  "z1", "z2", "z3", "z4", "z5", "z6", "z7"
];

const labels: Record<Tile, string> = {
  m0: "赤五万", m1: "一万", m2: "二万", m3: "三万", m4: "四万", m5: "五万", m6: "六万", m7: "七万", m8: "八万", m9: "九万",
  p0: "赤五筒", p1: "一筒", p2: "二筒", p3: "三筒", p4: "四筒", p5: "五筒", p6: "六筒", p7: "七筒", p8: "八筒", p9: "九筒",
  s0: "赤五索", s1: "一索", s2: "二索", s3: "三索", s4: "四索", s5: "五索", s6: "六索", s7: "七索", s8: "八索", s9: "九索",
  z1: "东", z2: "南", z3: "西", z4: "北", z5: "白", z6: "发", z7: "中"
};

export function tileLabel(tile: Tile): string {
  return labels[tile] ?? tile;
}

export function tileBase(tile: Tile): Tile {
  if (tile === "m0") return "m5";
  if (tile === "p0") return "p5";
  if (tile === "s0") return "s5";
  return tile;
}

export function isRedDora(tile: Tile): boolean {
  return tile === "m0" || tile === "p0" || tile === "s0";
}

export function tileSortValue(tile: Tile): number {
  const suitOrder = { m: 0, p: 1, s: 2, z: 3 } as const;
  const number = Number(tileBase(tile).slice(1));
  return suitOrder[tile[0] as Suit] * 10 + number - (isRedDora(tile) ? 0.5 : 0);
}

export function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => tileSortValue(a) - tileSortValue(b));
}

export function fullWall(redDora = true): Tile[] {
  const wall = TILE_TYPES.flatMap((tile) => [tile, tile, tile, tile]);
  if (!redDora) return wall;
  const replaced = new Set<Tile>();
  return wall.map((tile) => {
    if ((tile === "m5" || tile === "p5" || tile === "s5") && !replaced.has(tile)) {
      replaced.add(tile);
      return `${tile[0]}0` as Tile;
    }
    return tile;
  });
}

export function shuffle<T>(items: T[], rng = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function removeOne(tiles: Tile[], tile: Tile): Tile[] | null {
  const index = tiles.indexOf(tile);
  if (index < 0) return null;
  return [...tiles.slice(0, index), ...tiles.slice(index + 1)];
}

export function removeOneByValue(tiles: Tile[], tile: Tile): { next: Tile[]; removed: Tile } | null {
  const base = tileBase(tile);
  const index = tiles.findIndex((candidate) => tileBase(candidate) === base);
  if (index < 0) return null;
  return { next: [...tiles.slice(0, index), ...tiles.slice(index + 1)], removed: tiles[index] };
}

export function countTiles(tiles: Tile[]): Map<Tile, number> {
  const counts = new Map<Tile, number>();
  for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  return counts;
}

export function countTileValues(tiles: Tile[]): Map<Tile, number> {
  const counts = new Map<Tile, number>();
  for (const tile of tiles) {
    const base = tileBase(tile);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return counts;
}

export function doraFromIndicator(indicator: Tile): Tile {
  const base = tileBase(indicator);
  const suit = base[0] as Suit;
  const number = Number(base.slice(1));
  if (suit === "z") {
    if (number >= 1 && number <= 4) return `z${number === 4 ? 1 : number + 1}` as Tile;
    return `z${number === 7 ? 5 : number + 1}` as Tile;
  }
  return `${suit}${number === 9 ? 1 : number + 1}` as Tile;
}
