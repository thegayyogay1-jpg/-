const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 💡 ดึง Token จากตัวแปรบน Render อัตโนมัติเวลาอัปโหลดขึ้นจริง
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 📦 ฐานข้อมูลจำลองบนหน่วยความจำคอมพิวเตอร์ (ไม่เชื่อม Firebase ข้อมูลจะรีเซ็ตเมื่อ restart โค้ด)
let usersWallets = {};
let nextMemberId = 1;
let isRoundOpen = false; 
let roundBets = {};       // เก็บโพยแทงในรอบนั้นๆ
let currentRound = 0;     
let withdrawQueue = [];   // คิวรายการถอนเงิน

// ⚙️ การตั้งค่าระบบน้ำเต้าปูปลาประจำรอบ (เปลี่ยนค่าเมื่อแอดมินสั่งเปิดรอบใหม่)
let gameConfig = {
    pricePerSlot: 300,   // ราคาเริ่มต้นช่องละ 300 บาท
    maxSlots: 15         // จำกัดช่องแทงเริ่มต้นไม่เกิน 15 ช่องต่อตัว
};

// 🎲 ตัวแปลพักผลลัพธ์เต๋า 3 ลูกชั่วคราวที่แอดมินส่งเข้ามา เพื่อรอพิมพ์ ok ยืนยัน
let tempDiceResults = []; 

