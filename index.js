require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
const express = require('express');
const { analyzeSymbol, analyzePhysicsSymbol } = require('./analysis');

// --- CẤU HÌNH ---
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// --- CẤU HÌNH BOT CHỐNG LỖI POLLING ---
const bot = new TelegramBot(token, {
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Bắt lỗi polling để không bị crash app
bot.on("polling_error", (err) => {
    if (err && err.code !== 'EFATAL') {
        console.log(`[Polling Error] ${err.code || ''}: ${err.message || err}`);
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// TARGET_COINS TỐI ƯU - 60 COIN VOLATILITY CAO (giữ nguyên danh sách)
const TARGET_COINS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT',
    'BCHUSDT', 'FILUSDT', 'ALGOUSDT', 'NEARUSDT', 'UNIUSDT',
    'DOGEUSDT', 'ZECUSDT', '1000PEPEUSDT', 'ZENUSDT', 'HYPEUSDT',
    'WIFUSDT', 'MEMEUSDT', 'BOMEUSDT', 'POPCATUSDT', 'MYROUSDT',
    'DOGUSDT', 'TOSHIUSDT', 'MOGUSDT', 'TURBOUSDT', 'NFPUSDT',
    'PEOPLEUSDT', 'ARCUSDT', 'BTCDOMUSDT', 'TRUMPUSDT', 'DASHUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT',
    'TIAUSDT', 'INJUSDT', 'RNDRUSDT', 'FETUSDT', 'AGIXUSDT',
    'OCEANUSDT', 'JASMYUSDT', 'GALAUSDT', 'SANDUSDT', 'MANAUSDT',
    'ENJUSDT', 'CHZUSDT', 'APEUSDT', 'GMTUSDT', 'LDOUSDT'
];

// --- SUBSCRIBED USERS STORAGE IN-MEM (simple) ---
const subscribedUsers = new Map(); // chatId -> { userInfo, activatedAt }

// --- BIẾN TRẠNG THÁI ---
let signalCountToday = 0;
let isAutoAnalysisRunning = false;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// --- SERVER EXPRESS (KEEP-ALIVE) ---
app.get('/', (req, res) => {
    res.json({
        status: 'AI Trading Bot V3 is Running...',
        subscribedUsers: subscribedUsers.size,
        lastSignalCount: signalCountToday
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        users: subscribedUsers.size,
        signals: signalCountToday
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

// --- TIỆN ÍCH ---
function getVietnamTime() {
    return moment().tz("Asia/Ho_Chi_Minh");
}

function formatSignalMessage(data, signalIndex, source = 'AI_RSI') {
    // source: 'AI_RSI' or 'PHYSICS'
    const botLabel = source === 'PHYSICS' ? 'Physics Momentum' : 'AI TRADING V3/AI RSI';
    const icon = (data.direction === 'LONG' || data.side === 'LONG') ? '🟢' : '🔴';

    const fmt = (num) => {
        if (num === undefined || num === null) return 'N/A';
        const number = parseFloat(num);
        if (isNaN(number)) return 'N/A';
        if (number >= 1) return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        return number.toFixed(8).replace(/(?:\.0+|(\.\d+?)0+)$/,'$1');
    };

    const symbol = (data.symbol || data.symbolName || '').replace('USDT', '');
    const direction = (data.direction || data.side || '').toUpperCase();
    const entry = fmt(data.entry);
    const tp = fmt(data.tp);
    const sl = fmt(data.sl);
    const rr = data.rr !== undefined && data.rr !== null ? `${data.rr}` : '-';
    const conf = data.confidence !== undefined ? `${data.confidence}%` : (data.conf ? `${data.conf}%` : '-');

    const header = `🤖 Tín hiệu [${signalIndex} trong ngày]\n#${symbol} – [${direction}] 📌\n\n`;
    const body = `${icon} Entry: ${entry}\n🆗 Take Profit: ${tp}\n🙅‍♂️ Stop-Loss: ${sl}\n🪙 Tỉ lệ RR: ${rr} (Conf: ${conf})\n\n🧠 By Bot [${botLabel}]\n\n⚠️ Nhất định phải tuân thủ quản lý rủi ro – Đi tối đa 2-3% risk, Bot chỉ để tham khảo, win 3 lệnh nên ngưng`;

    return header + body;
}

async function broadcastToAllUsers(message) {
    let successCount = 0;
    let failCount = 0;

    for (const [chatId, userData] of subscribedUsers) {
        let retryCount = 0;
        const maxRetries = 3;
        let sent = false;

        while (retryCount < maxRetries && !sent) {
            try {
                await bot.sendMessage(chatId, message);
                successCount++;
                sent = true;
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                retryCount++;
                console.log(`❌ Lỗi gửi cho ${userData.userInfo.username || userData.userInfo.first_name || chatId} (lần ${retryCount}):`, (err && err.message) || err);

                if (retryCount >= maxRetries) {
                    failCount++;
                    // If forbidden, remove user
                    if (err && err.response && err.response.statusCode === 403) {
                        subscribedUsers.delete(chatId);
                        console.log(`🗑️ Đã xóa user bị chặn: ${userData.userInfo.username || userData.userInfo.first_name}`);
                    }
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
    }

    console.log(`📤 Broadcast: ${successCount} thành công, ${failCount} thất bại`);
    return { success: successCount, fail: failCount };
}

// --- AUTO REFRESH / SCANNER PHỐI HỢP 2 LOGIC ---
async function runAutoAnalysis() {
    if (isAutoAnalysisRunning) {
        console.log('⏳ Auto analysis đang chạy, bỏ qua...');
        return;
    }

    // Circuit breaker
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log('🚨 Circuit breaker activated - Too many consecutive errors. Skipping this analysis cycle.');
        return;
    }

    const now = getVietnamTime();
    const currentHour = now.hours();
    const currentMinute = now.minutes();

    // operating hours unchanged
    if (currentHour < 4 || (currentHour === 23 && currentMinute > 30)) {
        console.log('💤 Out of operating hours (04:00 - 23:30). Sleeping...');
        return;
    }

    if (subscribedUsers.size === 0) {
        console.log('👥 No subscribed users. Skipping auto analysis.');
        return;
    }

    isAutoAnalysisRunning = true;
    console.log(`🔄 Starting Auto Analysis at ${now.format('HH:mm')} - ${subscribedUsers.size} users`);

    let signalsFound = 0;
    let analyzedCount = 0;

    try {
        for (const coin of TARGET_COINS) {
            analyzedCount++;

            // dynamic polite delay (keeps from hammering single source)
            const dynamicDelay = 2000 + (Math.floor(analyzedCount / 10) * 500) + (Math.random() * 1000);
            await new Promise(r => setTimeout(r, dynamicDelay));

            try {
                console.log(`🔍 Analyzing (AI RSI) ${coin} (${analyzedCount}/${TARGET_COINS.length})...`);
                const result_rsi = await analyzeSymbol(coin); // logic cũ (ICT)
                if (result_rsi && result_rsi.direction && result_rsi.direction !== 'NO_TRADE') {
                    if ((result_rsi.confidence || 0) >= 60) {
                        signalCountToday++;
                        signalsFound++;
                        const msg = formatSignalMessage(result_rsi, signalCountToday, 'AI_RSI');
                        console.log(`✅ [AI_RSI] Signal found: ${coin} ${result_rsi.direction} (${result_rsi.confidence}%)`);
                        await broadcastToAllUsers(msg);
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        console.log(`⏭️ [AI_RSI] Skip ${coin}: Confidence ${result_rsi.confidence}%`);
                    }
                } else {
                    console.log(`➖ [AI_RSI] No signal for ${coin}: ${result_rsi?.direction || 'NO_TRADE'}`);
                }
            } catch (errAI) {
                console.error(`❌ Error (AI_RSI) analyzing ${coin}:`, errAI.message || errAI);
                // if rate-limit-like errors, track consecutiveErrors
                if ((errAI.message || '').includes('418') || (errAI.message || '').includes('429')) {
                    consecutiveErrors++;
                    console.log(`🚨 Consecutive errors: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`);
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        console.log('🔌 Circuit breaker triggered! Waiting 10 minutes...');
                        setTimeout(() => {
                            consecutiveErrors = 0;
                            console.log('🔋 Circuit breaker reset');
                        }, 10 * 60 * 1000);
                        break;
                    }
                } else {
                    consecutiveErrors = 0;
                }
            }

            // Giữa hai logic, thêm delay nhỏ
            await new Promise(r => setTimeout(r, 500));

            // Physics Momentum logic
            try {
                console.log(`🔍 Analyzing (Physics) ${coin} (${analyzedCount}/${TARGET_COINS.length})...`);
                const result_phy = await analyzePhysicsSymbol(coin); // physics logic
                if (result_phy && result_phy.side) {
                    // map to direction field for homogeneous formatting
                    result_phy.direction = result_phy.side;
                    // confidence threshold — set 60 minimum
                    if ((result_phy.confidence || 0) >= 60) {
                        signalCountToday++;
                        signalsFound++;
                        const msg = formatSignalMessage(result_phy, signalCountToday, 'PHYSICS');
                        console.log(`✅ [PHYSICS] Signal found: ${coin} ${result_phy.side} (${result_phy.confidence}%)`);
                        await broadcastToAllUsers(msg);
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        console.log(`⏭️ [PHYSICS] Skip ${coin}: Confidence ${result_phy.confidence}%`);
                    }
                } else {
                    console.log(`➖ [PHYSICS] No signal for ${coin}`);
                }
            } catch (errPhy) {
                console.error(`❌ Error (Physics) analyzing ${coin}:`, errPhy.message || errPhy);
                // treat rate-limit similarly
                if ((errPhy.message || '').includes('418') || (errPhy.message || '').includes('429')) {
                    consecutiveErrors++;
                    console.log(`🚨 Consecutive errors: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`);
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        console.log('🔌 Circuit breaker triggered! Waiting 10 minutes...');
                        setTimeout(() => {
                            consecutiveErrors = 0;
                            console.log('🔋 Circuit breaker reset');
                        }, 10 * 60 * 1000);
                        break;
                    }
                } else {
                    consecutiveErrors = 0;
                }
            }

            // small polite delay between coins
            await new Promise(r => setTimeout(r, 800));
        }

        console.log(`🎯 Auto analysis completed. Found ${signalsFound} signals out of ${TARGET_COINS.length} coins`);
    } catch (error) {
        console.error('💥 Critical error in auto analysis:', error);
    } finally {
        isAutoAnalysisRunning = false;
    }
}

// Gửi lời chào mỗi ngày mới (Reset count)
function checkDailyGreeting() {
    const now = getVietnamTime();
    if (now.hours() === 4 && now.minutes() === 0) {
        signalCountToday = 0;
        const greetingMsg = "🌞 Chào ngày mới các nhà giao dịch! AI Trading đã sẵn sàng săn tìm cơ hội. Chúc mọi người Big Win! 🚀";
        broadcastToAllUsers(greetingMsg);
        console.log('🌞 Đã gửi lời chào buổi sáng');
    }
}

// Thiết lập Interval: 
// 1. Quét tín hiệu 2 giờ/lần (giữ theo code gốc)
const ANALYSIS_INTERVAL = 1 * 60 * 60 * 1000;
setInterval(runAutoAnalysis, ANALYSIS_INTERVAL);

// 2. Kiểm tra giờ chào mỗi phút
setInterval(checkDailyGreeting, 60 * 1000);

// Chạy phân tích ngay khi khởi động (sau 10s)
setTimeout(() => {
    runAutoAnalysis();
}, 10000);

// --- BOT COMMANDS ---
// /start - đăng ký nhận tín hiệu
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    const userInfo = {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name
    };

    const userData = {
        userInfo: userInfo,
        activatedAt: new Date()
    };

    subscribedUsers.set(chatId, userData);

    const welcomeMsg = `👋 Chào ${user.first_name || 'Trader'}!\n\n🧠 Bạn đã được đăng ký nhận tín hiệu tự động từ AI Trading Bot V3.\n\n🔔 Chỉ cần chờ bot gửi tín hiệu — tuân thủ quản lý rủi ro.`;
    bot.sendMessage(chatId, welcomeMsg);
    console.log(`✅ User subscribed: ${user.username || user.first_name} (ID: ${user.id})`);
});

// /signal manual (bất kỳ user nào có thể gửi)
bot.onText(/\/signal (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1].trim();
    // format expected: SYMBOL LONG/SHORT ENTRY SL TP
    const parts = text.split(/\s+/);
    if (parts.length < 5) {
        return bot.sendMessage(chatId, '❌ Sai format. /signal SYMBOL LONG/SHORT ENTRY SL TP');
    }
    const symbol = parts[0].toUpperCase();
    const direction = parts[1].toUpperCase();
    const entry = parseFloat(parts[2]);
    const sl = parseFloat(parts[3]);
    const tp = parseFloat(parts[4]);
    if (!['LONG','SHORT'].includes(direction) || isNaN(entry) || isNaN(sl) || isNaN(tp)) {
        return bot.sendMessage(chatId, '❌ Sai giá trị. Hãy kiểm tra lại.');
    }
    signalCountToday++;
    const rr = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);
    const result = {
        symbol,
        direction,
        entry,
        sl,
        tp,
        rr,
        confidence: 100
    };
    const msgText = formatSignalMessage({
        symbol,
        direction,
        entry,
        sl,
        tp,
        rr,
        confidence: 100
    }, signalCountToday, 'AI_RSI');
    const res = await broadcastToAllUsers(msgText);
    bot.sendMessage(chatId, `✅ Đã gửi tín hiệu đến ${res.success} thành viên, thất bại ${res.fail}`);
});

// /analyzesymbol [COIN] - phân tích 1 coin ngay lập tức (bất kỳ user)
// Kết quả trả về cả 2 logic nếu có
bot.onText(/\/analyzesymbol (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match[1].trim().toUpperCase();
    let symbol = raw;
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    const processingMsg = await bot.sendMessage(chatId, `⏳ Đang phân tích ${symbol}...`);

    try {
        // AI RSI logic
        const res_rsi = await analyzeSymbol(symbol).catch(e => { console.error(e); return null; });
        if (res_rsi && res_rsi.direction && res_rsi.direction !== 'NO_TRADE') {
            const txt = formatSignalMessage(res_rsi, 'MANUAL', 'AI_RSI');
            await bot.sendMessage(chatId, `🔎 Kết quả AI_RSI:\n\n${txt}`);
        } else {
            await bot.sendMessage(chatId, `🔎 Kết quả AI_RSI: Không tìm thấy tín hiệu cho ${symbol}`);
        }

        // Physics logic
        const res_phy = await analyzePhysicsSymbol(symbol).catch(e => { console.error(e); return null; });
        if (res_phy && res_phy.side) {
            res_phy.direction = res_phy.side;
            const txt2 = formatSignalMessage(res_phy, 'MANUAL', 'PHYSICS');
            await bot.sendMessage(chatId, `🔎 Kết quả Physics Momentum:\n\n${txt2}`);
        } else {
            await bot.sendMessage(chatId, `🔎 Kết quả Physics Momentum: Không tìm thấy tín hiệu cho ${symbol}`);
        }
    } catch (err) {
        console.error('Error analyze single symbol:', err);
        await bot.sendMessage(chatId, `❌ Lỗi khi phân tích ${symbol}: ${(err && err.message) || err}`);
    } finally {
        try { bot.deleteMessage(chatId, processingMsg.message_id); } catch (e) {}
    }
});

console.log('🤖 Bot is running with improved polling...');
console.log(`⏰ Auto analysis every 1 hours (04:00 - 23:30)`);
console.log(`🎯 Min confidence: 60% | Target coins: ${TARGET_COINS.length}`);
