import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { ClientMessage, GameView, ServerMessage } from "../shared/messages";
import { TILE_TYPES, Tile, doraFromIndicator, tileBase, tileLabel, sortTiles } from "../shared/tiles";
import { findChiOptions } from "../shared/hand";
import "./styles.css";

type HostInfo = {
  port: number;
  local: { httpUrl: string; wsUrl: string };
  addresses: Array<{ name: string; httpUrl: string; wsUrl: string }>;
};

function defaultWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL?.trim();
  if (configured) return configured;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  if (location.port === "5173") return `${scheme}://${location.hostname || "localhost"}:8787`;
  return `${scheme}://${location.host || "localhost:8787"}`;
}

function useSocket() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [state, setState] = useState<GameView | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  const connect = (url: string, name: string) => {
    const normalizedUrl = url.trim().replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    if (!normalizedUrl) {
      setError("请输入 WebSocket 地址。");
      return;
    }
    const ws = new WebSocket(normalizedUrl);
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", name } satisfies ClientMessage));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("连接失败，请确认 IP、端口和端口映射。");
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      if (msg.type === "error") setError(msg.message);
      else {
        setState(msg);
        setError("");
      }
    };
    setSocket(ws);
  };

  const send = (msg: ClientMessage) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("尚未连接。");
      return;
    }
    socket.send(JSON.stringify(msg));
  };

  return { connect, send, state, error, connected };
}

function TileButton({ tile, selected, disabled, onClick }: { tile: Tile; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button className={`tile tile-${tile[0]} ${selected ? "selected" : ""}`} disabled={disabled} onClick={onClick} title={tileLabel(tile)}>
      <span>{tileLabel(tile)}</span>
    </button>
  );
}

function HiddenHand({ count }: { count: number }) {
  return <div className="hidden-hand">{Array.from({ length: count }, (_, index) => <div className="tile back" key={index} />)}</div>;
}

function PlayerPanel({ player, isYou }: { player: GameView["players"][number]; isYou: boolean }) {
  return (
    <section className={`player-panel ${isYou ? "you" : ""}`}>
      <div className="player-title">
        <b>{player.seat === "east" ? "东家" : "西家"} · {player.name}</b>
        <span>{player.connected ? "在线" : "离线"}</span>
      </div>
      <div className="score-line">{player.points} 点 · 立直棒 {player.riichiSticks}{player.isRiichi ? " · 立直" : ""}</div>
      <div className="melds">
        {player.melds.map((meld, index) => (
          <div className="meld" key={`${meld.kind}-${index}`}>
            {meld.tiles.map((tile, tileIndex) => <TileButton tile={tile} disabled key={`${tile}-${tileIndex}`} />)}
          </div>
        ))}
      </div>
      <div className="river">
        {player.discards.map((tile, index) => <TileButton tile={tile} disabled key={`${tile}-${index}`} />)}
      </div>
      {!isYou && player.hand && (
        <div className="revealed">
          {player.hand.map((tile, index) => <TileButton tile={tile} disabled key={`${tile}-${index}`} />)}
        </div>
      )}
      {!isYou && !player.hand && <HiddenHand count={player.handCount} />}
    </section>
  );
}

function GuessPanel({ selected, setSelected, send }: { selected: Tile[]; setSelected: (tiles: Tile[]) => void; send: (msg: ClientMessage) => void }) {
  const toggle = (tile: Tile) => {
    if (selected.includes(tile)) setSelected(selected.filter((candidate) => candidate !== tile));
    else if (selected.length < 2) setSelected([...selected, tile]);
  };
  return (
    <div className="guess-panel">
      <h3>守方猜 2 张待牌</h3>
      <div className="tile-bank">
        {TILE_TYPES.map((tile) => <TileButton key={tile} tile={tile} selected={selected.includes(tile)} onClick={() => toggle(tile)} />)}
      </div>
      <button className="primary" disabled={selected.length !== 2} onClick={() => send({ type: "guess_waits", tiles: selected })}>提交猜牌</button>
    </div>
  );
}

