import { describe, expect, it } from "vitest";
import { findChiOptions, isWinningHand, waitsFor } from "../shared/hand";
import { doraFromIndicator, fullWall, sortTiles } from "../shared/tiles";
import { FutariGame } from "../server/game";
import { scoreTsumo } from "../shared/scoring";

describe("tiles", () => {
  it("builds a 136 tile wall", () => {
    expect(fullWall()).toHaveLength(136);
  });

  it("includes three red fives by default", () => {
    expect(fullWall().filter((tile) => tile === "m0" || tile === "p0" || tile === "s0")).toHaveLength(3);
  });

  it("sorts tiles by suit then number", () => {
    expect(sortTiles(["z1", "m9", "m1", "p2", "s3"])).toEqual(["m1", "m9", "p2", "s3", "z1"]);
  });

  it("converts dora indicators", () => {
    expect(doraFromIndicator("m9")).toBe("m1");
    expect(doraFromIndicator("z4")).toBe("z1");
    expect(doraFromIndicator("z7")).toBe("z5");
  });
});

describe("hand resolver", () => {
  it("recognizes standard winning hands", () => {
    expect(isWinningHand(["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s8", "s9", "z1", "z1"])).toBe(true);
  });

  it("recognizes seven pairs", () => {
    expect(isWinningHand(["m1", "m1", "m2", "m2", "p3", "p3", "p4", "p4", "s5", "s5", "s6", "s6", "z7", "z7"])).toBe(true);
  });

  it("finds waits for a tenpai hand", () => {
    const info = waitsFor(["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s8", "s9", "z1"]);
    expect(info.isTenpai).toBe(true);
    expect(info.waits).toContain("z1");
  });

  it("treats red fives as normal fives for winning hands", () => {
    expect(isWinningHand(["m1", "m2", "m3", "m4", "m0", "m6", "p2", "p3", "p4", "s7", "s8", "s9", "z1", "z1"])).toBe(true);
  });

  it("finds chi options from opponent discard", () => {
    expect(findChiOptions(["m1", "m3", "m4", "m5"], "m2")).toEqual([["m1", "m2", "m3"], ["m2", "m3", "m4"]]);
  });
});

describe("scoring dora", () => {
  const winningHand = ["m1", "m2", "m3", "m4", "m0", "m6", "p2", "p3", "p4", "s7", "s8", "s9", "z1", "z1"] as const;

  it("does not allow dora-only wins", () => {
    const score = scoreTsumo({
      winner: "west",
      dealer: "east",
      closedTiles: [...winningHand],
      winTile: "z1",
      melds: [{ kind: "chi", tiles: ["m1", "m2", "m3"], from: "east" }],
      isRiichi: false,
      isIppatsu: false,
      isRinshan: false,
      doraIndicators: ["m4"],
      uraDoraIndicators: [],
      redDoraEnabled: true
    });
    expect(score.points).toBe(0);
  });

  it("adds visible, ura, and red dora to a real yaku", () => {
    const score = scoreTsumo({
      winner: "west",
      dealer: "east",
      closedTiles: [...winningHand],
      winTile: "z1",
      melds: [],
      isRiichi: true,
      isIppatsu: false,
      isRinshan: false,
      doraIndicators: ["m4"],
      uraDoraIndicators: ["z4"],
      redDoraEnabled: true
    });
    expect(score.dora).toBe(1);
    expect(score.uraDora).toBe(2);
    expect(score.redDora).toBe(1);
    expect(score.han).toBeGreaterThanOrEqual(6);
  });
});

describe("game state", () => {
  it("starts in waiting phase", () => {
    const game = new FutariGame();
    expect(game.viewFor().phase).toBe("waiting");
    expect(game.viewFor().players).toHaveLength(2);
    expect(game.viewFor().maxTurnDiscards).toBe(36);
    expect(game.viewFor().guessHistory).toEqual([]);
  });

  it("can end and restart a match from game over", () => {
    const game = new FutariGame();
    const fakeSocket = { send: () => undefined, readyState: 1 };
    game.players.east.connected = true;
    game.players.east.socket = fakeSocket as never;
    game.players.west.connected = true;
    game.players.east.points = 12000;
    game.players.west.points = 8000;

    game.handle(fakeSocket as never, { type: "quit_game" });
    const ended = game.viewFor("east");
    expect(ended.phase).toBe("game_over");
    expect(ended.gameOver?.winner).toBe("east");
    expect(ended.legalActions).toContain("restart_match");

    game.handle(fakeSocket as never, { type: "restart_match" });
    expect(game.viewFor("east").phase).toBe("draw_discard");
    expect(game.viewFor("east").players.find((player) => player.seat === "east")?.points).toBe(0);
  });
});
