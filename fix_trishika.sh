#!/usr/bin/env bash
set -e

echo ">> Rewriting src/services/ai_helpers.js"
cat > src/services/ai_helpers.js << 'JS'
import axios from 'axios';
import { CONFIG } from '../config/index.js';

// ─── CORRECT URLS ────────────────────────────────────────────────────────────
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// ─── GROQ ────────────────────────────────────────────────────────────────────
export async function groqCall(prompt) {
    if (!CONFIG.groqKey || CONFIG.groqKey.length < 10) {
        console.error('[GROQ] Key missing or too short');
        return null;
    }
    try {
        const resp = await axios.post(GROQ_URL, {
            model: CONFIG.groqModel || 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.1
        }, {
            headers: {
                Authorization: `Bearer ${CONFIG.groqKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        return resp.data.choices[0]?.message?.content || null;
    } catch (e) {
        console.error('[GROQ FAIL]', e.response?.data?.error?.message || e.message);
        return null;
    }
}

// ─── OLLAMA (raw call) ──────────────────────────────────────────────────────
export async function queueOllama(model, prompt, timeout = 120000) {
    try {
        const resp = await axios.post(OLLAMA_URL, {
            model,
            prompt,
            stream: false,
            options: { temperature: 0.1, num_predict: 80 }
        }, { timeout });

        console.log(`\n=== EXPERT (${model}) RESPONSE ===\n`, resp.data.response, `\n==============================\n`);
        return resp.data.response || null;
    } catch (e) {
        console.warn(`[OLLAMA FAIL] ${model}: ${e.message}`);
        return null;
    }
}

// ─── UNLOAD MODEL ───────────────────────────────────────────────────────────
export async function unloadModel(model) {
    try {
        await axios.post(OLLAMA_URL, { model, keep_alive: 0 }, { timeout: 5000 });
    } catch (_) {}
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
export function extractJSON(text) {
    try {
        if (!text) return null;
        const match = text.match(/\{[\s\S]*?\}/);
        return match ? JSON.parse(match[0]) : null;
    } catch (e) { return null; }
}

export function clampSignal(s) {
    const valid = ['LONG', 'SHORT', 'NEUTRAL', 'HOLD'];
    return {
        signal:     valid.includes(s?.signal?.toUpperCase()) ? s.signal.toUpperCase() : 'NEUTRAL',
        confidence: Math.min(100, Math.max(0, Number(s?.confidence) || 50)),
        reason:     String(s?.reason || 'No reason').slice(0, 200),
        agent:      s?.agent   || 'System',
        _source:    s?._source || 'unknown'
    };
}

export function buildPrompt(symbol, indicators, mode, context = '') {
    const ind = JSON.stringify(indicators || {});
    if (mode === 'compact') {
        return `You are a trading expert. Analyze ${symbol} with data: ${ind}. Reply in exactly ONE sentence about momentum, EMA, and RSI only. No JSON.`;
    }
    return `You are a master trading AI. Synthesize these expert opinions for ${symbol}:
${context}
Raw indicators: ${ind}
Reply ONLY with this exact JSON (no markdown, no extra text):
{"signal":"LONG","confidence":75,"reason":"one sentence explanation"}
signal must be LONG, SHORT, or NEUTRAL.`;
}

// For toggle route (not strictly needed but kept for future)
export let groqOverride = null;
export const setGroqEnabled = (val) => { groqOverride = val; };
JS

echo ">> Rewriting src/ai/index.js"
cat > src/ai/index.js << 'JS'
import {
    groqCall, queueOllama, unloadModel,
    extractJSON, clampSignal, buildPrompt
} from '../services/ai_helpers.js';

// Sequential timeouts - one model at a time
const TIMEOUTS = {
    'tinyllama':   45000,
    'gemma2:2b':   60000,
    'phi3':        90000,
    'llama3.1:8b': 150000
};

async function runExpert(model, prompt) {
    try {
        const result = await queueOllama(model, prompt, TIMEOUTS[model]);
        return result;
    } finally {
        await unloadModel(model);
    }
}

async function runPipeline(symbol, ind) {
    console.log(`\n[PIPELINE] ===== ${symbol} =====`);
    const base = `Symbol: ${symbol} | Price: ${ind?.price || 'N/A'} | RSI: ${ind?.rsi || 50} | EMA: ${ind?.ema || 'N/A'} | MACD: ${ind?.macd || 'N/A'} | Volume: ${ind?.volume || 'N/A'}`;
    console.log('[PIPELINE] Running experts sequentially (RAM: 5.8GB)...');

    const e1 = await runExpert('tinyllama',
        `${base}\nExpert1 Momentum: EMA and RSI only. ONE sentence.`);
    const e2 = await runExpert('gemma2:2b',
        `${base}\nExpert2 PriceAction: MACD and volume only. ONE sentence.`);
    const e3 = await runExpert('phi3',
        `${base}\nExpert3 Risk: volatility risk LOW/MEDIUM/HIGH only. ONE sentence.`);
    const e4 = await runExpert('llama3.1:8b',
        `${base}\nExpert4 Verdict: LONG/SHORT/NEUTRAL with ONE sentence reason.`);

    const context = [
        `Expert1 (Momentum): ${e1 || 'no response'}`,
        `Expert2 (PriceAction): ${e2 || 'no response'}`,
        `Expert3 (Risk): ${e3 || 'no response'}`,
        `Expert4 (Verdict): ${e4 || 'no response'}`
    ].join('\n');

    console.log('[PIPELINE] Experts done. Sending to Groq master...');

    // Always try Groq if key is present in CONFIG
    try {
        const raw = await groqCall(buildPrompt(symbol, ind, 'full', context));
        const parsed = extractJSON(raw);
        if (parsed && parsed.signal) {
            const result = clampSignal({ ...parsed, agent: 'Groq-70B', _source: 'Groq+4Experts' });
            console.log(`[PIPELINE] FINAL: ${JSON.stringify(result)}`);
            return result;
        }
    } catch (e) {
        console.error('[GROQ FAIL]', e.message);
    }

    const fb = extractJSON(e4);
    if (fb && fb.signal) {
        return clampSignal({ ...fb, agent: 'llama3.1:8b', _source: 'LocalFallback' });
    }
    return clampSignal({
        signal: 'NEUTRAL', confidence: 50,
        reason: 'All AI sources failed', agent: 'System', _source: 'Fallback'
    });
}

export async function generateSignal(symbol, ind) {
    return runPipeline(symbol, ind || {});
}
JS

echo ">> Restarting PM2 app"
pm2 restart trishika
sleep 3
pm2 logs trishika --lines 20
