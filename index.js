const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 💡 ดึง Token จากตัวแปรบน Render อัตโนมัติเวลาอัปโหลดขึ้นจริง
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 📦 ฐานข้อมูลจำลองบนหน่วยความจำคอมพิวเตอร์
let usersWallets = {};
let nextMemberId = 1;
let isRoundOpen = false; 
let roundBets = {};       // เก็บโพยแทงในรอบนั้นๆ
let currentRound = 0;     
let withdrawQueue = [];   // คิวรายการถอนเงิน
let gameHistory = []; // 📊 เพิ่มตัวแปรสำหรับเก็บสถิติผลรางวัลย้อนหลัง (เก็บสูงสุด 10 รอบ)

// ⚙️ การตั้งค่าระบบน้ำเต้าปูปลาประจำรอบ
let gameConfig = {
    pricePerSlot: 300,   // ราคาเริ่มต้นช่องละ 300 บาท
    maxSlots: 15         // จำกัดช่องแทงเริ่มต้นไม่เกิน 15 ช่องต่อตัว
};

let rewardConfig = {
    rank1: 800,
    rank2: 400,
    rank3: 400
};

// 🎲 ตัวแปลพักผลลัพธ์เต๋า 3 ลูกชั่วคราว
let tempDiceResults = []; 

// 📋 ตารางคู่มือจับคู่หมายเลข
const itemNames = {
    "1": "🍐น้ำเต้า",
    "2": "🦀ปู",
    "3": "🐟ปลา",
    "4": "🦐กุ้ง",
    "5": "🐔ไก่",
    "6": "🐯เสือ"
};

app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            // ลบช่องว่างออกทั้งหมดและทำเป็นตัวพิมพ์เล็ก เพื่อให้เช็กคำสั่งง่ายขึ้น
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0].toLowerCase(); // แปลงคำสั่งแรกเป็นตัวพิมพ์เล็กเพื่อรองรับ O หรือ X

            // 🔑 แปะ ID แอดมินใหม่ของคุณตรงนี้ได้เลยครับ!
            const ADMIN_ID = "U3626a40fd31e093004d3789e44d3a7cd";

            // ==================== [ 1. ระบบเติมเงิน/ลบเงิน ] ====================
            if (command === "เติม" || command === "ลบ") {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งจัดการเครดิตครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); 
                    const amount = parseFloat(args[2]);      

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            if (command === "เติม") {
                                usersWallets[foundUserKey].balance += amount;
                                const user = usersWallets[foundUserKey];
                                replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
                if (userMsg === 'เช็กไอดี') {
    replyText = `ID ใหม่ของคุณคือ: ${userId}`;
}
                // ==================== [ คำสั่งแอดมิน: /set ตั้งค่าราคาและจำนวนช่อง ] ====================
else if (command === '/s') {
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        const newPrice = parseFloat(args[1]);
        const newMaxSlots = parseInt(args[2]);

        if (isNaN(newPrice) || isNaN(newMaxSlots) || newPrice < 0 || newMaxSlots < 0) {
            replyText = "⚠️ รูปแบบไม่ถูกต้อง! กรุณาพิมพ์เช่น: /s 100 5 (ราคา 100 บาท จำกัด 5 ช่อง)";
        } else {
            gameConfig.pricePerSlot = newPrice;
            gameConfig.maxSlots = newMaxSlots;
            replyText = `⚙️ [ตั้งค่าสำเร็จ] บันทึกระบบเดิมพันใหม่:\n💵 ราคาต่อช่อง: ${gameConfig.pricePerSlot} บาท\n🔒 จำกัดสูงสุด: ${gameConfig.maxSlots} ช่อง/ตัว`;
        }
    }
}

