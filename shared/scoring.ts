import { Meld } from "./hand";
import { Seat } from "./messages";
import { Tile, doraFromIndicator, isRedDora, tileBase } from "./tiles";

export type ScoreInput = {
  winner: Seat;
  dealer: Seat;
  closedTiles: Tile[];
  winTile: Tile;
  melds: Meld[];
  isRiichi: boolean;
  isIppatsu: boolean;
  isRinshan: boolean;
  isHaitei?: boolean;
  doraIndicators: Tile[];
  uraDoraIndicators: Tile[];
  redDoraEnabled: boolean;
};

export type ScoreResult = {
  han: number;
  fu: number;
  points: number;
  yaku: string[];
  dora: number;
  uraDora: number;
  redDora: number;
};

type Group = { kind: "sequence" | "triplet" | "pair"; tiles: Tile[] };

const TERMINALS = new Set<Tile>(["m1", "m9", "p1", "p9", "s1", "s9"]);
const YAOCHU = new Set<Tile>([...TERMINALS, "z1", "z2", "z3", "z4", "z5", "z6", "z7"]);

function ceil100(value: number): number {
  return Math.ceil(value / 100) * 100;
}

function allTiles(input: ScoreInput): Tile[] {
  return [...input.closedTiles, ...input.melds.flatMap((meld) => meld.tiles)];
}

function countDora(tiles: Tile[], indicators: Tile[]): number {
  const doraTiles = indicators.map(doraFromIndicator);
  return tiles.reduce((sum, tile) => sum + doraTiles.filter((dora) => dora === tileBase(tile)).length, 0);
}

function counts(tiles: Tile[]): Map<Tile, number> {
  const map = new Map<Tile, number>();
  for (const tile of tiles) {
    const base = tileBase(tile);
    map.set(base, (map.get(base) ?? 0) + 1);
  }
  return map;
}

function isSevenPairs(tiles: Tile[]): boolean {
  const values = [...counts(tiles).values()];
  return tiles.length === 14 && values.length === 7 && values.every((count) => count === 2);
}

function isKokushi(tiles: Tile[]): boolean {
  const map = counts(tiles);
  const required = [...YAOCHU];
  return required.every((tile) => (map.get(tile) ?? 0) > 0) && required.some((tile) => (map.get(tile) ?? 0) > 1);
}

function isSimple(tile: Tile): boolean {
  const base = tileBase(tile);
  return !base.startsWith("z") && !TERMINALS.has(base);
}

function tileIndex(tile: Tile): number {
  const base = tileBase(tile);
  const suit = base[0];
  const n = Number(base.slice(1)) - 1;
  if (suit === "m") return n;
  if (suit === "p") return 9 + n;
  if (suit === "s") return 18 + n;
  return 27 + n;
}

function indexTile(index: number): Tile {
  if (index < 9) return `m${index + 1}` as Tile;
  if (index < 18) return `p${index - 8}` as Tile;
  if (index < 27) return `s${index - 17}` as Tile;
  return `z${index - 26}` as Tile;
}

function findMelds(countArray: number[], groups: Group[], out: Group[][]): void {
  const first = countArray.findIndex((count) => count > 0);
  if (first === -1) {
    out.push(groups);
    return;
  }
  if (countArray[first] >= 3) {
    countArray[first] -= 3;
    findMelds(countArray, [...groups, { kind: "triplet", tiles: [indexTile(first), indexTile(first), indexTile(first)] }], out);
    countArray[first] += 3;
  }
  const suitStart = Math.floor(first / 9) * 9;
  const pos = first - suitStart;
  if (first < 27 && pos <= 6 && countArray[first + 1] > 0 && countArray[first + 2] > 0) {
    countArray[first] -= 1;
    countArray[first + 1] -= 1;
    countArray[first + 2] -= 1;
    findMelds(countArray, [...groups, { kind: "sequence", tiles: [indexTile(first), indexTile(first + 1), indexTile(first + 2)] }], out);
    countArray[first] += 1;
    countArray[first + 1] += 1;
    countArray[first + 2] += 1;
  }
}

function standardShapes(tiles: Tile[]): Group[][] {
  if (tiles.length % 3 !== 2) return [];
  const arr = Array(34).fill(0);
  for (const tile of tiles) arr[tileIndex(tile)] += 1;
  const out: Group[][] = [];
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i] >= 2) {
      arr[i] -= 2;
      const melds: Group[][] = [];
      findMelds(arr, [], melds);
      out.push(...melds.map((groups) => [{ kind: "pair" as const, tiles: [indexTile(i), indexTile(i)] }, ...groups]));
      arr[i] += 2;
    }
  }
  return out;
}

