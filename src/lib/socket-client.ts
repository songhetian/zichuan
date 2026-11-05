import { io, type Socket } from "socket.io-client";

/**
 * 客户端 Socket.IO 单例（M6）
 * io() 连接自定义 server 挂载的 /api/socket；连接后上报 userId 供定向推送。
 */

let socket: Socket | null = null;
// 当前登录用户的 userId：connect 回调按此上报（模块单例必须用变量而非闭包，
// 否则切换账号 / 重新登录后重连仍按第一个 userId 注册，推送会发给旧账号）
let currentUserId: number | null = null;

export function getSocket(userId: number): Socket {
  currentUserId = userId;
  if (!socket) {
    socket = io({ path: "/api/socket" });
    socket.on("connect", () => {
      if (currentUserId != null) socket?.emit("register", currentUserId);
    });
  } else if (socket.connected) {
    // 单例已在线但 userId 变化（切换账号不刷新页面）：立即重新上报
    socket.emit("register", userId);
  }
  return socket;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
  currentUserId = null;
}
