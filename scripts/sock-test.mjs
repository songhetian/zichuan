import { io } from "socket.io-client";
const s = io("http://localhost:3000", { path: "/api/socket", transports: ["polling"], timeout: 3000 });
let done = false;
s.on("connect", () => { console.log("CONNECT_OK sid=" + s.id); done = true; s.close(); process.exit(0); });
s.on("connect_error", (e) => { console.log("CONNECT_ERROR=" + e.message); done = true; process.exit(1); });
setTimeout(() => { if (!done) { console.log("TIMEOUT"); process.exit(2); } }, 4000);