function limitBase(han: number, fu: number): number {
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  return Math.min(fu * 2 ** (han + 2), 2000);
}

function tsumoTotal(base: number, isDealer: boolean): number {
  return isDealer ? ceil100(base * 2) * 3 : ceil100(base * 2) + ceil100(base);
}

export function scoreTsumo(input: ScoreInput): ScoreResult {
  const yaku: string[] = [];
  const closed = input.melds.length === 0;
  const tiles = allTiles(input);
  const baseTiles = tiles.map(tileBase);
  let yakuHan = 0;
  let yakuman = false;

  if (isKokushi(input.closedTiles) && input.melds.length === 0) {
    yaku.push("国士无双");
    yakuHan += 13;
    yakuman = true;
  }

  if (!yakuman) {
    if (input.isRiichi) { yaku.push("立直"); yakuHan += 1; }
    if (input.isIppatsu) { yaku.push("一发"); yakuHan += 1; }
    if (closed) { yaku.push("门前清自摸和"); yakuHan += 1; }
    if (input.isRinshan) { yaku.push("岭上开花"); yakuHan += 1; }
    if (input.isHaitei) { yaku.push("海底摸月"); yakuHan += 1; }
    if (baseTiles.every(isSimple)) { yaku.push("断幺九"); yakuHan += 1; }
    if (isSevenPairs(input.closedTiles) && input.melds.length === 0) { yaku.push("七对子"); yakuHan += 2; }

    const triplets = input.melds.filter((meld) => meld.kind === "pon" || meld.kind === "kan" || meld.kind === "ankan");
    const yakuhai = triplets.filter((meld) => meld.tiles.some((tile) => ["z1", "z5", "z6", "z7"].includes(tileBase(tile)))).length;
    if (yakuhai > 0) { yaku.push(`役牌${yakuhai > 1 ? ` x${yakuhai}` : ""}`); yakuHan += yakuhai; }

    const suits = new Set(baseTiles.filter((tile) => !tile.startsWith("z")).map((tile) => tile[0]));
    const hasHonor = baseTiles.some((tile) => tile.startsWith("z"));
    if (suits.size === 1 && hasHonor) { yaku.push(closed ? "混一色" : "混一色(副露)"); yakuHan += closed ? 3 : 2; }
    if (suits.size === 1 && !hasHonor) { yaku.push(closed ? "清一色" : "清一色(副露)"); yakuHan += closed ? 6 : 5; }

    const shapes = standardShapes(input.closedTiles);
    if (shapes.some((shape) => shape.filter((group) => group.kind === "triplet").length === 4) && input.melds.every((meld) => meld.kind !== "chi")) {
      yaku.push("对对和");
      yakuHan += 2;
    }
    if (closed && shapes.some((shape) => shape.filter((group) => group.kind === "sequence").length === 4 && !shape.find((group) => group.kind === "pair")?.tiles.some((tile) => ["z1", "z5", "z6", "z7"].includes(tile)))) {
      yaku.push("平和");
      yakuHan += 1;
    }
    if (closed && shapes.some((shape) => {
      const seqs = shape.filter((group) => group.kind === "sequence").map((group) => group.tiles.join(""));
      return new Set(seqs).size < seqs.length;
    })) {
      yaku.push("一杯口");
      yakuHan += 1;
    }
  }

  if (yakuHan === 0) return { han: 0, fu: 0, points: 0, yaku: [], dora: 0, uraDora: 0, redDora: 0 };

  const dora = yakuman ? 0 : countDora(tiles, input.doraIndicators);
  const uraDora = !yakuman && input.isRiichi ? countDora(tiles, input.uraDoraIndicators) : 0;
  const redDora = !yakuman && input.redDoraEnabled ? tiles.filter(isRedDora).length : 0;
  if (dora > 0) yaku.push(`宝牌 x${dora}`);
  if (uraDora > 0) yaku.push(`里宝牌 x${uraDora}`);
  if (redDora > 0) yaku.push(`红宝牌 x${redDora}`);

  const han = yakuHan + dora + uraDora + redDora;
  const fu = isSevenPairs(input.closedTiles) ? 25 : closed ? 30 : 40;
  const base = limitBase(han, fu);
  const points = tsumoTotal(base, input.winner === input.dealer);
  return { han, fu, points, yaku, dora, uraDora, redDora };
}