function DoraPanel({ state }: { state: GameView }) {
  return (
    <div className="dora-panel">
      <div>
        <b>宝牌指示牌</b>
        <div className="revealed">
          {state.doraIndicators.map((tile, index) => <TileButton tile={tile} disabled key={`dora-${tile}-${index}`} />)}
        </div>
        <span>宝牌：{state.doraIndicators.map((tile) => tileLabel(doraFromIndicator(tile))).join("、") || "无"}</span>
      </div>
      {state.uraDoraIndicators.length > 0 && (
        <div>
          <b>里宝牌指示牌</b>
          <div className="revealed">
            {state.uraDoraIndicators.map((tile, index) => <TileButton tile={tile} disabled key={`ura-${tile}-${index}`} />)}
          </div>
          <span>里宝牌：{state.uraDoraIndicators.map((tile) => tileLabel(doraFromIndicator(tile))).join("、")}</span>
        </div>
      )}
      <div className="red-dora-note">{state.redDoraEnabled ? "红宝牌：赤五万 / 赤五筒 / 赤五索 各 1 张" : "红宝牌：关闭"}</div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function App() {
  const { connect, send, state, error, connected } = useSocket();
  const [url, setUrl] = useState(defaultWsUrl);
  const [name, setName] = useState("玩家");
  const [guess, setGuess] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | undefined>();
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);

  useEffect(() => {
    fetch("/api/host-info")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: HostInfo | null) => setHostInfo(data))
      .catch(() => setHostInfo(null));
  }, []);

  const me = useMemo(() => state?.players.find((player) => player.seat === state.you), [state]);
  const opponent = useMemo(() => state?.players.find((player) => player.seat !== state.you), [state]);
  const hand = sortTiles(me?.hand ?? []);
  const selectedTenpai = selectedTile ? state?.tenpaiOptions.find((option) => tileBase(option.discard) === tileBase(selectedTile)) : undefined;
  const canDiscard = state?.legalActions.includes("discard") ?? false;
  const canDeclare = (state?.legalActions.includes("declare_tenpai") ?? false) && !!selectedTenpai && !selectedTenpai.isFuriten;
  const canRiichi = (state?.legalActions.includes("riichi") ?? false) && !!selectedTenpai && !selectedTenpai.isFuriten;
  const canGuess = state?.legalActions.includes("guess_waits") ?? false;
  const canBurst = state?.legalActions.includes("draw_burst_action") ?? false;
  const canRestart = state?.legalActions.includes("restart_match") ?? false;
  const ankanTile = useMemo(() => {
    if (!state?.legalActions.includes("call_ankan")) return undefined;
    return hand.find((tile) => hand.filter((candidate) => tileBase(candidate) === tileBase(tile)).length >= 4);
  }, [state, hand]);
  const kakanTile = useMemo(() => {
    if (!state?.legalActions.includes("call_kakan") || !me) return undefined;
    return hand.find((tile) => me.melds.some((meld) => meld.kind === "pon" && meld.tiles.some((meldTile) => tileBase(meldTile) === tileBase(tile))));
  }, [state, hand, me]);
  const chiOptions = useMemo(() => {
    if (!state?.lastDiscard || !me?.hand || !state.legalActions.includes("call_chi")) return [];
    return findChiOptions(me.hand, state.lastDiscard.tile);
  }, [state, me]);

  useEffect(() => {
    if (selectedTile && !hand.some((tile) => tile === selectedTile)) setSelectedTile(undefined);
  }, [hand, selectedTile]);

  if (!connected || !state) {
    return (
      <main className="connect-screen">
        <div className="logo">FUTARI MAJ</div>
        <h1>二人麻将 · 听牌猜待牌</h1>
        <label>昵称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>房主 WebSocket 地址<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="wss://你的公网地址" /></label>
        <button className="primary" onClick={() => connect(url, name)}>连接 / 入座</button>
        {error && <p className="error">{error}</p>}
        {hostInfo && (
          <div className="host-info">
            <b>可分享地址</b>
            <div>本机页面：{hostInfo.local.httpUrl}</div>
            {hostInfo.addresses.map((address) => (
              <button key={address.wsUrl} type="button" onClick={() => setUrl(address.wsUrl)}>
                使用 {address.wsUrl}
              </button>
            ))}
          </div>
        )}
        <p className="hint">房主运行 <code>npm run host -- --port 8787</code>，另一位玩家填公网 IP 和端口。</p>
      </main>
    );
  }

  return (
    <main className="table">
      <header className="topbar">
        <div>
          <b>第 {state.round} 局 · {state.honba} 本场</b>
          <span>阶段：{state.phase} · 巡目 {Math.floor(state.turnDiscardCount / 2) + 1}/18 · 剩余 {formatTime(state.matchTimeLeftMs)}</span>
          <span>牌山 {state.wallCount} + 王牌 {state.deadWallCount}</span>
        </div>
        <div className="top-actions">
          <span>{state.you === "east" ? "你是东家" : "你是西家"}</span>
          {state.phase !== "game_over" && (
            <button className="danger" onClick={() => {
              if (window.confirm("结束整场对局并按当前点数结算？")) send({ type: "quit_game" });
            }}>结束对局</button>
          )}
        </div>
      </header>

      {opponent && <PlayerPanel player={opponent} isYou={false} />}

      <section className="center-board">
        <div className="message">{state.message}</div>
        <DoraPanel state={state} />
        {state.lastDiscard && <div>最后打出：{state.lastDiscard.seat === "east" ? "东家" : "西家"} {tileLabel(state.lastDiscard.tile)}</div>}
        {state.guessedTiles && <div>上次猜牌：{state.guessedTiles.map(tileLabel).join("、")}</div>}
        {state.guessHistory.length > 0 && <div>已猜：{state.guessHistory.map((guess) => `[${guess.map(tileLabel).join("、")}]`).join(" ")}</div>}
        {state.revealedAttackerHand && <div className="revealed">{state.revealedAttackerHand.map((tile, index) => <TileButton tile={tile} disabled key={`${tile}-${index}`} />)}</div>}
        {state.phase === "game_over" && state.gameOver && (
          <div className="game-over">
            <h2>对局结束</h2>
            <p>{state.gameOver.summary}</p>
            <div className="score-list">
              {state.players.map((player) => (
                <div className={player.seat === state.gameOver?.winner ? "winner" : ""} key={player.seat}>
                  {player.name}：{player.points} 点
                </div>
              ))}
            </div>
            <button className="primary" disabled={!canRestart} onClick={() => send({ type: "restart_match" })}>重新开始整场</button>
          </div>
        )}
        {canGuess && <GuessPanel selected={guess} setSelected={setGuess} send={send} />}
        {canBurst && (
          <div className="actions">
            <button className="primary" onClick={() => send({ type: "draw_burst_action", action: "tsumo" })}>自摸</button>
            <button onClick={() => send({ type: "draw_burst_action", action: "continue" })}>摸切继续</button>
          </div>
        )}
        {state.phase === "hand_over" && <button className="primary" onClick={() => send({ type: "next_hand" })}>下一局</button>}
      </section>

      {me && <PlayerPanel player={me} isYou />}

      <section className="hand-zone">
        <div className="waits">听牌提示：{state.tenpaiOptions.length ? state.tenpaiOptions.map((option) => `打${tileLabel(option.discard)}听${option.waits.map(tileLabel).join("/")}${option.isFuriten ? "(振听)" : ""}${option.isEmptyWait ? "(空听)" : ""}`).join("；") : state.waits.length ? state.waits.map(tileLabel).join("、") : "未听牌"}</div>
        <div className="hand">
          {hand.map((tile, index) => (
            <TileButton key={`${tile}-${index}`} tile={tile} selected={selectedTile === tile} disabled={!canDiscard} onClick={() => setSelectedTile(tile)} />
          ))}
        </div>
        <div className="actions">
          <button disabled={!canDiscard || !selectedTile} onClick={() => selectedTile && send({ type: "discard", tile: selectedTile })}>打出选中</button>
          <button disabled={!canDeclare || !selectedTile} onClick={() => selectedTile && send({ type: "declare_tenpai", discard: selectedTile })}>听牌宣言并打出</button>
          <button disabled={!canRiichi || !selectedTile} onClick={() => selectedTile && send({ type: "riichi", discard: selectedTile })}>立直并打出</button>
          <button disabled={!state.legalActions.includes("pass")} onClick={() => send({ type: "pass" })}>跳过鸣牌</button>
          <button disabled={!state.legalActions.includes("call_pon")} onClick={() => send({ type: "call_pon" })}>碰</button>
          <button disabled={!state.legalActions.includes("call_kan")} onClick={() => send({ type: "call_kan" })}>杠</button>
          <button disabled={!ankanTile} onClick={() => ankanTile && send({ type: "call_ankan", tile: ankanTile })}>暗杠</button>
          <button disabled={!kakanTile} onClick={() => kakanTile && send({ type: "call_kakan", tile: kakanTile })}>加杠</button>
        </div>
        {chiOptions.length > 0 && (
          <div className="chi-options">
            {chiOptions.map((tiles) => (
              <button key={tiles.join("-")} onClick={() => send({ type: "call_chi", tiles })}>
                吃 {tiles.map(tileLabel).join(" ")}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="toast">{error}</div>}
      <details className="debug">
        <summary>调试状态</summary>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </details>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
