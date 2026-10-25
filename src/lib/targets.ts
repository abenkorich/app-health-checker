export type Target = {
    id: string;
    name: string;
    kind: 'platform' | 'http';
    healthUrl: string;
    readyUrl?: string;
    homeUrl?: string;
};

export const SERVICE_CATALOG: Array<{
    id: string;
    name: string;
    kind: Target['kind'];
    env: string;
    fallback: string;
    readyEnv?: string;
    readyFallback?: string;
    homeEnv?: string;
    homeFallback?: string;
}> = [
    {
        id: 'platform',
        name: 'Platform API',
        kind: 'platform',
        env: 'PLATFORM_HEALTH_URL',
        fallback: 'http://127.0.0.1:3000/health',
        readyEnv: 'PLATFORM_READY_URL',
        readyFallback: 'http://127.0.0.1:3000/health/ready',
    },
    {
        id: 'storefront',
        name: 'Storefront',
        kind: 'http',
        env: 'STOREFRONT_HEALTH_URL',
        fallback: 'http://127.0.0.1:3001/api/health',
        homeEnv: 'STOREFRONT_HOME_URL',
        homeFallback: 'http://127.0.0.1:3001/',
    },
    {
        id: 'pos',
        name: 'POS',
        kind: 'http',
        env: 'POS_HEALTH_URL',
        fallback: 'http://127.0.0.1:3002/api/health',
        homeEnv: 'POS_HOME_URL',
        homeFallback: 'http://127.0.0.1:3002/',
    },
    {
        id: 'console',
        name: 'Console',
        kind: 'http',
        env: 'CONSOLE_HEALTH_URL',
        fallback: 'http://127.0.0.1:3003/api/health',
        homeEnv: 'CONSOLE_HOME_URL',
        homeFallback: 'http://127.0.0.1:3003/',
    },
    {
        id: 'lms',
        name: 'Academy',
        kind: 'http',
        env: 'LMS_HEALTH_URL',
        fallback: 'http://127.0.0.1:3004/api/health',
        homeEnv: 'LMS_HOME_URL',
        homeFallback: 'http://127.0.0.1:3004/',
    },
];

/** `off` or an empty value drops that app from the board. */
export function loadTargets(env: NodeJS.ProcessEnv = process.env): Target[] {
    const targets: Target[] = [];
    for (const item of SERVICE_CATALOG) {
        const healthUrl = configuredUrl(env, item.env, item.fallback);
        if (!healthUrl) continue;
        const target: Target = { id: item.id, name: item.name, kind: item.kind, healthUrl };
        if (item.readyEnv && item.readyFallback) {
            const readyUrl = configuredUrl(env, item.readyEnv, item.readyFallback);
            if (readyUrl) target.readyUrl = readyUrl;
        }
        if (item.homeEnv && item.homeFallback) {
            const homeUrl = configuredUrl(env, item.homeEnv, item.homeFallback);
            if (homeUrl) target.homeUrl = homeUrl;
        }
        targets.push(target);
    }
    return targets;
}

export function pollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
    const value = Number(env.STATUS_POLL_MS || 30_000);
    if (!Number.isFinite(value)) return 30_000;
    return Math.min(24 * 60 * 60 * 1000, Math.max(15_000, Math.round(value)));
}

export function probeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
    const value = Number(env.PROBE_TIMEOUT_MS || 3_000);
    if (!Number.isFinite(value)) return 3_000;
    return Math.min(10_000, Math.max(500, Math.round(value)));
}

export function envUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): { enabled: boolean; url: string } {
    const raw = env[key];
    if (raw === undefined) return { enabled: true, url: fallback };
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'off') return { enabled: false, url: fallback };
    return { enabled: true, url: trimmed };
}

function configuredUrl(env: NodeJS.ProcessEnv, key: string, fallback: string): string | null {
    const resolved = envUrl(env, key, fallback);
    return resolved.enabled ? resolved.url : null;
}
