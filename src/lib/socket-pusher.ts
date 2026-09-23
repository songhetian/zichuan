import type { Server as IOServer } from "socket.io";

/**
 * 站内实时推送（Socket.io，M6）
 * Socket.IO 服务端单例与 userId→socket 映射在 app/api/socket/route.ts 注册；
 * 审批引擎落库后调用 pushNotificationLive，目标用户无在线连接时静默跳过（尽力而为）。
 */

export interface LiveNotification {
  requestId: number | null;
  title: string;
  content: string | null;
  createdAt: string;
}

/**
 * Socket.IO 服务端状态通过 globalThis 共享。
 * 原因：server.ts（raw Node/tsx 上下文）先把 Socket.IO 挂到 http server 并注册连接；
 * 但 Next 编译器会把 server actions 及其依赖打进另一份模块实例，模块级单例（let _io / Map）
 * 是两份，导致 server action 内 pushNotificationLive 读到 _io=null、静默丢弃推送。
 * 统一挂到 globalThis，让两份模块实例读写同一份 io 与 userId→socket 映射。
 */
const G_KEY = "__zichuan_socket_state__";

interface SocketState {
  io: IOServer | null;
  userSockets: Map<number, Set<string>>;
}

function state(): SocketState {
  const g = globalThis as Record<string, unknown>;
  if (!g[G_KEY]) {
    g[G_KEY] = { io: null, userSockets: new Map<number, Set<string>>() };
  }
  return g[G_KEY] as SocketState;
}

export function registerSocketServer(io: IOServer): void {
  state().io = io;
}

export function registerUserSocket(userId: number, socketId: string): void {
  const map = state().userSockets;
  const set = map.get(userId) ?? new Set<string>();
  set.add(socketId);
  map.set(userId, set);
}

export function unregisterUserSocket(socketId: string): void {
  const map = state().userSockets;
  for (const [userId, set] of map) {
    if (set.delete(socketId) && set.size === 0) {
      map.delete(userId);
    }
  }
}

export function pushNotificationLive(userId: number, notif: LiveNotification): void {
  const { io, userSockets } = state();
  const sockets = userSockets.get(userId);
  if (!io || !sockets || sockets.size === 0) return;
  for (const sid of sockets) {
    io.to(sid).emit("notification", notif);
  }
}
