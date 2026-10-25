import fs from 'node:fs';
import path from 'node:path';
import { defaultSettings, parseSettings, type PublicSettings, type StatusSettings } from './settings-model';

const file = path.join(process.cwd(), '.status', 'config.json');

export function loadConfig(): StatusSettings {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        const result = parseSettings(parsed, { ...defaultSettings(), smtpPassword: passwordOf(parsed) });
        if (result.ok) return result.settings;
    } catch {
        // A missing or unreadable file uses the env defaults.
    }
    return defaultSettings();
}

function passwordOf(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const password = (value as { smtpPassword?: unknown }).smtpPassword;
    return typeof password === 'string' ? password : '';
}

export function saveConfig(input: unknown): { ok: true; settings: PublicSettings } | { ok: false; error: string } {
    const current = loadConfig();
    const parsed = parseSettings(input, current);
    if (!parsed.ok) return parsed;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(parsed.settings), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true, settings: toPublicLocal(parsed.settings) };
}

export function publicConfig(): PublicSettings {
    return toPublicLocal(loadConfig());
}

function toPublicLocal(settings: StatusSettings): PublicSettings {
    const { smtpPassword, ...rest } = settings;
    return { ...rest, passwordSet: smtpPassword.trim().length > 0 };
}
