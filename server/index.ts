import express from "express";
import { createServer } from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { FutariGame } from "./game";
import { ClientMessage } from "../shared/messages";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : Number(process.env.PORT ?? 8787);
const dev = args.includes("--dev");

const app = express();

app.use((req, res, next) => {
  const host = req.headers.host ?? "";
  if (host.startsWith("0.0.0.0")) {
    res.redirect(302, `http://localhost:${port}${req.url}`);
    return;
  }
  next();
});

app.get("/api/host-info", (_req, res) => {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => ({
      name: item.address,
      httpUrl: `http://${item.address}:${port}`,
      wsUrl: `ws://${item.address}:${port}`
    }));
  res.json({
    port,
    local: {
      httpUrl: `http://localhost:${port}`,
      wsUrl: `ws://localhost:${port}`
    },
    addresses
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", websocket: true });
});

if (!dev) {
  const dist = path.resolve(__dirname, "../dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (_req, res) => res.send("Dev WebSocket server is running. Open Vite at http://localhost:5173"));
}

const server = createServer(app);
const wss = new WebSocketServer({ server });
const game = new FutariGame();

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      game.handle(socket, msg);
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
    }
  });
  socket.on("close", () => game.removeSocket(socket));
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. The host may already be running.`);
    console.error(`Open http://localhost:${port}, or stop the old process before starting another one.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Futari Mahjong host listening on http://0.0.0.0:${port}`);
  console.log(`WebSocket endpoint: ws://<公网IP>:${port}`);
});
