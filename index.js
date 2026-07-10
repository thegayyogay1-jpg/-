const express = require('express');
const line = require('@line/bot-sdk');

const app = express();

// กำหนดค่าคอนฟิกของ LINE (ดึงค่ามาจาก Environment Variables บน Render)
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// หน้าแรกสำหรับเช็คว่า Webhook ทำงานไหม (เปิดดูผ่านเบราว์เซอร์ได้)
app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

// เส้นทางสำหรับรับ Webhook จาก LINE (ต้องใส่ middleware ของ LINE ก่อน)
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ฟังก์ชันสำหรับจัดการข้อความที่ผู้ใช้ส่งมา (ตอนนี้ตั้งให้เป็น "บอทนกแก้ว" ตอบกลับคำเดิม)
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  // ข้อความที่ผู้ใช้พิมพ์ส่งมา
  const userMessage = event.message.text;

  // สร้างข้อความตอบกลับ (Echo กลับไป)
  const echo = { type: 'text', text: `คุณพูดว่า: ${userMessage}` };

  // ส่งข้อความกลับไปหาผู้ใช้
  const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken
  });
  
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [echo],
  });
}

// กำหนด Port ให้ตรงกับที่ Render ต้องการ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
