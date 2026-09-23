import { Server as IOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import {
  registerSocketServer,
  registerUserSocket,
  unregisterUserSocket,
} from "./socket-pusher";

/**
 * Socket.IO 服务端单例（M6）
 * 由 app/api/socket/route.ts 首次调用时创建并挂载到 Next.js 的 Node http.Server，
 * 幂等复用；开发热重载下不重复创建。
 */

let io: IOServer | null = null;

export function getSocketServer(httpServer: HttpServer): IOServer {
  if (io) return io;
  io = new IOServer(httpServer, { path: "/api/socket" });
  io.on("connection", (socket) => {
    // 客户端连接后上报自己是谁（userId），用于按人定向推送
    socket.on("register", (userId: unknown) => {
      if (typeof userId === "number") {
        registerUserSocket(userId, socket.id);
      }
    });
    socket.on("disconnect", () => {
      unregisterUserSocket(socket.id);
    });
  });
  registerSocketServer(io);
  return io;
}
