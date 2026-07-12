import { WebSocket } from "ws";
import { ClientMessage, GameView, Phase, Seat, ServerMessage } from "../shared/messages";
import { Meld, canKan, canPon, findChiOptions, isFuriten, waitsFor } from "../shared/hand";
import { Tile, fullWall, removeOne, removeOneByValue, shuffle, sortTiles, tileBase } from "../shared/tiles";
import { scoreTsumo } from "../shared/scoring";

type PlayerState = {
  seat: Seat;
  name: string;
  socket?: WebSocket;
  connected: boolean;
  points: number;
  riichiSticks: number;
  hand: Tile[];
  discards: Tile[];
  melds: Meld[];
  isRiichi: boolean;
};

const seats: Seat[] = ["east", "west"];
const otherSeat = (seat: Seat): Seat => (seat === "east" ? "west" : "east");

export class FutariGame {
  players: Record<Seat, PlayerState>;
  phase: Phase = "waiting";
  dealer: Seat = "east";
  turn: Seat = "east";
  attacker?: Seat;
  defender?: Seat;
  wall: Tile[] = [];
  deadWall: Tile[] = [];
  lastDiscard?: { seat: Seat; tile: Tile };
  round = 1;
  honba = 0;
  burstDrawsLeft = 0;
  message = "等待两位玩家加入。";
  guessedTiles?: Tile[];
  guessHistory: Tile[][] = [];
  revealedAttackerHand?: Tile[];
  gameOver?: GameView["gameOver"];
  private riichiDeposit = 0;
  private turnDiscards = 0;
  private firstBurstDraw = false;
  private lastBurstTile?: Tile;
  private doraIndicatorCount = 1;
  private revealedUraDoraIndicators: Tile[] = [];
  private redDoraEnabled = true;
  private matchStartedAt = 0;
  private timeLimitMs = 60 * 60 * 1000;

  constructor() {
    this.players = {
      east: this.emptyPlayer("east"),
      west: this.emptyPlayer("west")
    };
  }

  private emptyPlayer(seat: Seat): PlayerState {
    return { seat, name: seat === "east" ? "东家" : "西家", connected: false, points: 0, riichiSticks: 10, hand: [], discards: [], melds: [], isRiichi: false };
  }

  addPlayer(socket: WebSocket, name: string): Seat | null {
    const seat = seats.find((candidate) => !this.players[candidate].connected);
    if (!seat) return null;
    this.players[seat].socket = socket;
    this.players[seat].connected = true;
    this.players[seat].name = name || (seat === "east" ? "东家" : "西家");
    if (this.players.east.connected && this.players.west.connected && this.phase === "waiting") this.startHand(false);
    else this.message = `${this.players[seat].name} 已入座，等待对手。`;
    this.broadcast();
    return seat;
  }

  removeSocket(socket: WebSocket): void {
    for (const seat of seats) {
      if (this.players[seat].socket === socket) {
        this.players[seat].connected = false;
        this.players[seat].socket = undefined;
        this.message = `${this.players[seat].name} 断线。刷新页面可重新入座。`;
      }
    }
    this.broadcast();
  }