// 📋 ตารางคู่มือจับคู่หมายเลข
const itemNames = {
    "1": "น้ำเต้า",
    "2": "ปู",
    "3": "ปลา",
    "4": "กุ้ง",
    "5": "ไก่",
    "6": "เสือ"
};

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0]; 

            // 🔑 ระบุ ID แอดมินหลักของคุณ
            const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";

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

            // ==================== [ คำสั่งแอดมิน: ชถ (เช็กรายการรอถอนเงินทั้งหมด) ] ====================
            else if (userMsg.trim() === 'ชถ') {
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

            // ==================== [ 2. แอดมิน เปิด/ปิดรอบแทง น้ำเต้าปูปลา ] ====================
            // 💡 พิมพ์เปิดรอบแบบกำหนดราคาและช่องได้ เช่น: o 300 15 (ราคา 300 บาท สล็อตสูงสุด 15 ช่อง)
            // หรือถ้าพิมพ์แค่ o จะดึงค่าเริ่มต้น (300 บาท 15 ช่อง) ทันที
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
                            roundBets = {}; // ล้างข้อมูลโพยเก่าประจำรอบ

                            // อ่านค่าปรับตั้งราคาต่อช่องตามที่แอดมินพิมสั่งเปิดรอบ
                            const customPrice = parseFloat(args[1]);
                            const customMaxSlots = parseInt(args[2]);

                            if (!isNaN(customPrice) && customPrice > 0) gameConfig.pricePerSlot = customPrice;
                            if (!isNaN(customMaxSlots) && customMaxSlots > 0) gameConfig.maxSlots = customMaxSlots;

                            replyText = `📢 เริ่มเปิดรอบแทง [น้ำเต้าปูปลา] 🎉\n🎰 รอบที่: ${currentRound}\n💵 ล็อคราคา: ช่องละ ${gameConfig.pricePerSlot} บาท\n🔒 จำกัดจำนวน: ไม่เกิน ${gameConfig.maxSlots} ช่อง/ตัว\n──────────────────\n📋 รหัสสำหรับส่งโพย:\n1=น้ำเต้า , 2=ปู , 3=ปลา\n4=กุ้ง , 5=ไก่ , 6=เสือ\n📌 วิธีแทง: พิมพ์ [รหัส]-[จำนวนช่อง] เช่น 2-5 (แทงปู 5 ช่อง)`;
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
                            replyText = `🚫 ปิดรอบแทงเรียบร้อยแล้วครับ\n🏁 จบรอบที่: ${currentRound}\n──────────────────\n${closingBetSection}──────────────────\n🔒 หยุดรับโพยทุกกรณี รอแอดมินส่งผลสรุปเต๋าครับ`;
                        }
                    } else if (userMsg === 'rst') {
                        currentRound = 0;
                        isRoundOpen = false;
                        roundBets = {};
                        replyText = "🔄 ทำการรีเซ็ตระบบเป็นศูนย์เริ่มต้นใหม่เรียบร้อยครับ!";
                    }
                }
            }

            // ==================== [ 4. ระบบรับโพยน้ำเต้าปูปลา รูปแบบ รหัสตัวเลข-จำนวนช่อง ] ====================
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
                                errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้องในบรรทัด: "${line}"\n(ตัวอย่างแทง ปู 5 ช่อง ให้พิมพ์: 2-5)`;
                                break;
                            }

                            const itemCode = parts[0].trim(); // เช่น 2
                            const slotsCount = parseInt(parts[1].trim()); // เช่น 5

                            if (!itemNames[itemCode]) {
                                hasError = true;
                                errorMsg = `❌ รหัสสิ่งของไม่ถูกต้องในบรรทัด: "${line}"\n(ต้องเป็นเลข 1 ถึง 6 เท่านั้น)`;
                                break;
                            }

                            if (isNaN(slotsCount) || slotsCount <= 0 || slotsCount > gameConfig.maxSlots) {
                                hasError = true;
                                errorMsg = `❌ จำนวนช่องต้องเป็นตัวเลข และต้องอยู่ระหว่าง 1 ถึง ${gameConfig.maxSlots} ช่องครับ (เกิดปัญหาที่บรรทัด: "${line}")`;
                                break;
                            }

                            let lineCost = slotsCount * gameConfig.pricePerSlot; // 5 * 300 = 1500
                            totalCostAllLines += lineCost;

                            processedBets.push({
                                itemCode: itemCode,
                                itemName: itemNames[itemCode],
                                slotsCount: slotsCount,
                                totalCost: lineCost
                            });
                        }

                        if (hasError) {
                            replyText = errorMsg;
                        } else if (totalCostAllLines === 0) {
                            replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
                        } else if (user.balance < totalCostAllLines) {
                            replyText = `❌ เครดิตของคุณไม่เพียงพอ!\n💸 ยอดแทงของโพยนี้: ${totalCostAllLines} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                        } else {
                            // 📥 ตัดเครดิตจริงออกจากบัญชีสมาชิกทันทีเมื่อจดโพยสำเร็จ
                            user.balance -= totalCostAllLines;
                            
                            if (!roundBets[userId]) {
                                roundBets[userId] = [];
                            }

                            let summaryText = `✅ บันทึกโพยน้ำเต้าปูปลาเรียบร้อย 🎉\n──────────────────\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n──────────────────\n📝 รายการแทงประจำรอบนี้:\n`;
                            
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

            // ==================== [ 5. ระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
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
                            // คืนเครดิตยอดเล่นทั้งหมดที่หักไปตอนส่งโพย
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.totalCost, 0);
                            user.balance += totalRefund;
                            roundBets[userId] = []; // เคลียร์โพยรอบนี้ของเขาให้ว่าง

                            replyText = `🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้วครับ!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n💰 ระบบได้ทำการคืนเครดิตให้คุณ: +${totalRefund} บาท\n✨ ยอดเครดิตปัจจุบัน: ${user.balance} บาท`;
                        }
                    }
                }
            }

            // ==================== [ 8. แอดมินคีย์สรุปผลรางวัลด้วยเลขเต๋า 3 ลูก ] ====================
            // 💡 ตัวอย่างรูปแบบคำสั่งแอดมิน: >235 หมายถึงเต๋าออก ปู (2), ปลา (3), ไก่ (5)
            else if (originalMsg.startsWith('>')) {
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลครับ";
                } else if (isRoundOpen) {
                    replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (x) ก่อน จึงจะสามารถส่งผลรางวัลได้ครับ";
                } else {
                    let diceStr = originalMsg.substring(1).trim(); // ตัดเครื่องหมาย > ออกเหลือเลขล้วน เช่น 235
                    
                    if (diceStr.length !== 3) {
                        replyText = "⚠️ รูปแบบผลเต๋าไม่ถูกต้อง ต้องระบุรหัสเลขเรียงกัน 3 ตัวตรงๆ ครับ (เช่น >235)";
                    } else {
                        let tempDices = diceStr.split('');
                        let isValid = tempDices.every(char => ["1","2","3","4","5","6"].includes(char));

                        if (!isValid) {
                            replyText = "❌ ผลเต๋าไม่ถูกต้อง! ต้องใช้เลขรหัส 1 ถึง 6 เท่านั้นครับ";
                        } else {
                            tempDiceResults = tempDices; // บันทึกเก็บไว้ชั่วคราวเพื่อรอการยืนยัน ok

                            let diceNames = tempDiceResults.map(code => itemNames[code]);
                            replyText = `📊 ตรวจสอบผลรางวัล น้ำเต้าปูปลา รอบที่: ${currentRound}\n──────────────────\n🎲 ผลลูกเต๋า: [ ${diceNames.join(' , ')} ]\n──────────────────\n🚨 หากผลรางวัลถูกต้อง ให้พิมพ์: ok\nหากพิมพ์รหัสผิด ให้พิมพ์: no`;
                        }
                    }
                }
            }

            // ==================== [ 9. แอดมินยืนยันคำนวณแพ้ชนะจริง OK / NO ] ====================
            else if (userMsg === 'ok' || userMsg === 'no') {
                if (userId !== ADMIN_ID) return res.sendStatus(200);

                if (tempDiceResults.length === 0) {
                    replyText = "⚠️ ไม่มีข้อมูลผลรางวัลเต๋าค้างอยู่ในระบบครับ กรุณาส่งผลด้วยคำสั่ง > ก่อน";
                } else {
                    if (userMsg === 'ok') {
                        let diceNames = tempDiceResults.map(code => itemNames[code]);
                        let summaryPayoutText = `💰 สรุปยอดได้/เสีย น้ำเต้าปูปลา รอบที่: ${currentRound}\n──────────────────\n🎲 ผลออก: [ ${diceNames.join(' , ')} ]\n──────────────────\n`;
                        
                        let hasAnyStatement = false;

                        // วนลูปคำนวณบัญชีทุกคนที่มีโพยค้างในรอบนี้
                        for (let uId in roundBets) {
                            const userBetsArray = roundBets[uId];
                            if (!userBetsArray || userBetsArray.length === 0) continue;

                            const user = usersWallets[uId];
                            let totalWinAmount = 0; // ยอดเงินรางวัลรวมของรอบนี้ (ไม่รวมทุน)

                            userBetsArray.forEach((bet) => {
                                // นับจำนวนลูกเต๋าที่ออกตรงกับที่แทง
                                let matchCount = tempDiceResults.filter(diceCode => diceCode === bet.itemCode).length;
                                
                                if (matchCount > 0) {
                                    // 🧮 อ้างอิงสูตรตามกติกาที่คุณระบุ: 
                                    // หากเต๋าออกตรง 1 ลูก = 800 * จำนวนช่อง, ออกตรง 2 ลูก = 400 * จำนวนช่อง, 3 ลูก = 400 * จำนวนช่อง
                                    let ratePerSlot = (matchCount === 1) ? 800 : 400;
                                    let linePayout = ratePerSlot * bet.slotsCount;
                                    totalWinAmount += linePayout;
                                }
                            });

                            // จ่ายเงินคืนเข้ากระเป๋าจำลอง (เครดิตเดิมถูกหักออกไปตั้งแต่ตอนแทงแล้ว)
                            if (totalWinAmount > 0) {
                                user.balance += totalWinAmount;
                            }

                            summaryPayoutText += `👤 [ ${user.memberNumber} ] คุณ ${user.name}\n💰 ได้รับรางวัลสุทธิ: +${totalWinAmount} บาท\n✨ ยอดเครดิตคงเหลือ: ${user.balance} บาท\n──────────────────\n`;
                            hasAnyStatement = true;
                        }

                        if (!hasAnyStatement) {
                            summaryPayoutText += "ℹ️ ไม่มีสมาชิกท่านใดถูกรางวัลในรอบนี้ครับ";
                        }

                        // เคลียร์ค่าพักข้อมูลชั่วคราวเพื่อจบกระบวนการรอบนั้นๆ
                        roundBets = {};
                        tempDiceResults = [];
                        replyText = summaryPayoutText;

                    } else if (userMsg === 'no') {
                        tempDiceResults = [];
                        replyText = "❌ ยกเลิกผลการสุ่มเต๋าเรียบร้อย! แอดมินสามารถคีย์คำสั่ง > เพื่อส่งผลใหม่อีกครั้งได้เลยครับ";
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
                    // ทำการบันทึกข้อมูลเข้าตัวแปรฐานข้อมูลชั่วคราวบนคอมพิวเตอร์
                    usersWallets[userId] = {
                        memberNumber: nextMemberId++,
                        name: nameInput,
                        balance: 0, // เริ่มต้นด้วย 0 เครดิต
                        isWithdrawLocked: false,
                        pendingWithdrawAmount: 0
                    };
                    replyText = `🎉 สมัครสมาชิกน้ำเต้าปูปลาสำเร็จ!\n👤 เลขของคุณคือ: [ ${usersWallets[userId].memberNumber} ]\n📛 ชื่อเล่น: คุณ ${nameInput}\n💰 เครดิตกระเป๋าเริ่มต้น: 0 บาท\n🛒 สามารถแจ้งแอดมินเติมเครดิตเพื่อส่งโพยได้เลยครับ!`;
                }
            }

            // ==================== [ ระบบส่งข้อความ LINE กลับไปหาผู้เล่น ] ====================
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

app.get('/', (req, res) => { res.send('ระบบจำลองบอทน้ำเต้าปูปลา (Local Run Only) ทำงานปกติ'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`บอทน้ำเต้าปูปลารันบนพอร์ตที่: ${PORT}`); });
