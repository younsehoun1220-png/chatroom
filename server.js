const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더의 index.html 제공
app.use(express.static(path.join(__dirname, "public")));

// 비밀번호 설정
const GUEST_PASSWORD = "사랑";
const HOST_PASSWORD = "1234";

// 채팅방 상태 저장 (메모리)
let hostSocketId = null;
let participants = []; // { id, name, isHost }
let waitingGuests = []; // { id, name }

function broadcastRoomState() {
  io.emit("roomState", {
    hasHost: Boolean(hostSocketId),
    participants,
  });
  if (hostSocketId) {
    io.to(hostSocketId).emit("waitingList", waitingGuests);
  }
}

io.on("connection", (socket) => {
  // 1. 방장 입장 요청
  socket.on("hostEnter", ({ password }) => {
    if (password !== HOST_PASSWORD) {
      socket.emit("errorMsg", "방장 암호가 올바르지 않습니다.");
      return;
    }
    if (hostSocketId && hostSocketId !== socket.id) {
      socket.emit("errorMsg", "이미 방장이 접속해 있습니다.");
      return;
    }

    hostSocketId = socket.id;
    participants = participants.filter((p) => p.id !== socket.id);
    participants.unshift({ id: socket.id, name: "주원(방장)", isHost: true });

    socket.emit("enterSuccess", { isHost: true, name: "주원(방장)" });
    io.emit("systemMsg", "방장이 입장하여 채팅방이 열렸습니다.");
    broadcastRoomState();
  });

  // 2. 손님 입장 요청
  socket.on("guestRequest", ({ nickname, password }) => {
    const cleanName = (nickname || "").trim();
    if (!cleanName) {
      socket.emit("errorMsg", "닉네임을 입력해 주세요.");
      return;
    }
    if (password !== GUEST_PASSWORD) {
      socket.emit("errorMsg", "입장 비밀번호가 틀렸습니다.");
      return;
    }
    if (!hostSocketId) {
      socket.emit("errorMsg", "방장이 먼저 들어와야 입장할 수 있어요.");
      return;
    }

    // 중복 대기 방지
    waitingGuests = waitingGuests.filter((g) => g.id !== socket.id);
    waitingGuests.push({ id: socket.id, name: cleanName });

    socket.emit("waitingStarted", { name: cleanName });
    broadcastRoomState();
  });

  // 3. 방장: 대기자 수락
  socket.on("approveGuest", (guestId) => {
    if (socket.id !== hostSocketId) return;
    const guest = waitingGuests.find((g) => g.id === guestId);
    if (!guest) return;

    waitingGuests = waitingGuests.filter((g) => g.id !== guestId);
    participants.push({ id: guest.id, name: guest.name, isHost: false });

    io.to(guest.id).emit("enterSuccess", { isHost: false, name: guest.name });
    io.emit("systemMsg", `${guest.name}님이 채팅방에 들어왔습니다.`);
    broadcastRoomState();
  });

  // 4. 방장: 대기자 거절
  socket.on("rejectGuest", (guestId) => {
    if (socket.id !== hostSocketId) return;
    const guest = waitingGuests.find((g) => g.id === guestId);
    if (!guest) return;

    waitingGuests = waitingGuests.filter((g) => g.id !== guestId);
    io.to(guest.id).emit("rejected", "방장이 입장을 거절했습니다.");
    broadcastRoomState();
  });

  // 5. 방장: 손님 내보내기(강퇴)
  socket.on("kickParticipant", (targetId) => {
    if (socket.id !== hostSocketId || targetId === hostSocketId) return;
    const target = participants.find((p) => p.id === targetId);
    if (!target) return;

    participants = participants.filter((p) => p.id !== targetId);
    io.to(targetId).emit("kicked", "방장에 의해 채팅방에서 내보내졌습니다.");
    io.emit("systemMsg", `방장이 ${target.name}님을 내보냈습니다.`);
    broadcastRoomState();
  });

  // 6. 실시간 채팅 메시지 전송
  socket.on("sendMessage", (text) => {
    const sender = participants.find((p) => p.id === socket.id);
    const cleanText = (text || "").trim();
    if (!sender || !cleanText) return;

    io.emit("chatMessage", {
      senderId: socket.id,
      senderName: sender.name,
      text: cleanText,
    });
  });

  // 7. 방장: 방 닫기
  socket.on("closeRoom", () => {
    if (socket.id !== hostSocketId) return;
    io.emit("roomClosed", "방장이 채팅방을 닫았습니다.");
    hostSocketId = null;
    participants = [];
    waitingGuests = [];
  });

  // 8. 연결 종료 처리
  socket.on("disconnect", () => {
    waitingGuests = waitingGuests.filter((g) => g.id !== socket.id);

    if (socket.id === hostSocketId) {
      io.emit("roomClosed", "방장이 나가서 채팅방이 종료되었습니다.");
      hostSocketId = null;
      participants = [];
      waitingGuests = [];
      return;
    }

    const leftUser = participants.find((p) => p.id === socket.id);
    if (leftUser) {
      participants = participants.filter((p) => p.id !== socket.id);
      io.emit("systemMsg", `${leftUser.name}님이 나갔습니다.`);
      broadcastRoomState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`가족채팅방 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