// ==================== [ คำสั่งแอดมิน: /pay ตั้งค่ารางวัลอันดับ 1, 2, 3 ] ====================
else if (command === '/p') {
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        const r1 = parseFloat(args[1]);
        const r2 = parseFloat(args[2]);
        const r3 = parseFloat(args[3]);

        if (isNaN(r1) || isNaN(r2) || isNaN(r3) || r1 < 0 || r2 < 0 || r3 < 0) {
            replyText = "⚠️ รูปแบบไม่ถูกต้อง! กรุณาพิมพ์เช่น: /p 300 150 150 (อันดับ1 ได้ 300, อันดับ2 ได้ 150, อันดับ3 ได้ 150)";
        } else {
            rewardConfig.rank1 = r1;
            rewardConfig.rank2 = r2;
            rewardConfig.rank3 = r3;
            replyText = `🏆 [ตั้งค่าสำเร็จ] อัตราจ่ายเงินรางวัลใหม่:\n🥇 อันดับ 1 ➡️  ${rewardConfig.rank1} บ.\n🥈 อันดับ 2 ➡️  ${rewardConfig.rank2} บ.\n🥉 อันดับ 3 ➡️  ${rewardConfig.rank3} บ.`;
        }
    }
}

            // ==================== [ แอดมิน: เช็กเครดิตคงเหลือของทุกคน ] ====================
            else if (userMsg === "เช็กเครดิต" || userMsg === "เช็คเครดิต") {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งตรวจสอบนี้ครับ";
                } else {
                    let allUsers = Object.values(usersWallets);
                    if (allUsers.length === 0) {
                        replyText = "📋 ยอดเครดิตสมาชิกทั้งหมด\n──────────────────\nยังไม่มีผู้เล่นลงทะเบียนในระบบชั่วคราวนี้ครับ";
                    } else {
                        let report = "📋 ยอดเครดิตรวมสมาชิกทุกท่าน\n──────────────────\n";
                        allUsers.forEach(u => {
                            report += `• [ID: ${u.memberNumber}] คุณ ${u.name} ➡️ ยอดคงเหลือ: ${u.balance} บาท\n`;
                        });
                        replyText = report;
                    }
                }
            }

            // ==================== [ คำสั่งแอดมิน: ชถ (เช็กคิวถอนเงิน) ] ====================
            else if (userMsg === 'ชถ') {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    if (withdrawQueue.length === 0) {
                        replyText = "🎉 [ระบบคิวถอน] ไม่มีรายการค้างถอนในขณะนี้ครับ!";
                    } else {
                        let queueText = "📋 [รายการรอถอนเงินทั้งหมด] 📋\n────────────────\n";
                        withdrawQueue.forEach((item, index) => {
                            queueText += `${index + 1}. 👤 สมาชิกคนที่: ${item.memberNumber}\n`;
                            queueText += `   📛 ชื่อ: คุณ ${item.name}\n`;
                            queueText += `   💰 ยอดถอน: ${item.amount} บาท\n`;
                            queueText += `   🕒 เวลา: ${item.time} น.\n────────────────\n`;
                        });
                        queueText += `📌 รวมทั้งหมด: ${withdrawQueue.length} รายการ\n💡 วิธีเคลียร์คิวพิมพ์: y เลขสมาชิก`;
                        replyText = queueText;
                    }
                }
            }    

            // ==================== [ 2. แอดมิน เปิด/ปิดรอบแทง (รองรับเล็กใหญ่ O / X / RST) ] ====================
            else if (command === 'o' || userMsg === 'x' || userMsg === 'rst') {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบครับ";
                } else {
                    if (command === 'o') {
                        if (isRoundOpen) {
                            replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ`;
                        } else {
                            currentRound++;
                            isRoundOpen = true;
                            roundBets = {}; 

                            const customPrice = parseFloat(args[1]);
                            const customMaxSlots = parseInt(args[2]);

                            if (!isNaN(customPrice) && customPrice > 0) gameConfig.pricePerSlot = customPrice;
                            if (!isNaN(customMaxSlots) && customMaxSlots > 0) gameConfig.maxSlots = customMaxSlots;

                            replyText = `📢 เริ่มเปิดรอบแทง 🎉\n🎰 รอบที่: ${currentRound}\n💵 ล็อคราคา: ช่องละ ${gameConfig.pricePerSlot} บาท\n🔒 จำกัดจำนวน: ไม่เกิน ${gameConfig.maxSlots} ช่อง/ตัว\n──────────────────\n📋 รหัสสำหรับส่งโพย:\n1=🍐น้ำเต้า , 2=🦀ปู \n3=🐟ปลา , 4=🦐กุ้ง \n5=🐔ไก่ , 6=🐯เสือ\n📌 วิธีแทง: พิมพ์ [รหัส]-[จำนวนช่อง]\n👉 สามารถพิมพ์ติดกันได้ เช่น 123-5 (แทง 1,2,3 อย่างละ 5 ช่อง)`;
                        // 2. ดึงประวัติสถิติมาต่อท้ายบรรลัดล่างสุด
                            replyText += `\n──────────────────\n📊 สถิติผลรางวัล 10 รอบล่าสุด:\n──────────────────\n`;
                            if (gameHistory.length === 0) {
                                replyText += `• ยังไม่มีบันทึกสถิติ (ระบบจะเริ่มบันทึกเมื่อจบรอบนี้ครับ)`;
                            }else {
                                // วนลูปแสดงผลจากรอบล่าสุดลงไป (เรียงสวยๆ)
                                let chronologicalHistory = gameHistory.slice().reverse();
                    
                    chronologicalHistory.forEach((history) => {
                        replyText += `• รอบที่ ${history.round} ออก \n[ ${history.resultNames.join(' , ')} ]\n──────────────────\n`;
                                });
                            }
                        }
                    } else if (userMsg === 'x') {
                        if (!isRoundOpen) {
                            replyText = `⚠️ ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
                        } else {
                            isRoundOpen = false;
                            
                            let betSummaryText = "";
                            let hasAnyBet = false;

                            for (let uId in roundBets) {
                                const userBetsArray = roundBets[uId];
                                if (!userBetsArray || userBetsArray.length === 0) continue;

                                hasAnyBet = true;
                                const user = usersWallets[uId];
                                let userTotalBetAmt = userBetsArray.reduce((sum, b) => sum + b.totalCost, 0);
                                betSummaryText += `• [ ${user.memberNumber} ] ${user.name} ➡️ ยอดแทงรวม: ${userTotalBetAmt} บาท\n`;
                            }

                            let closingBetSection = hasAnyBet ? `📝 สรุปยอดแทงประจำรอบ:\n${betSummaryText}` : `📝 ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้`;
                            replyText = `🚫 ปิดรอบแทงแล้วครับ\n🏁 จบรอบที่: ${currentRound}\n──────────────────\n${closingBetSection}──────────────────\n🔒 หยุดรับโพยทุกกรณี รอแอดมินส่งผลสรุปเต๋าครับ`;
                        }
                    } else if (userMsg === 'rst') {
                        currentRound = 0;
                        isRoundOpen = false;
                        roundBets = {};
                        replyText = "🔄 ทำการรีเซ็ตระบบเป็นศูนย์เริ่มต้นใหม่เรียบร้อยครับ!";
                    }
                }
            }
                // ==================== [ คำสั่งแอดมิน: cc (ยกเลิกรอบกระทันหัน + คืนเงินทุกคน) ] ====================
