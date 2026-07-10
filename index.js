const express = require('express');
const line = require('@line/bot-sdk');

const app = express();

// -------------------------------------------------------------
// [จุดที่ 1] วาง "ฐานข้อมูลจำลอง" ไว้ตรงนี้ (ใต้การเรียกใช้ Express/Line)
// -------------------------------------------------------------
const mockDatabase = {
  users: {},      // เก็บข้อมูลผู้ใช้งาน
  systemState: {
    isRoundOpen: false,   // สถานะระบบ: true = เปิดรอบ, false = ปิดรอบ
    currentRoundId: null  // ไอดีรอบปัจจุบัน
  },
  bets: [],       // เก็บโพยที่ส่งเข้ามา
  adminId: "U2fb9233e5c539ae3970cbd698e2e18db" // 🔑 เปลี่ยนเป็น LINE User ID จริงของคุณเพื่อทดสอบสิทธิ์แอดมิน
};

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 🛠️ ฟังก์ชันหลักในการรับข้อความ
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text.trim();
  const userId = event.source.userId; 
  let replyText = "";

  const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken
  });

  // -------------------------------------------------------------
  // [จุดที่ 2] แทรกระบบต่างๆ ไว้ในฟังก์ชัน handleEvent ตรงนี้
  // -------------------------------------------------------------

  // ===== 1. ระบบลงทะเบียน =====
  if (userMessage === "ลงทะเบียน") {
    if (mockDatabase.users[userId]) {
      replyText = `❌ คุณเคยลงทะเบียนแล้วในชื่อ: ${mockDatabase.users[userId].name}`;
    } else {
      let displayName = "ผู้ใช้งานจำลอง";
      try {
        const profile = await client.getProfile(userId);
        displayName = profile.displayName;
      } catch (e) {
        console.log("ดึงโปรไฟล์ไม่สำเร็จ (ใช้งานโหมดจำลอง)");
      }

      // บันทึกข้อมูลเข้าตัวแปรจำลอง
      mockDatabase.users[userId] = {
        name: displayName,
        credit: 0, 
        role: userId === mockDatabase.adminId ? "admin" : "member", 
        registeredAt: new Date().toISOString()
      };

      console.log("=== อัปเดตรายชื่อผู้เล่นในคอม ===", mockDatabase.users);

      replyText = `🎉 ลงทะเบียนสำเร็จ!\nยินดีต้อนรับคุณ ${displayName}\n💰 เครดิตเริ่มต้นของคุณ: 0\n(สิทธิ์: ${mockDatabase.users[userId].role})`;
    }

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  }

  // ===== 2. ระบบเปิดรอบ-ปิดรอบ สำหรับแอดมิน (แทรกต่อท้ายระบบลงทะเบียน) =====
  if (userMessage === "เปิดรอบ" || userMessage === "ปิดรอบ") {
    // 🔑 เช็คก่อนว่าคนพิมพ์ใช่แอดมินไหม
    if (userId !== mockDatabase.adminId) {
      replyText = "❌ คำสั่งนี้เฉพาะแอดมินเท่านั้นครับ!";
    } else {
      if (userMessage === "เปิดรอบ") {
        if (mockDatabase.systemState.isRoundOpen) {
          replyText = "⚠️ ระบบเปิดรอบอยู่แล้วครับ ไม่ต้องเปิดซ้ำ";
        } else {
          mockDatabase.systemState.isRoundOpen = true;
          mockDatabase.systemState.currentRoundId = `ROUND-${Date.now()}`; // สร้างไอดีรอบจากเวลาปัจจุบัน
          replyText = "🟢 เปิดรอบเรียบร้อย! สมาชิกสามารถส่งโพยเข้ามาได้แล้วครับ";
        }
      } else if (userMessage === "ปิดรอบ") {
        if (!mockDatabase.systemState.isRoundOpen) {
          replyText = "⚠️ ระบบปิดรอบอยู่แล้วครับ ไม่ต้องปิดซ้ำ";
        } else {
          mockDatabase.systemState.isRoundOpen = false;
          replyText = "🔴 ปิดรอบเรียบร้อย! งดรับโพยทุกกรณี";
        }
      }
      console.log("=== สถานะระบบปัจจุบัน ===", mockDatabase.systemState);
    }

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  }

  // (คำสั่งระบบที่ 3, 4, 5 ในอนาคต จะมาเขียนแทรกต่อตรงนี้...)

  return null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
