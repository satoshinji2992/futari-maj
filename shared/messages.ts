import { Meld } from "./hand";
import { Tile } from "./tiles";

export type Seat = "east" | "west";
export type Phase = "waiting" | "draw_discard" | "reaction" | "guess" | "burst" | "hand_over" | "game_over";

export type PublicPlayer = {
  seat: Seat;
  name: string;
  connected: boolean;
  points: number;
  riichiSticks: number;
  handCount: number;
  hand?: Tile[];
  discards: Tile[];
  melds: Meld[];
  isRiichi: boolean;
};

export type GameView = {
  type: "state_sync";
  you?: Seat;
  phase: Phase;
  dealer: Seat;
  turn: Seat;
  attacker?: Seat;
  defender?: Seat;
  burstDrawsLeft: number;
  round: number;
  honba: number;
  turnDiscardCount: number;
  maxTurnDiscards: number;
  matchTimeLeftMs: number;
  wallCount: number;
  deadWallCount: number;
  doraIndicators: Tile[];
  uraDoraIndicators: Tile[];
  redDoraEnabled: boolean;
  lastDiscard?: { seat: Seat; tile: Tile };
  players: PublicPlayer[];
  legalActions: string[];
  waits: Tile[];
  tenpaiOptions: Array<{
    discard: Tile;
    waits: Tile[];
    isFuriten: boolean;
    isEmptyWait: boolean;
  }>;
  isEmptyWait: boolean;
  message: string;
  revealedAttackerHand?: Tile[];
  guessedTiles?: Tile[];
  guessHistory: Tile[][];
  gameOver?: {
    requestedBy: Seat;
    winner?: Seat;
    summary: string;
  };
};

export type ClientMessage =
  | { type: "create_room"; name: string }
  | { type: "join"; name: string }
  | { type: "discard"; tile: Tile }
  | { type: "call_chi"; tiles: Tile[] }
  | { type: "call_pon" }
  | { type: "call_kan" }
  | { type: "call_ankan"; tile: Tile }
  | { type: "call_kakan"; tile: Tile }
  | { type: "pass" }
  | { type: "declare_tenpai"; discard?: Tile }
  | { type: "riichi"; discard: Tile }
  | { type: "guess_waits"; tiles: Tile[] }
  | { type: "draw_burst_action"; action: "continue" | "tsumo" }
  | { type: "win_tsumo" }
  | { type: "next_hand" }
  | { type: "quit_game" }
  | { type: "restart_match" };

export type ServerMessage = GameView | { type: "error"; message: string };
