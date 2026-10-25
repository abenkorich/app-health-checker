import { createHash, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'app-health-checker-auth';
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 8;
const ATTEMPTS = '__appHealthCheckerLoginAttempts';

type AttemptBucket = { failures: number; resetAt: number };
type Env = Record<string, string | undefined>;

/** The board stays closed until this is set, the same way the customizer does. */
export function accessSecret(env: Env = process.env): string | undefined {
    const value = env.STATUS_SECRET?.trim();
    return value ? value : undefined;
}

export function isAccessConfigured(env: Env = process.env): boolean {
    return Boolean(accessSecret(env));
}

export function accessToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

export function verifyAccessSecret(input: string, env: Env = process.env): boolean {
    const expected = accessSecret(env);
    if (!expected || !input) return false;
    return safeEqual(accessToken(input), accessToken(expected));
}

export function cookieMatches(token: string | undefined, env: Env = process.env): boolean {
    const expected = accessSecret(env);
    if (!expected || !token) return false;
    return safeEqual(token, accessToken(expected));
}

export function accessCookieOptions(secure: boolean): {
    httpOnly: true;
    sameSite: 'lax';
    secure: boolean;
    path: '/';
    maxAge: number;
} {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 60 * 60 * 8,
    };
}

export function loginAllowed(key: string, now = Date.now()): boolean {
    return attempts(key, now).failures < ATTEMPT_LIMIT;
}

export function noteLoginFailure(key: string, now = Date.now()): void {
    attempts(key, now).failures += 1;
}

export function clearLoginFailures(key: string): void {
    attemptMap().delete(key);
}

function attempts(key: string, now: number): AttemptBucket {
    const map = attemptMap();
    const current = map.get(key);
    if (!current || current.resetAt <= now) {
        const fresh = { failures: 0, resetAt: now + ATTEMPT_WINDOW_MS };
        map.set(key, fresh);
        return fresh;
    }
    return current;
}

function attemptMap(): Map<string, AttemptBucket> {
    const g = globalThis as typeof globalThis & { [ATTEMPTS]?: Map<string, AttemptBucket> };
    g[ATTEMPTS] ??= new Map();
    return g[ATTEMPTS];
}

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}