  handle(socket: WebSocket, msg: ClientMessage): void {
    const seat = seats.find((candidate) => this.players[candidate].socket === socket);
    if ((msg.type === "create_room" || msg.type === "join") && !seat) {
      const joined = this.addPlayer(socket, msg.name);
      if (!joined) this.send(socket, { type: "error", message: "房间已满，只支持两人。" });
      return;
    }
    if (!seat) {
      this.send(socket, { type: "error", message: "请先加入房间。" });
      return;
    }
    try {
      this.applyAction(seat, msg);
      this.broadcast();
    } catch (error) {
      this.send(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private applyAction(seat: Seat, msg: ClientMessage): void {
    if (msg.type === "quit_game") {
      this.endMatch(seat);
      return;
    }
    if (msg.type === "restart_match") {
      if (this.phase !== "game_over") throw new Error("当前不能重新开始整场。");
      this.restartMatch();
      return;
    }
    if (msg.type === "next_hand") {
      if (this.phase !== "hand_over") throw new Error("当前不能开始下一局。");
      this.startHand(true);
      return;
    }
    if (msg.type === "discard") {
      this.discard(seat, msg.tile);
      return;
    }
    if (msg.type === "call_chi") {
      this.callChi(seat, msg.tiles);
      return;
    }
    if (msg.type === "call_pon") {
      this.callPon(seat);
      return;
    }
    if (msg.type === "call_kan") {
      this.callKan(seat);
      return;
    }
    if (msg.type === "call_ankan") {
      this.callAnkan(seat, msg.tile);
      return;
    }
    if (msg.type === "call_kakan") {
      this.callKakan(seat, msg.tile);
      return;
    }
    if (msg.type === "pass") {
      this.pass(seat);
      return;
    }
    if (msg.type === "declare_tenpai") {
      this.commitTenpai(seat, msg.discard, false);
      return;
    }
    if (msg.type === "riichi") {
      this.commitTenpai(seat, msg.discard, true);
      return;
    }
    if (msg.type === "guess_waits") {
      this.guess(seat, msg.tiles);
      return;
    }
    if (msg.type === "draw_burst_action") {
      if (msg.action === "tsumo") this.winBurst(seat);
      else this.continueBurst(seat);
      return;
    }
    if (msg.type === "win_tsumo") {
      this.winBurst(seat);
      return;
    }
  }

  private startHand(advanceRound: boolean): void {
    if (advanceRound) this.round += 1;
    if (!advanceRound && this.round === 1 && this.matchStartedAt === 0) this.matchStartedAt = Date.now();
    const wall = shuffle(fullWall(this.redDoraEnabled));
    this.deadWall = wall.splice(-14);
    this.wall = wall;
    for (const seat of seats) {
      Object.assign(this.players[seat], {
        hand: [],
        discards: [],
        melds: [],
        isRiichi: false
      });
    }
    for (let i = 0; i < 13; i += 1) {
      this.players.east.hand.push(this.drawRaw());
      this.players.west.hand.push(this.drawRaw());
    }
    this.players.east.hand.push(this.drawRaw());
    this.players.east.hand = sortTiles(this.players.east.hand);
    this.players.west.hand = sortTiles(this.players.west.hand);
    this.phase = "draw_discard";
    this.turn = this.dealer;
    this.attacker = undefined;
    this.defender = undefined;
    this.lastDiscard = undefined;
    this.guessedTiles = undefined;
    this.guessHistory = [];
    this.revealedAttackerHand = undefined;
    this.gameOver = undefined;
    this.burstDrawsLeft = 0;
    this.turnDiscards = 0;
    this.firstBurstDraw = false;
    this.lastBurstTile = undefined;
    this.doraIndicatorCount = 1;
    this.revealedUraDoraIndicators = [];
    this.message = `第 ${this.round} 局开始。${this.dealer === "east" ? "东家" : "西家"}先打。`;
  }

  private drawRaw(): Tile {
    const tile = this.wall.shift();
    if (!tile) throw new Error("牌山已空。");
    return tile;
  }

  private doraIndicators(): Tile[] {
    return this.deadWall.slice(0, this.doraIndicatorCount);
  }

  private uraDoraIndicators(): Tile[] {
    return this.deadWall.slice(5, 5 + this.doraIndicatorCount);
  }

  private drawRinshan(): Tile {
    const tile = this.deadWall.pop();
    if (!tile) throw new Error("王牌已空，不能补牌。");
    return tile;
  }

  private revealKanDora(): void {
    if (this.doraIndicatorCount < 5) this.doraIndicatorCount += 1;
  }

  private matchTimeLeftMs(): number {
    if (!this.matchStartedAt) return this.timeLimitMs;
    return Math.max(0, this.timeLimitMs - (Date.now() - this.matchStartedAt));
  }

  private visibleTiles(): Tile[] {
    return [
      ...this.players.east.discards,
      ...this.players.west.discards,
      ...this.players.east.melds.flatMap((meld) => meld.tiles),
      ...this.players.west.melds.flatMap((meld) => meld.tiles),
      ...this.doraIndicators()
    ];
  }

  private isEmptyWait(seat: Seat): boolean {
    const waits = waitsFor(this.players[seat].hand, this.players[seat].melds).waits;
    if (waits.length === 0) return false;
    const visible = this.visibleTiles();
    return waits.every((wait) => visible.filter((tile) => tileBase(tile) === tileBase(wait)).length + this.players[seat].hand.filter((tile) => tileBase(tile) === tileBase(wait)).length >= 4);
  }

  private isEmptyWaitFor(seat: Seat, hand: Tile[], waits: Tile[]): boolean {
    if (waits.length === 0) return false;
    const visible = this.visibleTiles();
    return waits.every((wait) => visible.filter((tile) => tileBase(tile) === tileBase(wait)).length + hand.filter((tile) => tileBase(tile) === tileBase(wait)).length >= 4);
  }

  private tenpaiOptionsFor(seat: Seat): GameView["tenpaiOptions"] {
    const player = this.players[seat];
    if (this.phase !== "draw_discard" || this.turn !== seat) return [];
    const seen = new Set<Tile>();
    const options: GameView["tenpaiOptions"] = [];
    for (const discard of player.hand) {
      const base = tileBase(discard);
      if (seen.has(base)) continue;
      seen.add(base);
      const removed = removeOneByValue(player.hand, discard);
      if (!removed) continue;
      const waits = waitsFor(removed.next, player.melds).waits;
      if (waits.length === 0) continue;
      const discardsAfter = [...player.discards, removed.removed];
      const furiten = isFuriten(discardsAfter, waits);
      options.push({
        discard: removed.removed,
        waits,
        isFuriten: furiten,
        isEmptyWait: this.isEmptyWaitFor(seat, removed.next, waits)
      });
    }
    return options;
  }

  private discard(seat: Seat, tile: Tile, riichi = false): void {
    if (this.phase !== "draw_discard") throw new Error("当前不能打牌。");
    if (seat !== this.turn) throw new Error("还没轮到你。");
    const player = this.players[seat];
    const nextHand = removeOne(player.hand, tile);
    if (!nextHand) throw new Error("手牌里没有这张牌。");
    if (riichi && !waitsFor(nextHand, player.melds).isTenpai) throw new Error("打出这张后并未听牌，不能立直。");
    player.hand = sortTiles(nextHand);
    player.discards.push(tile);
    if (riichi) {
      if (player.riichiSticks <= 0) player.points -= 1000;
      else player.riichiSticks -= 1;
      this.riichiDeposit += 1000;
      player.isRiichi = true;
    }
    this.lastDiscard = { seat, tile };
    this.turnDiscards += 1;
    if (this.turnDiscards >= 36) {
      this.endHand("18巡内双方无人宣言，流局。", undefined, true);
      return;
    }
    const defender = otherSeat(seat);
    const canReact = this.reactionActions(defender).length > 0;
    if (canReact) {
      this.phase = "reaction";
      this.turn = defender;
      this.message = `${this.players[seat].name} 打出 ${tile}，${this.players[defender].name} 可鸣牌。`;
    } else {
      this.drawFor(otherSeat(seat));
    }
  }

  private riichi(seat: Seat, tile: Tile): void {
    if (this.phase !== "draw_discard") throw new Error("当前不能立直。");
    if (seat !== this.turn) throw new Error("还没轮到你。");
    const player = this.players[seat];
    const nextHand = removeOne(player.hand, tile);
    if (!nextHand) throw new Error("手牌里没有这张牌。");
    const waitInfo = waitsFor(nextHand, player.melds);
    if (!waitInfo.isTenpai) throw new Error("打出这张后并未听牌，不能立直。");
    if (isFuriten(player.discards, waitInfo.waits)) throw new Error("振听状态不能立直。");
    player.hand = sortTiles(nextHand);
    player.discards.push(tile);
    if (player.riichiSticks <= 0) player.points -= 1000;
    else player.riichiSticks -= 1;
    this.riichiDeposit += 1000;
    player.isRiichi = true;
    this.lastDiscard = { seat, tile };
    this.turnDiscards += 1;
    this.attacker = seat;
    this.defender = otherSeat(seat);
    this.phase = "guess";
    this.burstDrawsLeft = 0;
    this.firstBurstDraw = true;
    this.message = `${player.name} 立直，守方请选择两张猜待牌。`;
  }

  private commitTenpai(seat: Seat, discard: Tile | undefined, riichi: boolean): void {
    if (this.phase !== "draw_discard") throw new Error(riichi ? "当前不能立直。" : "当前不能宣言听牌。");
    if (seat !== this.turn) throw new Error("还没轮到你。");
    if (!discard) throw new Error("请选择要打出的宣言牌。");
    const player = this.players[seat];
    if (riichi && player.melds.some((meld) => meld.kind !== "ankan")) throw new Error("副露后不能立直。");
    const removed = removeOneByValue(player.hand, discard);
    if (!removed) throw new Error("手牌里没有这张牌。");
    const waitInfo = waitsFor(removed.next, player.melds);
    if (!waitInfo.isTenpai) throw new Error("打出这张后并未听牌。");
    if (isFuriten([...player.discards, removed.removed], waitInfo.waits)) throw new Error("振听状态不能宣言。");
    player.hand = sortTiles(removed.next);
    player.discards.push(removed.removed);
    if (riichi) {
      if (player.riichiSticks <= 0) player.points -= 1000;
      else player.riichiSticks -= 1;
      this.riichiDeposit += 1000;
      player.isRiichi = true;
    }
    this.lastDiscard = { seat, tile: removed.removed };
    this.turnDiscards += 1;
    this.attacker = seat;
    this.defender = otherSeat(seat);
    this.phase = "guess";
    this.burstDrawsLeft = 0;
    this.firstBurstDraw = true;
    this.message = `${player.name}${riichi ? "立直" : "听牌宣言"}，守方请选择两张猜待牌。`;
  }

  private reactionActions(seat: Seat): string[] {
    if (!this.lastDiscard || this.lastDiscard.seat === seat) return [];
    const tile = this.lastDiscard.tile;
    const hand = this.players[seat].hand;
    const actions: string[] = [];
    if (findChiOptions(hand, tile).length > 0) actions.push("call_chi");
    if (canPon(hand, tile)) actions.push("call_pon");
    if (canKan(hand, tile)) actions.push("call_kan");
    actions.push("pass");
    return actions;
  }

  private callChi(seat: Seat, tiles: Tile[]): void {
    if (this.phase !== "reaction" || !this.lastDiscard) throw new Error("当前不能吃。");
    const options = findChiOptions(this.players[seat].hand, this.lastDiscard.tile).map((option) => option.join(","));
    if (!options.includes(sortTiles(tiles).join(","))) throw new Error("吃牌组合不合法。");
    let hand = this.players[seat].hand;
    for (const tile of tiles.filter((candidate) => candidate !== this.lastDiscard?.tile)) {
      const next = removeOne(hand, tile);
      if (!next) throw new Error("吃牌手牌不足。");
      hand = next;
    }
    this.players[seat].hand = sortTiles(hand);
    this.players[seat].melds.push({ kind: "chi", tiles: sortTiles(tiles), from: this.lastDiscard.seat });
    this.turn = seat;
    this.phase = "draw_discard";
    this.lastDiscard = undefined;
    this.message = `${this.players[seat].name} 吃牌，请打出一张。`;
  }

  private callPon(seat: Seat): void {
    if (this.phase !== "reaction" || !this.lastDiscard) throw new Error("当前不能碰。");
    if (!canPon(this.players[seat].hand, this.lastDiscard.tile)) throw new Error("碰牌不合法。");
    let hand = this.players[seat].hand;
    const consumed: Tile[] = [];
    for (let i = 0; i < 2; i += 1) {
      const removed = removeOneByValue(hand, this.lastDiscard.tile)!;
      hand = removed.next;
      consumed.push(removed.removed);
    }
    this.players[seat].hand = sortTiles(hand);
    this.players[seat].melds.push({ kind: "pon", tiles: sortTiles([this.lastDiscard.tile, ...consumed]), from: this.lastDiscard.seat });
    this.turn = seat;
    this.phase = "draw_discard";
    this.lastDiscard = undefined;
    this.message = `${this.players[seat].name} 碰牌，请打出一张。`;
  }

  private callKan(seat: Seat): void {
    if (this.phase === "reaction" && this.lastDiscard) {
      if (!canKan(this.players[seat].hand, this.lastDiscard.tile)) throw new Error("杠牌不合法。");
      let hand = this.players[seat].hand;
      const consumed: Tile[] = [];
      for (let i = 0; i < 3; i += 1) {
        const removed = removeOneByValue(hand, this.lastDiscard.tile)!;
        hand = removed.next;
        consumed.push(removed.removed);
      }
      this.players[seat].hand = sortTiles([...hand, this.drawRinshan()]);
      this.revealKanDora();
      this.players[seat].melds.push({ kind: "kan", tiles: sortTiles([this.lastDiscard.tile, ...consumed]), from: this.lastDiscard.seat });
      this.turn = seat;
      this.phase = "draw_discard";
      this.lastDiscard = undefined;
      this.message = `${this.players[seat].name} 明杠并补牌，请打出一张。`;
      return;
    }
    throw new Error("当前不能杠。");
  }

  private callAnkan(seat: Seat, tile: Tile): void {
    if (this.phase !== "draw_discard" || this.turn !== seat) throw new Error("当前不能暗杠。");
    const player = this.players[seat];
    const base = tileBase(tile);
    if (player.hand.filter((candidate) => tileBase(candidate) === base).length < 4) throw new Error("暗杠不合法。");
    const waitsBefore = waitsFor(player.hand, player.melds).waits.join(",");
    let hand = player.hand;
    const consumed: Tile[] = [];
    for (let i = 0; i < 4; i += 1) {
      const removed = removeOneByValue(hand, tile)!;
      hand = removed.next;
      consumed.push(removed.removed);
    }
    const melds = [...player.melds, { kind: "ankan" as const, tiles: sortTiles(consumed) }];
    const nextHand = sortTiles([...hand, this.drawRinshan()]);
    if (player.isRiichi && waitsFor(nextHand, melds).waits.join(",") !== waitsBefore) throw new Error("立直后不能暗杠改变听牌。");
    player.hand = nextHand;
    player.melds = melds;
    this.revealKanDora();
    this.message = `${player.name} 暗杠并补牌，请打出一张。`;
  }

  private callKakan(seat: Seat, tile: Tile): void {
    if (this.phase !== "draw_discard" || this.turn !== seat) throw new Error("当前不能加杠。");
    const player = this.players[seat];
    const base = tileBase(tile);
    const pon = player.melds.find((meld) => meld.kind === "pon" && meld.tiles.some((candidate) => tileBase(candidate) === base));
    if (!pon) throw new Error("没有可加杠的碰子。");
    const removed = removeOneByValue(player.hand, tile);
    if (!removed) throw new Error("手牌里没有可加杠的牌。");
    player.hand = sortTiles([...removed.next, this.drawRinshan()]);
    pon.kind = "kan";
    pon.tiles = sortTiles([...pon.tiles, removed.removed]);
    this.revealKanDora();
    this.message = `${player.name} 加杠并补牌，请打出一张。`;
  }

  private pass(seat: Seat): void {
    if (this.phase !== "reaction" || !this.lastDiscard) throw new Error("当前无需跳过。");
    this.drawFor(seat);
  }

  private drawFor(seat: Seat): void {
    if (this.wall.length <= 0) {
      this.endHand("牌山摸到王牌，流局。", undefined, true);
      return;
    }
    this.players[seat].hand = sortTiles([...this.players[seat].hand, this.drawRaw()]);
    this.turn = seat;
    this.phase = "draw_discard";
    this.message = `轮到 ${this.players[seat].name} 摸打。`;
  }

  private declareTenpai(seat: Seat, riichi: boolean): void {
    if (this.phase !== "draw_discard") throw new Error("当前不能宣言听牌。");
    if (seat !== this.turn) throw new Error("只有当前手番能宣言。");
    const player = this.players[seat];
    const waitInfo = waitsFor(player.hand, player.melds);
    if (!waitInfo.isTenpai) throw new Error("未听牌，不能宣言。");
    if (isFuriten(player.discards, waitInfo.waits)) throw new Error("振听状态不能宣言。");
    this.attacker = seat;
    this.defender = otherSeat(seat);
    this.phase = "guess";
    this.burstDrawsLeft = 0;
    this.firstBurstDraw = true;
    this.message = `${player.name}${riichi || player.isRiichi ? "立直" : "听牌宣言"}，守方请选择两张猜待牌。`;
  }

  private guess(seat: Seat, tiles: Tile[]): void {
    if (this.phase !== "guess" || !this.attacker || !this.defender) throw new Error("当前不能猜牌。");
    if (seat !== this.defender) throw new Error("只有守方能猜牌。");
    if (tiles.length !== 2) throw new Error("必须猜两张牌。");
    const guessKey = sortTiles(tiles).join(",");
    if (this.guessHistory.some((guess) => sortTiles(guess).join(",") === guessKey)) throw new Error("这两张已经猜过，不能重复猜。");
    this.guessedTiles = tiles;
    this.guessHistory.push(tiles);
    const waits = waitsFor(this.players[this.attacker].hand, this.players[this.attacker].melds).waits;
    if (tiles.some((tile) => waits.includes(tile))) {
      this.revealedAttackerHand = sortTiles(this.players[this.attacker].hand);
      this.endHand("守方猜中待牌，本局无和流局。", undefined, true);
      return;
    }
    this.burstDrawsLeft = 5;
    this.phase = "burst";
    this.turn = this.attacker;
    this.drawBurstTile();
  }

  private drawBurstTile(): void {
    if (!this.attacker) throw new Error("没有攻方。");
    if (this.wall.length <= 0) {
      this.endHand("牌山摸到王牌，流局。", undefined, true);
      return;
    }
    const drawn = this.drawRaw();
    this.lastBurstTile = drawn;
    this.players[this.attacker].hand = sortTiles([...this.players[this.attacker].hand, drawn]);
    this.burstDrawsLeft -= 1;
    this.message = `守方猜错，攻方连摸中。剩余 ${this.burstDrawsLeft} 摸。`;
  }

  private continueBurst(seat: Seat): void {
    if (this.phase !== "burst" || seat !== this.attacker) throw new Error("当前不能继续连摸。");
    const player = this.players[seat];
    if (waitsFor(player.hand, player.melds).isWinning) throw new Error("已经自摸，可以和牌。");
    const drawn = this.lastBurstTile;
    if (!drawn) throw new Error("没有可摸切的连摸牌。");
    player.hand = sortTiles(removeOne(player.hand, drawn)!);
    player.discards.push(drawn);
    this.firstBurstDraw = false;
    this.lastBurstTile = undefined;
    if (this.burstDrawsLeft <= 0) {
      this.phase = "guess";
      this.turn = this.defender!;
      this.message = "5 摸未和，守方再次猜两张。";
      return;
    }
    this.drawBurstTile();
  }

  private winBurst(seat: Seat): void {
    if (this.phase !== "burst" || seat !== this.attacker) throw new Error("当前不能自摸。");
    const player = this.players[seat];
    if (!waitsFor(player.hand, player.melds).isWinning) throw new Error("当前手牌未和。");
    const score = scoreTsumo({
      winner: seat,
      dealer: this.dealer,
      closedTiles: player.hand,
      winTile: player.hand[player.hand.length - 1],
      melds: player.melds,
      isRiichi: player.isRiichi,
      isIppatsu: this.firstBurstDraw,
      isRinshan: false,
      isHaitei: this.wall.length === 0,
      doraIndicators: this.doraIndicators(),
      uraDoraIndicators: player.isRiichi ? this.uraDoraIndicators() : [],
      redDoraEnabled: this.redDoraEnabled
    });
    if (score.points <= 0) throw new Error("无役，不能和牌。");
    player.points += score.points + this.riichiDeposit + this.honba * 300;
    this.riichiDeposit = 0;
    this.revealedUraDoraIndicators = player.isRiichi ? this.uraDoraIndicators() : [];
    this.revealedAttackerHand = sortTiles(player.hand);
    this.endHand(`${player.name} 自摸：${score.fu}符${score.han}番 ${score.points} 点（${score.yaku.join("、")}）。`, seat, false);
  }

  private endHand(message: string, winner?: Seat, draw = false): void {
    if (winner === "west") {
      this.dealer = "west";
      this.honba = 0;
    } else {
      this.honba += 1;
    }
    if (winner === "east") this.honba += 0;
    if (draw) this.honba += 0;
    this.phase = "hand_over";
    this.message = message;
    if (this.matchTimeLeftMs() <= 0) this.endMatch(winner ?? this.dealer);
  }

  private endMatch(requestedBy: Seat): void {
    const east = this.players.east.points;
    const west = this.players.west.points;
    const winner = east === west ? undefined : east > west ? "east" : "west";
    const requester = this.players[requestedBy].name;
    const winnerText = winner ? `${this.players[winner].name} 胜` : "平局";
    const summary = `${requester} 结束了对局。最终比分：${this.players.east.name} ${east} 点，${this.players.west.name} ${west} 点。${winnerText}。`;
    this.phase = "game_over";
    this.attacker = undefined;
    this.defender = undefined;
    this.burstDrawsLeft = 0;
    this.revealedAttackerHand = undefined;
    this.guessedTiles = undefined;
    this.gameOver = { requestedBy, winner, summary };
    this.message = summary;
  }

  private restartMatch(): void {
    for (const seat of seats) {
      this.players[seat].points = 0;
      this.players[seat].riichiSticks = 10;
      this.players[seat].hand = [];
      this.players[seat].discards = [];
      this.players[seat].melds = [];
      this.players[seat].isRiichi = false;
    }
    this.dealer = "east";
    this.turn = "east";
    this.round = 1;
    this.honba = 0;
    this.riichiDeposit = 0;
    this.matchStartedAt = 0;
    this.wall = [];
    this.deadWall = [];
    this.doraIndicatorCount = 1;
    this.revealedUraDoraIndicators = [];
    this.lastDiscard = undefined;
    this.guessHistory = [];
    this.gameOver = undefined;
    if (this.players.east.connected && this.players.west.connected) this.startHand(false);
    else {
      this.phase = "waiting";
      this.message = "等待两位玩家加入。";
    }
  }

  legalActionsFor(seat?: Seat): string[] {
    if (!seat) return [];
    if (this.phase === "game_over") return ["restart_match"];
    if (this.phase === "draw_discard" && this.turn === seat) {
      const actions = ["discard"];
      const tenpaiOptions = this.tenpaiOptionsFor(seat).filter((option) => !option.isFuriten);
      if (tenpaiOptions.length > 0) actions.push("declare_tenpai");
      if (tenpaiOptions.length > 0 && this.players[seat].melds.every((meld) => meld.kind === "ankan")) actions.push("riichi");
      const handBases = new Map<Tile, number>();
      for (const tile of this.players[seat].hand) {
        const base = tileBase(tile);
        handBases.set(base, (handBases.get(base) ?? 0) + 1);
      }
      if ([...handBases.values()].some((count) => count >= 4)) actions.push("call_ankan");
      if (this.players[seat].melds.some((meld) => meld.kind === "pon" && this.players[seat].hand.some((tile) => meld.tiles.some((meldTile) => tileBase(meldTile) === tileBase(tile))))) actions.push("call_kakan");
      actions.push("quit_game");
      return actions;
    }
    if (this.phase === "reaction" && this.turn === seat) return [...this.reactionActions(seat), "quit_game"];
    if (this.phase === "guess" && this.defender === seat) return ["guess_waits", "quit_game"];
    if (this.phase === "burst" && this.attacker === seat) return ["draw_burst_action", "quit_game"];
    if (this.phase === "hand_over") return ["next_hand", "quit_game"];
    return this.phase === "waiting" ? [] : ["quit_game"];
  }

  viewFor(seat?: Seat): GameView {
    return {
      type: "state_sync",
      you: seat,
      phase: this.phase,
      dealer: this.dealer,
      turn: this.turn,
      attacker: this.attacker,
      defender: this.defender,
      burstDrawsLeft: this.burstDrawsLeft,
      round: this.round,
      honba: this.honba,
      turnDiscardCount: this.turnDiscards,
      maxTurnDiscards: 36,
      matchTimeLeftMs: this.matchTimeLeftMs(),
      wallCount: this.wall.length,
      deadWallCount: this.deadWall.length,
      doraIndicators: this.doraIndicators(),
      uraDoraIndicators: this.revealedUraDoraIndicators,
      redDoraEnabled: this.redDoraEnabled,
      lastDiscard: this.lastDiscard,
      players: seats.map((playerSeat) => ({
        seat: playerSeat,
        name: this.players[playerSeat].name,
        connected: this.players[playerSeat].connected,
        points: this.players[playerSeat].points,
        riichiSticks: this.players[playerSeat].riichiSticks,
        handCount: this.players[playerSeat].hand.length,
        hand: playerSeat === seat || this.phase === "hand_over" || this.phase === "game_over" ? sortTiles(this.players[playerSeat].hand) : undefined,
        discards: this.players[playerSeat].discards,
        melds: this.players[playerSeat].melds,
        isRiichi: this.players[playerSeat].isRiichi
      })),
      legalActions: this.legalActionsFor(seat),
      waits: seat ? waitsFor(this.players[seat].hand, this.players[seat].melds).waits : [],
      tenpaiOptions: seat ? this.tenpaiOptionsFor(seat) : [],
      isEmptyWait: seat ? this.isEmptyWait(seat) : false,
      message: this.message,
      revealedAttackerHand: this.revealedAttackerHand,
      guessedTiles: this.guessedTiles,
      guessHistory: this.guessHistory,
      gameOver: this.gameOver
    };
  }

  broadcast(): void {
    for (const seat of seats) {
      const socket = this.players[seat].socket;
      if (socket && socket.readyState === WebSocket.OPEN) this.send(socket, this.viewFor(seat));
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    socket.send(JSON.stringify(msg));
  }
}
