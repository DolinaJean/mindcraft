import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

function sanitizeForSpeech(text) {
    return String(text ?? '')
        .replace(/```[\s\S]*?```/g, ' code block omitted ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function clampRate(rate) {
    if (typeof rate !== 'number' || Number.isNaN(rate)) return 0;
    return Math.max(-10, Math.min(10, Math.trunc(rate)));
}

function getRateForVoiceModel(speakModel) {
    switch ((speakModel || '').toLowerCase()) {
        case 'fast':
            return 3;
        case 'slow':
            return -2;
        case 'system':
        default:
            return 0;
    }
}

async function speakWindows(text, rate) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindcraft-tts-'));
    const textPath = path.join(tempDir, 'speech.txt');
    const scriptPath = path.join(tempDir, 'speak.ps1');

    try {
        await fs.writeFile(textPath, text, 'utf8');

        const script = `
Add-Type -AssemblyName System.Speech
$ErrorActionPreference = 'Stop'
$textPath = $args[0]
$rate = [int]$args[1]
$text = Get-Content -LiteralPath $textPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $s.Rate = $rate
    $s.Speak($text)
}
finally {
    $s.Dispose()
}
`.trim();

        await fs.writeFile(scriptPath, script, 'utf8');

        await execFileAsync('powershell', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            textPath,
            String(rate)
        ], {
            windowsHide: true,
            timeout: 120000,
            maxBuffer: 1024 * 1024
        });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

export async function speak(text, speakModel = 'system') {
    const cleaned = sanitizeForSpeech(text);
    if (!cleaned) return;

    const rate = clampRate(getRateForVoiceModel(speakModel));

    try {
        if (process.platform === 'win32') {
            await speakWindows(cleaned, rate);
            return;
        }

        // Non-Windows fallback: no-op for now to avoid crashing the bot.
        console.warn('TTS is only implemented for Windows in this module.');
    } catch (err) {
        console.error('TTS error', err);
    }
}

export default speak;
