import { io, type Socket } from "socket.io-client";

/**
 * 客户端 Socket.IO 单例（M6）
 * io() 连接自定义 server 挂载的 /api/socket；连接后上报 userId 供定向推送。
 */

let socket: Socket | null = null;

export function getSocket(userId: number): Socket {
  if (!socket) {
    socket = io({ path: "/api/socket" });
    socket.on("connect", () => {
      socket?.emit("register", userId);
    });
  }
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}