else if (userMsg === 'cc') {
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งยกเลิกรอบครับ";
    } else {
        if (!isRoundOpen && Object.keys(roundBets).length === 0) {
            replyText = "⚠️ ไม่มีรอบที่เปิดอยู่ หรือไม่มีโพยค้างในระบบให้ยกเลิกครับ";
        } else {
            let refundSummaryText = `🚨 [ประกาศ] ยกเลิกรอบที่ ${currentRound} กระทันหัน! 🚨\n⚙️ ระบบทำการคืนเครดิตให้ผู้เล่นทุกคนเรียบร้อยแล้ว:\n──────────────────\n`;
            let hasAnyRefund = false;

            // วนลูปคืนเงินให้ทุกคนที่มีโพยค้างอยู่ในรอบนี้
            for (let uId in roundBets) {
                const userBetsArray = roundBets[uId];
                if (!userBetsArray || userBetsArray.length === 0) continue;

                const user = usersWallets[uId];
                // คำนวณยอดเงินรวมที่คนนี้แทงไปในรอบนี้
                let totalRefundAmt = userBetsArray.reduce((sum, b) => sum + b.totalCost, 0);
                
                // คืนยอดเงินเข้ากระเป๋าผู้เล่น
                user.balance += totalRefundAmt;
                
                refundSummaryText += `• [ID: ${user.memberNumber}] คุณ ${user.name} ➡️ คืนเครดิต: +${totalRefundAmt} บ.\n (ยอดรวม: ${user.balance} บ.)\n──────────────────\n`;
                hasAnyRefund = true;
            }

            if (!hasAnyRefund) {
                refundSummaryText += "ℹ️ รอบนี้ไม่มีสมาชิกส่งโพยค้างไว้ครับ (ไม่มีการคืนเงิน)";
            }

            // เคลียร์ค่าระบบเพื่อให้พร้อมเปิดรอบใหม่ แต่ไม่ลบ currentRound (เพื่อความต่อเนื่องของเลขรอบ หรือจะลดเครดิตรอบลงก็ได้)
            // ในที่นี้จะลด currentRound ลง 1 เพื่อให้รอบต่อไปเป็นเลขเดิมที่เพิ่งยกเลิกไปครับ
            if (currentRound > 0) currentRound--; 
            isRoundOpen = false;
            roundBets = {};
            tempDiceResults = [];

            refundSummaryText += `──────────────────\n🔄 รีเซ็ตสถานะห้องเรียบร้อย แอดมินสามารถพิมพ์คำสั่ง "o" เพื่อเปิดรอบใหม่ได้ทันทีครับ`;
            replyText = refundSummaryText;
        }
    }
}

            // ==================== [ 4. ระบบรับโพยน้ำเต้าปูปลา (รองรับรูปแบบติดกัน เช่น 123-5) ] ====================
            else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
                if (!isRoundOpen) {
                    replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบ\nกรุณาพิมพ์: C/ชื่อเล่น ของท่านเพื่อลงทะเบียนก่อนแทงครับ`;
                    } else {
                        const user = usersWallets[userId];
                        
                        if (user && user.isWithdrawLocked) {
                            replyText = `❌ คุณไม่สามารถส่งโพยได้เนื่องจากระบบค้างคิวถอนเงินอยู่ครับ`;
                            return res.sendStatus(200);
                        }

                        const lines = originalMsg.split(/\r?\n/);
                        let totalCostAllLines = 0;
                        let processedBets = [];
                        let hasError = false;
                        let errorMsg = "";

                        for (let line of lines) {
                            let cleanLine = line.trim();
                            if (cleanLine === "") continue;

                            const parts = cleanLine.split('-');
                            if (parts.length !== 2) {
                                hasError = true;
                                errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้องในบรรทัด: "${line}"\n(ตัวอย่างแทงมัดรวม ปู ปลา ไก่ ตัวละ 5 ช่อง ให้พิมพ์: 235-5)`;
                                break;
                            }

                            const itemCodesGroup = parts[0].trim(); // คืนค่าเป็นสตริงกลุ่มตัวเลข เช่น "123"
                            const slotsCount = parseInt(parts[1].trim());  // จำนวนช่อง เช่น 5

                            if (isNaN(slotsCount) || slotsCount <= 0 || slotsCount > gameConfig.maxSlots) {
                                hasError = true;
                                errorMsg = `❌ จำนวนช่องต้องอยู่ระหว่าง 1 ถึง ${gameConfig.maxSlots} ช่องครับ (เกิดปัญหาที่บรรทัด: "${line}")`;
                                break;
                            }

                            // แตกตัวแปรรหัสออกมาเป็นทีละตัว เช่น "123" -> ['1', '2', '3']
                            const individualCodes = itemCodesGroup.split('');

                            for (let code of individualCodes) {
                                if (!itemNames[code]) {
                                    hasError = true;
                                    errorMsg = `❌ รหัสสิ่งของ "${code}" ไม่ถูกต้องในบรรทัด: "${line}"\n(ต้องเป็นเลข 1 ถึง 6 เท่านั้น)`;
                                    break;
                                }

                                let lineCost = slotsCount * gameConfig.pricePerSlot;
                                totalCostAllLines += lineCost;

                                processedBets.push({
                                    itemCode: code,
                                    itemName: itemNames[code],
                                    slotsCount: slotsCount,
                                    totalCost: lineCost
                                });
                            }
                            if (hasError) break;
                        }

                        if (hasError) {
                            replyText = errorMsg;
                        } else if (totalCostAllLines === 0) {
                            replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
                        } else if (user.balance < totalCostAllLines) {
                            replyText = `❌ เครดิตของคุณไม่เพียงพอ!\n💸 ยอดแทงรวมของโพยนี้: ${totalCostAllLines} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                        } else {
                            // ตัดเครดิต
                            user.balance -= totalCostAllLines;
                            
                            if (!roundBets[userId]) {
                                roundBets[userId] = [];
                            }

                            let summaryText = `✅ บันทึกโพยน้ำเต้าปูปลาเรียบร้อย 🎉\n──────────────────\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n──────────────────\n📝 รายการแทงเพิ่มในรอบนี้:\n`;
                            
                            processedBets.forEach((bet) => {
                                summaryText += `• แทง ${bet.itemName} [ ${bet.slotsCount} ช่อง ] -> ${bet.totalCost} บ.\n`;
                                
                                roundBets[userId].push({
                                    name: user.name,
                                    memberNumber: user.memberNumber,
                                    itemCode: bet.itemCode,
                                    itemName: bet.itemName,
                                    slotsCount: bet.slotsCount,
                                    totalCost: bet.totalCost,
                                    time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                                });
                            });

                            summaryText += `──────────────────\n💵 ยอดหักเครดิตโพยนี้: ${totalCostAllLines} บาท\n💰 เครดิตคงเหลือ: ${user.balance} บาท`;
                            replyText = summaryText;
                        }
                    }
                }
            }

            // ==================== [ 5. ระบบคืนโพย (r) ] ====================
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากแอดมินปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    if (!usersWallets[userId]) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ`;
                    } else {
                        const user = usersWallets[userId];
                        const myBets = roundBets[userId];

                        if (!myBets || myBets.length === 0) {
                            replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ`;
                        } else {
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.totalCost, 0);
                            user.balance += totalRefund;
                            roundBets[userId] = []; 

                            replyText = `🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้วครับ!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n💰 ระบบได้ทำการคืนเครดิตให้คุณ: +${totalRefund} บาท\n✨ ยอดเครดิตปัจจุบัน: ${user.balance} บาท`;
                        }
                    }
                }
            }

            // ==================== [ 6. สมาชิกเช็กเครดิตและรายการแทงค้างของตัวเอง (c / C) ] ====================
            else if (userMsg === 'c') {
                if (!usersWallets[userId]) {
                    replyText = "📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบชั่วคราวนี้\nกรุณาพิมพ์: C/ชื่อเล่น เพื่อลงทะเบียนก่อนครับ";
                } else {
                    const user = usersWallets[userId];
                    let myCurrentRoundBets = roundBets[userId] || [];
                    
                    let walletText = `💳 ข้อมูลบัญชีของคุณ 💳\n──────────────────\n👤 ID สมาชิก: [ ${user.memberNumber} ]\n📛 ชื่อเล่น: คุณ ${user.name}\n💰 เครดิตคงเหลือ: ${user.balance} บาท\n──────────────────\n`;
                    
                    if (myCurrentRoundBets.length === 0) {
                        walletText += `🎰 โพยรอบปัจจุบัน: ไม่มีรายการแทงค้างคั่งในรอบนี้ครับ`;
                    } else {
                        walletText += `🎰 โพยรอบที่ ${currentRound} ที่คุณแทงค้างไว้:\n`;
                        let totalRoundSpent = 0;
                        myCurrentRoundBets.forEach((bet, idx) => {
                            walletText += `${idx + 1}. แทง ${bet.itemName} (${bet.slotsCount} ช่อง) -> ${bet.totalCost} บ.\n`;
                            totalRoundSpent += bet.totalCost;
                        });
                        walletText += `💰 ยอดเดิมพันรวมในรอบนี้: ${totalRoundSpent} บาท`;
                    }
                    replyText = walletText;
                }
            }

            // ==================== [ 8. แอดมินคีย์สรุปผลรางวัล ] ====================
            else if (originalMsg.startsWith('>')) {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลครับ";
                } else if (isRoundOpen) {
                    replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (x) ก่อน จึงจะสามารถส่งผลรางวัลได้ครับ";
                } else {
                    let diceStr = originalMsg.substring(1).trim(); 
                    
                    if (diceStr.length !== 3) {
                        replyText = "⚠️ รูปแบบผลเต๋าไม่ถูกต้อง ต้องระบุรหัสเลขเรียงกัน 3 ตัวตรงๆ ครับ (เช่น >235)";
                    } else {
                        let tempDices = diceStr.split('');
                        let isValid = tempDices.every(char => ["1","2","3","4","5","6"].includes(char));

                        if (!isValid) {
                            replyText = "❌ ผลเต๋าไม่ถูกต้อง! ต้องใช้เลขรหัส 1 ถึง 6 เท่านั้นครับ";
                        } else {
                            tempDiceResults = tempDices; 

                            let diceNames = tempDiceResults.map(code => itemNames[code]);
                            replyText = `📊 ตรวจสอบผลรางวัล น้ำเต้าปูปลา รอบที่: ${currentRound}\n──────────────────\n🎲 ผลออก\n [${diceNames.join(' , ')} ]\n──────────────────\n🚨 หากผลรางวัลถูกต้อง ให้พิมพ์: ok\nหากพิมพ์รหัสผิด ให้พิมพ์: no`;
                        }
                    }
                }
            }

            // ==================== [ 9. แอดมินยืนยันคำนวณแพ้ชนะจริง OK / NO (แก้ไขบั๊กออกเบิ้ล/ออกตองคิดเงินครบทุกตำแหน่ง) ] ====================
else if (userMsg === 'ok' || userMsg === 'no') {
    if (userId !== ADMIN_ID) return res.sendStatus(200);

    if (tempDiceResults.length === 0) {
        replyText = "⚠️ ไม่มีข้อมูลผลรางวัลเต๋าค้างอยู่ในระบบครับ กรุณาส่งผลด้วยคำสั่ง > ก่อน";
    } else {
        if (userMsg === 'ok') {
            let diceNames = tempDiceResults.map(code => itemNames[code]);
            
            // บันทึกผลรางวัลลงในสถิติย้อนหลัง
            gameHistory.unshift({
                round: currentRound,
                resultNames: diceNames
            });

            if (gameHistory.length > 10) {
                gameHistory.pop();
            }

            let summaryPayoutText = `💰 สรุปยอดได้/เสีย น้ำเต้าปูปลา รอบที่: ${currentRound}\n`;
                summaryPayoutText += `🥇 อันดับ 1 (จ่าย ${rewardConfig.rank1}): ${diceNames[0]}\n`;
                summaryPayoutText += `🥈 อันดับ 2 (จ่าย ${rewardConfig.rank2}): ${diceNames[1]}\n`;
                summaryPayoutText += `🥉 อันดับ 3 (จ่าย ${rewardConfig.rank3}): ${diceNames[2]}\n`;
                summaryPayoutText += `──────────────────\n`;
            
            let hasAnyStatement = false;

            for (let uId in roundBets) {
                const userBetsArray = roundBets[uId];
                if (!userBetsArray || userBetsArray.length === 0) continue;

                const user = usersWallets[uId];
                let totalWinAmount = 0; 
                let userDetailText = `👤 [ ${user.memberNumber} ] คุณ ${user.name}\n`;
                let hitAny = false;

                // วิ่งเช็กทีละรายการแทงในโพย
                userBetsArray.forEach((bet) => {
                    let itemWinAmount = 0; // ยอดชนะสะสมของโพยบรรทัดนี้ (รองรับกรณีออกเบิ้ล/ออกตอง)
                    let hitDetails = [];  // เก็บข้อความแจกแจงอันดับที่ถูก

                    // 🎯 เปลี่ยนเป็น IF แยกกันอิสระ 3 ตัว เพื่อเช็กครบทุกตำแหน่ง ไม่มีข้ามกรณีออกเบิ้ล
                    // เช็กอันดับ 1 (ซ้ายสุด)
                    if (bet.itemCode === tempDiceResults[0]) {
                        itemWinAmount += rewardConfig.rank1 * bet.slotsCount; // 🥇 ใช้ค่าที่ตั้งไว้แทนการใส่เลข 800 ตรงๆ
                        hitDetails.push(`อันดับ 1`);
                    }
                    // เช็กอันดับ 2 (ตรงกลาง)
                    if (bet.itemCode === tempDiceResults[1]) {
                        itemWinAmount += rewardConfig.rank2 * bet.slotsCount; // 🥈 ใช้ค่าที่ตั้งไว้แทนการใส่เลข 400 ตรงๆ
                        hitDetails.push(`อันดับ 2`);
                    }
                    // เช็กอันดับ 3 (ขวาสุด)
                    if (bet.itemCode === tempDiceResults[2]) {
                        itemWinAmount += rewardConfig.rank3 * bet.slotsCount; // 🥉 ใช้ค่าที่ตั้งไว้แทนการใส่เลข 400 ตรงๆ
                        hitDetails.push(`อันดับ 3`);
                    }

                    // ถ้ารายการแทงนี้ถูกรางวัลตำแหน่งใดตำแหน่งหนึ่ง (หรือหลายตำแหน่งหากออกเบิ้ล)
                    if (itemWinAmount > 0) {
                        hitAny = true;
                        totalWinAmount += itemWinAmount;
                        userDetailText += `  • 🎉 ถูก ${bet.itemName} [X${bet.slotsCount}]: ได้ +${itemWinAmount} บ.\n`;
                    }
                });

                if (hitAny) {
                    user.balance += totalWinAmount;
                    userDetailText += `  💰 รวมรับรอบนี้: +${totalWinAmount} บาท\n  ✨ เครดิตสุทธิ: ${user.balance} บาท\n`;
                } else {
                    userDetailText += `  ❌ รอบนี้ไม่ถูกรางวัล\n  ✨ เครดิตคงเหลือ: ${user.balance} บาท\n`;
                }

                summaryPayoutText += userDetailText + `──────────────────\n`;
                hasAnyStatement = true;
            }

            if (!hasAnyStatement) {
                summaryPayoutText += "ℹ️ ไม่มีสมาชิกท่านใดส่งโพยเดิมพันในรอบนี้ครับ";
            }

            roundBets = {};
            tempDiceResults = [];
            replyText = summaryPayoutText;

        } else if (userMsg === 'no') {
            tempDiceResults = [];
            replyText = "❌ ยกเลิกผลรางวัลเรียบร้อย! แอดมินสามารถคีย์คำสั่ง > เพื่อส่งผลใหม้อีกครั้งได้เลยครับ";
        }
    }
}
            // ==================== [ 10. ระบบลงทะเบียนสมาชิกใหม่ชั่วคราว (C/ชื่อ) ] ====================
            else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                const nameInput = originalMsg.substring(2).trim();
                if (nameInput === "") {
                    replyText = "⚠️ กรุณาระบุชื่อเล่นของคุณหลังเครื่องหมาย C/ ด้วยครับ เช่น C/น้องบอย";
                } else if (usersWallets[userId]) {
                    replyText = `❌ บัญชีไลน์นี้ลงทะเบียนแล้วในชื่อ: ${usersWallets[userId].name} (เลขสมาชิก: ${usersWallets[userId].memberNumber})`;
                } else {
                    usersWallets[userId] = {
                        memberNumber: nextMemberId++,
                        name: nameInput,
                        balance: 0, 
                        isWithdrawLocked: false,
                        pendingWithdrawAmount: 0
                    };
                    replyText = `🎉 สมัครสมาชิกน้ำเต้าปูปลาสำเร็จ!\n👤 เลขของคุณคือ: [ ${usersWallets[userId].memberNumber} ]\n📛 ชื่อเล่น: คุณ ${nameInput}\n💰 เครดิตกระเป๋าเริ่มต้น: 0 บาท\n🛒 สามารถแจ้งแอดมินเติมเครดิตเพื่อส่งโพยได้เลยครับ!`;
                }
            }

            // ==================== [ ระบบส่งข้อความ LINE กลับ ] ====================
            if (replyText) {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: replyText }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งข้อความกลับล้มเหลว:", error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('ระบบจำลองบอทน้ำเต้าปูปลาพร้อมฟังก์ชันมัดรวมโพย ทำงานปกติ'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`บอทน้ำเต้าปูปลารันบนพอร์ตที่: ${PORT}`); });
