const axios = require('axios');

// --- MULTIPLE DATA SOURCES ---
const DATA_SOURCES = [
    {
        name: 'Binance Main',
        klines: (symbol, interval, limit = 500) =>
            `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        priority: 1
    },
    {
        name: 'Binance Backup 1',
        klines: (symbol, interval, limit = 500) =>
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        priority: 2
    },
    {
        name: 'Bybit Backup',
        klines: (symbol, interval, limit = 500) => {
            const mapping = { '1d': 'D', '4h': '240', '1h': '60', '15m': '15' };
            return `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${mapping[interval] || '60'}&limit=${limit}`;
        },
        priority: 3
    }
];

const TIMEFRAMES = [
    { label: 'D1', interval: '1d', weight: 1.5 },
    { label: 'H4', interval: '4h', weight: 1.3 },
    { label: 'H1', interval: '1h', weight: 1.1 },
    { label: '15M', interval: '15m', weight: 0.8 }
];

// --- SMART CANDLE LOADER VỚI MULTI-SOURCE FALLBACK ---
async function loadCandles(symbol, interval, limit = 500) {
    const sources = [...DATA_SOURCES].sort((a, b) => a.priority - b.priority);

    for (const source of sources) {
        try {
            console.log(`📡 Thử nguồn: ${source.name} cho ${symbol} ${interval}`);

            const url = source.klines(symbol, interval, limit);
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            });

            if (response.status === 200 && response.data) {
                let candles;

                // Xử lý định dạng response khác nhau
                if (source.name.includes('Bybit')) {
                    // Bybit response format
                    if (response.data && response.data.result && response.data.result.list) {
                        candles = response.data.result.list.map(candle => ({
                            open: parseFloat(candle[1]),
                            high: parseFloat(candle[2]),
                            low: parseFloat(candle[3]),
                            close: parseFloat(candle[4]),
                            vol: parseFloat(candle[5]),
                            t: parseFloat(candle[0])
                        })).reverse();
                    } else {
                        throw new Error('Invalid Bybit response format');
                    }
                } else {
                    // Binance format
                    candles = response.data.map(candle => ({
                        open: parseFloat(candle[1]),
                        high: parseFloat(candle[2]),
                        low: parseFloat(candle[3]),
                        close: parseFloat(candle[4]),
                        vol: parseFloat(candle[5]),
                        t: candle[0]
                    }));
                }

                if (candles.length > 0) {
                    console.log(`✅ Thành công với ${source.name}: ${candles.length} nến`);
                    return candles;
                }
            }
        } catch (error) {
            console.log(`❌ ${source.name} thất bại: ${error.response?.status || error.code || ''} - ${error.message}`);

            // Nếu là lỗi 418/429, chờ lâu hơn trước khi thử nguồn tiếp theo
            if (error.response?.status === 418 || error.response?.status === 429) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            continue; // Thử nguồn tiếp theo
        }
    }

    throw new Error(`Tất cả nguồn đều thất bại cho ${symbol}`);
}

// ------------------ (Nguyên bản) các hàm phân tích ICT / advanced structure / OB / FVG / volume ... ------------------
// Tôi giữ nguyên toàn bộ logic cũ như bạn gửi: calculateATR, isSwingHigh, isSwingLow, analyzeAdvancedMarketStructure,
// detectBreakOfStructure, detectChangeOfCharacter, findOrderBlocks, findFairValueGaps, analyzeVolumeProfile,
// calculateVolumeDelta, findLiquidityLevels, analyzeTimeframeICT, calculateTrendStrength, filterRelevantLevels,
// calculateTimeframeConfidence, calculateRealConfidence, getTimeframeWeight, calculateTFScoreICT,
// calculateConfluenceBonus, calculateMultiTFBias, findOptimalLongEntry, findOptimalShortEntry,
// calculateSmartStopLoss, calculateSmartTakeProfit, validateLevels, calculateSmartLevels, calculatePositionSize
// (Để ngắn gọn ở đây tôi giữ nguyên từ code bạn gửi, không sửa nội dung.)
// --- Paste nguyên các hàm từ mã gốc (giữ nguyên) ---

// START: copy of your original functions (kept intact)
function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return 0;

    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
        );
        trValues.push(tr);
    }

    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trValues.length; i++) {
        atr = (atr * (period - 1) + trValues[i]) / period;
    }

    return atr;
}

function isSwingHigh(highs, index, lookback = 3) {
    for (let i = 1; i <= lookback; i++) {
        if (index - i >= 0 && highs[index] <= highs[index - i]) return false;
        if (index + i < highs.length && highs[index] <= highs[index + i]) return false;
    }
    return true;
}

function isSwingLow(lows, index, lookback = 3) {
    for (let i = 1; i <= lookback; i++) {
        if (index - i >= 0 && lows[index] >= lows[index - i]) return false;
        if (index + i < lows.length && lows[index] >= lows[index + i]) return false;
    }
    return true;
}

function analyzeAdvancedMarketStructure(candles) {
    if (!candles || candles.length < 10) {
        return { swingHighs: [], swingLows: [], trend: 'neutral', breakOfStructure: false, changeOfCharacter: false };
    }

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const structure = {
        swingHighs: [],
        swingLows: [],
        trend: 'neutral',
        breakOfStructure: false,
        changeOfCharacter: false
    };

    for (let i = 3; i < candles.length - 3; i++) {
        if (isSwingHigh(highs, i)) {
            structure.swingHighs.push({ index: i, price: highs[i], time: candles[i].t });
        }
        if (isSwingLow(lows, i)) {
            structure.swingLows.push({ index: i, price: lows[i], time: candles[i].t });
        }
    }

    if (structure.swingHighs.length >= 2 && structure.swingLows.length >= 2) {
        const recentHighs = structure.swingHighs.slice(-2);
        const recentLows = structure.swingLows.slice(-2);

        if (recentHighs[1].price > recentHighs[0].price && recentLows[1].price > recentLows[0].price) {
            structure.trend = 'bullish';
        } else if (recentHighs[1].price < recentHighs[0].price && recentLows[1].price < recentLows[0].price) {
            structure.trend = 'bearish';
        }
    }

    structure.breakOfStructure = detectBreakOfStructure(structure);
    structure.changeOfCharacter = detectChangeOfCharacter(structure);

    return structure;
}

function detectBreakOfStructure(structure) {
    if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) return false;

    const recentHighs = structure.swingHighs.slice(-3);
    const recentLows = structure.swingLows.slice(-3);

    if (structure.trend === 'bullish') {
        return recentHighs[2].price > recentHighs[1].price && recentHighs[1].price > recentHighs[0].price;
    } else if (structure.trend === 'bearish') {
        return recentLows[2].price < recentLows[1].price && recentLows[1].price < recentLows[0].price;
    }
    return false;
}

function detectChangeOfCharacter(structure) {
    if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) return false;

    const recentHighs = structure.swingHighs.slice(-3);
    const recentLows = structure.swingLows.slice(-3);

    if (structure.trend === 'bullish') {
        return recentLows[2].price > recentLows[1].price && recentLows[1].price < recentLows[0].price;
    } else if (structure.trend === 'bearish') {
        return recentHighs[2].price < recentHighs[1].price && recentHighs[1].price > recentHighs[0].price;
    }
    return false;
}

function findOrderBlocks(candles) {
    if (!candles || candles.length < 3) return [];

    const blocks = [];

    for (let i = 1; i < candles.length - 1; i++) {
        const current = candles[i];
        const next = candles[i + 1];

        // Bearish Order Block
        if (current.close < current.open && next.close < next.open &&
            Math.abs(next.close - next.open) > Math.abs(current.close - current.open) * 1.5) {
            blocks.push({ type: 'bearish', high: current.high, low: current.low, time: current.t, strength: 0.7 });
        }

        // Bullish Order Block
        if (current.close > current.open && next.close > next.open &&
            Math.abs(next.close - next.open) > Math.abs(current.close - current.open) * 1.5) {
            blocks.push({ type: 'bullish', high: current.high, low: current.low, time: current.t, strength: 0.7 });
        }
    }

    return blocks.slice(-10);
}

function findFairValueGaps(candles) {
    if (!candles || candles.length < 3) return [];

    const gaps = [];

    for (let i = 1; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const next = candles[i + 1];

        // Bullish FVG
        if (curr.low > Math.max(prev.high, next.high)) {
            gaps.push({ type: 'bullish', high: Math.min(prev.low, next.low), low: curr.high, time: curr.t, strength: 0.6 });
        }

        // Bearish FVG
        if (curr.high < Math.min(prev.low, next.low)) {
            gaps.push({ type: 'bearish', high: curr.low, low: Math.max(prev.high, next.high), time: curr.t, strength: 0.6 });
        }
    }

    return gaps.slice(-8);
}

function analyzeVolumeProfile(candles) {
    if (!candles || candles.length === 0) {
        return { poc: 0, totalVolume: 0, averageVolume: 0, volumeDelta: 1 };
    }

    const volumeByPrice = {};
    let totalVolume = 0;

    candles.forEach(candle => {
        const range = candle.high - candle.low;
        if (range === 0) return;

        const step = range / 10;
        for (let i = 0; i < 10; i++) {
            const priceLevel = (candle.low + step * i).toFixed(2);
            volumeByPrice[priceLevel] = (volumeByPrice[priceLevel] || 0) + (candle.vol / 10);
        }
        totalVolume += candle.vol;
    });

    let poc = 0;
    let maxVolume = 0;
    for (const [price, volume] of Object.entries(volumeByPrice)) {
        if (volume > maxVolume) {
            maxVolume = volume;
            poc = parseFloat(price);
        }
    }

    return {
        poc,
        totalVolume,
        averageVolume: totalVolume / candles.length,
        volumeDelta: calculateVolumeDelta(candles)
    };
}

function calculateVolumeDelta(candles) {
    if (!candles || candles.length < 20) return 1;

    const recent = candles.slice(-5).reduce((sum, c) => sum + c.vol, 0) / 5;
    const older = candles.slice(-20, -5).reduce((sum, c) => sum + c.vol, 0) / 15;
    return older === 0 ? 1 : recent / older;
}

function findLiquidityLevels(candles) {
    if (!candles || candles.length < 10) return [];

    const levels = [];
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    for (let i = 5; i < candles.length - 5; i++) {
        if (isSwingHigh(highs, i, 2)) {
            levels.push({ type: 'resistance', price: highs[i], time: candles[i].t, strength: 'strong' });
        }
        if (isSwingLow(lows, i, 2)) {
            levels.push({ type: 'support', price: lows[i], time: candles[i].t, strength: 'strong' });
        }
    }

    return levels.slice(-6);
}

function analyzeTimeframeICT(candles, timeframe) {
    if (!candles || candles.length === 0) return null;

    const price = candles[candles.length - 1].close;
    const marketStructure = analyzeAdvancedMarketStructure(candles);
    const orderBlocks = findOrderBlocks(candles);
    const fairValueGaps = findFairValueGaps(candles);
    const volumeAnalysis = analyzeVolumeProfile(candles);
    const liquidityLevels = findLiquidityLevels(candles);
    const atr = calculateATR(candles);

    return {
        price,
        trend: marketStructure.trend,
        strength: calculateTrendStrength(marketStructure),
        marketStructure,
        orderBlocks: filterRelevantLevels(orderBlocks, price),
        fairValueGaps: filterRelevantLevels(fairValueGaps, price),
        volumeAnalysis,
        liquidityLevels: filterRelevantLevels(liquidityLevels, price),
        atr,
        confidence: calculateTimeframeConfidence(marketStructure, volumeAnalysis, orderBlocks.length)
    };
}

function calculateTrendStrength(marketStructure) {
    if (marketStructure.swingHighs.length < 2 || marketStructure.swingLows.length < 2) return 0;

    const recentHighs = marketStructure.swingHighs.slice(-2);
    const recentLows = marketStructure.swingLows.slice(-2);

    const highSlope = (recentHighs[1].price - recentHighs[0].price) / (recentHighs[1].index - recentHighs[0].index);
    const lowSlope = (recentLows[1].price - recentLows[0].price) / (recentLows[1].index - recentLows[0].index);

    return Math.abs(highSlope + lowSlope) / 2;
}

function filterRelevantLevels(levels, currentPrice) {
    if (!levels || levels.length === 0) return [];
    return levels.filter(level => {
        const distance = Math.abs(level.price - currentPrice) / currentPrice;
        return distance < 0.05;
    });
}

function calculateTimeframeConfidence(marketStructure, volumeAnalysis, obCount) {
    let confidence = 50;

    if (marketStructure.trend !== 'neutral') confidence += 20;
    if (volumeAnalysis.volumeDelta > 1.2) confidence += 15;
    if (obCount > 0) confidence += 10;

    return Math.min(95, confidence);
}

function calculateRealConfidence(results) {
    let totalScore = 0;
    let maxScore = 0;

    for (const [tf, data] of Object.entries(results.timeframes)) {
        if (!data.analysis) continue;

        const weight = getTimeframeWeight(tf);
        const tfScore = calculateTFScoreICT(data.analysis);

        totalScore += tfScore * weight;
        maxScore += 100 * weight;
    }

    if (maxScore === 0) return 0;

    const confluenceBonus = calculateConfluenceBonus(results);
    totalScore += confluenceBonus;

    return Math.min(100, (totalScore / maxScore) * 100);
}

function getTimeframeWeight(tf) {
    const weights = { 'D1': 1.5, 'H4': 1.3, 'H1': 1.1, '15M': 0.8 };
    return weights[tf] || 1.0;
}

function calculateTFScoreICT(analysis) {
    if (!analysis) return 0;

    let score = 0;

    score += analysis.marketStructure.trend !== 'neutral' ? 25 : 0;
    score += analysis.marketStructure.breakOfStructure ? 15 : 0;
    score += analysis.marketStructure.changeOfCharacter ? 8 : 0;

    if (analysis.volumeAnalysis.volumeDelta) {
        score += Math.min(30, (analysis.volumeAnalysis.volumeDelta - 1) * 60);
    }

    score += Math.min(25, analysis.orderBlocks.length * 4);
    score += Math.min(20, analysis.fairValueGaps.length * 3);

    if (analysis.liquidityLevels.length > 0) {
        score += 15;
        const nearLiquidity = analysis.liquidityLevels.some(level =>
            Math.abs(analysis.price - level.price) < analysis.atr * 0.5
        );
        if (nearLiquidity) score += 15;
    }

    return Math.min(100, score);
}

function calculateConfluenceBonus(results) {
    let bonus = 0;
    const timeframes = Object.values(results.timeframes).filter(tf => tf.analysis);

    const bullishSignals = timeframes.filter(tf =>
        tf.analysis.trend === 'bullish' &&
        tf.analysis.orderBlocks.some(ob => ob.type === 'bullish')
    ).length;

    const bearishSignals = timeframes.filter(tf =>
        tf.analysis.trend === 'bearish' &&
        tf.analysis.orderBlocks.some(ob => ob.type === 'bearish')
    ).length;

    const confluence = Math.max(bullishSignals, bearishSignals);
    bonus = confluence * 8;

    return Math.min(30, bonus);
}

function calculateMultiTFBias(timeframes) {
    let bias = 0;

    timeframes.forEach((tf, index) => {
        if (!tf.analysis) return;

        const weight = TIMEFRAMES[index].weight;
        const analysis = tf.analysis;

        if (analysis.trend === 'bullish') bias += weight;
        else if (analysis.trend === 'bearish') bias -= weight;

        if (analysis.marketStructure.breakOfStructure) {
            if (analysis.marketStructure.trend === 'bullish') bias += weight * 0.5;
            else if (analysis.marketStructure.trend === 'bearish') bias -= weight * 0.5;
        }
    });

    return bias;
}

function findOptimalLongEntry(currentPrice, analysis, multiTimeframeAnalysis) {
    const relevantOBs = analysis.orderBlocks.filter(ob =>
        ob.type === 'bullish' && currentPrice > ob.low && currentPrice < ob.high * 1.02
    );

    if (relevantOBs.length > 0) {
        const bestOB = relevantOBs.reduce((best, current) =>
            current.strength > best.strength ? current : best
        );
        return bestOB.low * 0.998;
    }

    const relevantFVGs = analysis.fairValueGaps.filter(fvg =>
        fvg.type === 'bullish' && currentPrice > fvg.low && currentPrice < fvg.high
    );

    if (relevantFVGs.length > 0) {
        const bestFVG = relevantFVGs[0];
        return Math.max(bestFVG.low, currentPrice * 0.995);
    }

    const supports = analysis.liquidityLevels
        .filter(level => level.type === 'support')
        .map(level => level.price)
        .filter(price => price < currentPrice)
        .sort((a, b) => b - a);

    if (supports.length > 0) {
        return supports[0] * 1.001;
    }

    return currentPrice * 0.998;
}

function findOptimalShortEntry(currentPrice, analysis, multiTimeframeAnalysis) {
    const relevantOBs = analysis.orderBlocks.filter(ob =>
        ob.type === 'bearish' && currentPrice < ob.high && currentPrice > ob.low * 0.98
    );

    if (relevantOBs.length > 0) {
        const bestOB = relevantOBs.reduce((best, current) =>
            current.strength > best.strength ? current : best
        );
        return bestOB.high * 1.002;
    }

    const relevantFVGs = analysis.fairValueGaps.filter(fvg =>
        fvg.type === 'bearish' && currentPrice < fvg.high && currentPrice > fvg.low
    );

    if (relevantFVGs.length > 0) {
        const bestFVG = relevantFVGs[0];
        return Math.min(bestFVG.high, currentPrice * 1.005);
    }

    const resistances = analysis.liquidityLevels
        .filter(level => level.type === 'resistance')
        .map(level => level.price)
        .filter(price => price > currentPrice)
        .sort((a, b) => a - b);

    if (resistances.length > 0) {
        return resistances[0] * 0.999;
    }

    return currentPrice * 1.002;
}

function calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis) {
    const atr = analysis.atr;

    if (direction === 'LONG') {
        const supports = analysis.liquidityLevels
            .filter(level => level.type === 'support')
            .map(level => level.price)
            .filter(price => price < entry && price >= entry - (atr * 1.5))
            .sort((a, b) => b - a);

        if (supports.length > 0) {
            const nearestSupport = supports[0];
            const atrBasedSL = entry - (atr * 0.6);
            return Math.min(nearestSupport, atrBasedSL);
        }

        return entry - (atr * 0.8);

    } else {
        const resistances = analysis.liquidityLevels
            .filter(level => level.type === 'resistance')
            .map(level => level.price)
            .filter(price => price > entry && price <= entry + (atr * 1.5))
            .sort((a, b) => a - b);

        if (resistances.length > 0) {
            const nearestResistance = resistances[0];
            const atrBasedSL = entry + (atr * 0.6);
            return Math.max(nearestResistance, atrBasedSL);
        }

        return entry + (atr * 0.8);
    }
}

function calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis) {
    const risk = Math.abs(entry - sl);
    const atr = analysis.atr;

    if (direction === 'LONG') {
        const nearbyResistances = analysis.liquidityLevels
            .filter(level => level.type === 'resistance')
            .map(level => level.price)
            .filter(price => price > entry && price <= entry + (atr * 1.2))
            .sort((a, b) => a - b);

        let tp;

        if (nearbyResistances.length > 0) {
            tp = nearbyResistances[0];
        } else {
            tp = entry + (atr * 0.8);
        }

        const minTP = entry + risk * 1.2;
        const maxTP = entry + risk * 2.0;

        tp = Math.max(tp, minTP);
        tp = Math.min(tp, maxTP);

        return tp;

    } else {
        const nearbySupports = analysis.liquidityLevels
            .filter(level => level.type === 'support')
            .map(level => level.price)
            .filter(price => price < entry && price >= entry - (atr * 1.2))
            .sort((a, b) => b - a);

        let tp;

        if (nearbySupports.length > 0) {
            tp = nearbySupports[0];
        } else {
            tp = entry - (atr * 0.8);
        }

        const minTP = entry - risk * 1.2;
        const maxTP = entry - risk * 2.0;

        tp = Math.min(tp, minTP);
        tp = Math.max(tp, maxTP);

        return tp;
    }
}

function validateLevels(entry, sl, tp, currentPrice, atr) {
    const maxDistance = atr * 2.5;

    // Kiểm tra SL không quá xa
    if (Math.abs(entry - sl) > maxDistance) {
        if (entry > sl) {
            sl = entry - (atr * 1.0);
        } else {
            sl = entry + (atr * 1.0);
        }
    }

    // Kiểm tra TP không quá xa
    if (Math.abs(entry - tp) > maxDistance) {
        if (entry < tp) {
            tp = entry + (atr * 1.5);
        } else {
            tp = entry - (atr * 1.5);
        }
    }

    // Đảm bảo R:R hợp lý (0.8 đến 3.0)
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    let adjustedTp = tp;

    if (rr < 0.8) {
        adjustedTp = entry + (entry - sl) * 1.0;
    } else if (rr > 3.0) {
        adjustedTp = entry + (entry - sl) * 2.0;
    }

    return { entry, sl, tp: adjustedTp, rr: rr.toFixed(2) };
}

function calculateSmartLevels(direction, currentPrice, analysis, multiTimeframeAnalysis) {
    const atr = analysis.atr;

    if (direction === 'LONG') {
        const entry = findOptimalLongEntry(currentPrice, analysis, multiTimeframeAnalysis);
        const sl = calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis);
        const tp = calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis);

        const validated = validateLevels(entry, sl, tp, currentPrice, atr);

        return {
            entry: validated.entry,
            sl: validated.sl,
            tp: validated.tp,
            rr: validated.rr
        };
    } else {
        const entry = findOptimalShortEntry(currentPrice, analysis, multiTimeframeAnalysis);
        const sl = calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis);
        const tp = calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis);

        const validated = validateLevels(entry, sl, tp, currentPrice, atr);

        return {
            entry: validated.entry,
            sl: validated.sl,
            tp: validated.tp,
            rr: validated.rr
        };
    }
}

function calculatePositionSize(riskPercent, accountBalance, entry, sl, direction) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerUnit = Math.abs(entry - sl);
    const size = riskPerUnit === 0 ? 0 : (riskAmount / riskPerUnit).toFixed(4);

    return {
        size: size,
        maxLoss: riskAmount.toFixed(2)
    };
}
// END: copy of your original functions

// --- HÀM CHÍNH ĐỂ GỌI TỪ BÊN NGOÀI (AI/ICT logic) ---
async function analyzeSymbol(symbol) {
    try {
        const results = {
            timeframes: {},
            marketStructure: {},
            volumeAnalysis: {},
            signals: {},
            ictConcepts: {}
        };

        // Analyze each timeframe với fallback
        for (const tf of TIMEFRAMES) {
            try {
                const candles = await loadCandles(symbol, tf.interval, 300);
                if (candles && candles.length > 0) {
                    results.timeframes[tf.label] = {
                        candles,
                        price: candles[candles.length - 1].close,
                        analysis: analyzeTimeframeICT(candles, tf.label)
                    };
                }
            } catch (error) {
                console.log(`⚠️ Bỏ qua ${tf.label} cho ${symbol}: ${error.message}`);
                // Tiếp tục với timeframe khác
            }
        }

        const timeframes = Object.values(results.timeframes);
        if (timeframes.length === 0) {
            return {
                symbol,
                direction: 'NO_TRADE',
                confidence: 0,
                reason: 'Không thể tải dữ liệu từ bất kỳ nguồn nào'
            };
        }

        const currentPrice = timeframes[0].price;
        const bias = calculateMultiTFBias(timeframes);
        const confidence = calculateRealConfidence(results);

        if (confidence < 60) {
            return {
                symbol,
                direction: 'NO_TRADE',
                confidence: Math.round(confidence),
                reason: `Confidence ${Math.round(confidence)}% < Minimum 60%`
            };
        }

        const direction = bias > 0.5 ? 'LONG' : bias < -0.5 ? 'SHORT' : 'NEUTRAL';

        if (direction === 'NEUTRAL') {
            return {
                symbol,
                direction: 'NEUTRAL',
                confidence: Math.round(confidence),
                reason: 'No clear bias across timeframes'
            };
        }

        const primaryAnalysis = timeframes.find(tf => tf.analysis && tf.analysis.confidence > 70) || timeframes[0];
        if (!primaryAnalysis.analysis) {
            return {
                symbol,
                direction: 'NO_TRADE',
                confidence: 0,
                reason: 'No valid analysis available'
            };
        }

        const levels = calculateSmartLevels(direction, currentPrice, primaryAnalysis.analysis, results);

        const positionData = calculatePositionSize(2, 1000, parseFloat(levels.entry), parseFloat(levels.sl), direction);

        return {
            symbol,
            direction,
            confidence: Math.round(confidence),
            entry: parseFloat(levels.entry).toFixed(4),
            sl: parseFloat(levels.sl).toFixed(4),
            tp: parseFloat(levels.tp).toFixed(4),
            rr: levels.rr,
            positionSize: positionData.size,
            maxLoss: positionData.maxLoss
        };

    } catch (error) {
        console.error(`💥 Lỗi nghiêm trọng khi phân tích ${symbol}:`, error.message);
        return {
            symbol,
            direction: 'NO_TRADE',
            confidence: 0,
            reason: `Analysis error: ${error.message}`
        };
    }
}

// ---------------- New: Physics Momentum logic (PORT from Python logic -> JS) ----------------
/**
 * Physics Momentum algorithm (port from provided spec):
 * - RSI(14)
 * - Bollinger Bands (20, 2)
 * - Velocity v = SMA(3) of price change
 * - Acceleration a = v_t - v_{t-1}
 * Entry:
 *  LONG: RSI < 30 AND Close < LowerBand AND Acceleration > 0
 *  SHORT: RSI > 70 AND Close > UpperBand AND Acceleration < 0
 * Risk:
 *  ATR(14)
 *  SL = Entry +/- 1.5*ATR ; TP = Entry +/- 3.0*ATR
 * RR = abs(TP-Entry)/abs(Entry-SL)
 */
function sma(values, period) {
    if (!values || values.length === 0) return [];
    const res = [];
    for (let i = 0; i < values.length; i++) {
        const start = Math.max(0, i - period + 1);
        const slice = values.slice(start, i + 1);
        const s = slice.reduce((a, b) => a + b, 0) / slice.length;
        res.push(s);
    }
    return res;
}

function computeRSI(closeArr, period = 14) {
    const gains = [];
    const losses = [];
    for (let i = 1; i < closeArr.length; i++) {
        const diff = closeArr[i] - closeArr[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? Math.abs(diff) : 0);
    }
    if (gains.length < period) return new Array(closeArr.length).fill(null);

    // Wilder's smoothing
    const rs = [];
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    rs[period - 1] = avgGain / (avgLoss === 0 ? 1e-8 : avgLoss);
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        rs[i] = avgGain / (avgLoss === 0 ? 1e-8 : avgLoss);
    }
    // convert RS to RSI aligned to closeArr length
    const rsi = new Array(closeArr.length).fill(null);
    for (let i = 0; i < rs.length; i++) {
        const idx = i + 1; // because gains start at index 1 of close
        rsi[idx] = 100 - (100 / (1 + rs[i]));
    }
    return rsi;
}

function bollingerBands(closeArr, length = 20, stdMultiplier = 2) {
    const bands = { mid: [], upper: [], lower: [] };
    for (let i = 0; i < closeArr.length; i++) {
        const start = Math.max(0, i - length + 1);
        const slice = closeArr.slice(start, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
        const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
        const sd = Math.sqrt(variance);
        bands.mid.push(mean);
        bands.upper.push(mean + stdMultiplier * sd);
        bands.lower.push(mean - stdMultiplier * sd);
    }
    return bands;
}

function computeATRFromCandles(candles, period = 14) {
    // candles: array with open/high/low/close
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i - 1];
        const val = Math.max(
            current.high - current.low,
            Math.abs(current.high - prev.close),
            Math.abs(current.low - prev.close)
        );
        tr.push(val);
    }
    if (tr.length < period) {
        return null;
    }
    let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) {
        atr = (atr * (period - 1) + tr[i]) / period;
    }
    return atr;
}

async function analyzePhysicsSymbol(symbol) {
    try {
        // fetch 120 candles 15m/5m? Spec asked 5m timeframe with 100 limit. We'll use 5m with 120 to be safe.
        const candles = await loadCandles(symbol, '15m', 200).catch(async (e) => {
            // fallback to 5m if 15m fails
            return await loadCandles(symbol, '15m', 200);
        });

        if (!candles || candles.length < 50) {
            return null;
        }

        // Use the latest closes
        const closeArr = candles.map(c => c.close);
        const rsiArr = computeRSI(closeArr, 14);
        const bb = bollingerBands(closeArr, 20, 2);
        // velocity = SMA(3) of price change
        const priceChange = [];
        for (let i = 1; i < closeArr.length; i++) priceChange.push(closeArr[i] - closeArr[i - 1]);
        const vArr = sma(priceChange, 3); // note: vArr aligns with priceChange indices (one shorter)
        // Build v aligned to closeArr (shift by 1)
        const vAligned = [null].concat(vArr); // now same length as closeArr
        // acceleration a = v_t - v_{t-1}
        const aArr = [];
        for (let i = 0; i < vAligned.length; i++) {
            if (i === 0 || vAligned[i] == null || vAligned[i - 1] == null) aArr.push(null);
            else aArr.push(vAligned[i] - vAligned[i - 1]);
        }

        // ATR
        const atr = computeATRFromCandles(candles, 14);
        if (!atr || atr === 0) return null;

        // take last values
        const idx = closeArr.length - 1;
        const lastClose = closeArr[idx];
        const lastRsi = rsiArr[idx];
        const lastLowerBB = bb.lower[idx];
        const lastUpperBB = bb.upper[idx];
        const lastAcc = aArr[idx];

        // Entry rules
        let side = null;
        if (lastRsi !== null && lastLowerBB !== undefined && lastAcc !== null) {
            if (lastRsi < 30 && lastClose < lastLowerBB && lastAcc > 0) {
                side = 'LONG';
            }
        }
        if (lastRsi !== null && lastUpperBB !== undefined && lastAcc !== null) {
            if (lastRsi > 70 && lastClose > lastUpperBB && lastAcc < 0) {
                side = 'SHORT';
            }
        }

        if (!side) return null;

        const entry = lastClose;
        let sl, tp;
        if (side === 'LONG') {
            sl = entry - 1.5 * atr;
            tp = entry + 3.0 * atr;
        } else {
            sl = entry + 1.5 * atr;
            tp = entry - 3.0 * atr;
        }

        let rr = null;
        try { rr = Math.abs(tp - entry) / Math.abs(entry - sl); } catch (e) { rr = null; }

        // Build a confidence score (heuristic):
        // - RSI distance from extreme (30 or 70)
        // - acceleration magnitude relative to ATR
        let conf = 70; // base
        try {
            if (side === 'LONG') {
                conf += Math.min(20, Math.max(0, (30 - lastRsi))); // lower RSI increases confidence
            } else {
                conf += Math.min(20, Math.max(0, (lastRsi - 70)));
            }
            // acc normalized by ATR
            const accNorm = Math.abs(lastAcc) / (atr || 1);
            conf += Math.min(10, accNorm * 5);
            conf = Math.round(Math.max(0, Math.min(100, conf)));
        } catch (e) {
            conf = 70;
        }

        return {
            symbol,
            side,
            entry: parseFloat(entry),
            sl: parseFloat(sl),
            tp: parseFloat(tp),
            rr: rr !== null ? parseFloat(rr.toFixed(2)) : null,
            confidence: conf,
            meta: {
                rsi: lastRsi,
                acc: lastAcc,
                atr
            }
        };
    } catch (err) {
        console.error('Physics analysis error for', symbol, err.message || err);
        return null;
    }
}

// Export functions
module.exports = {
    analyzeSymbol,
    analyzePhysicsSymbol
};
