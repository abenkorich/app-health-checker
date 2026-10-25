export type State = 'up' | 'degraded' | 'down';
export type DependencyState = 'up' | 'down' | 'skipped';

export type DependencyReport = {
    id: string;
    name: string;
    state: DependencyState;
    latencyMs: number | null;
    detail: string | null;
};

export type ServiceReport = {
    id: string;
    name: string;
    state: State;
    latencyMs: number | null;
    version: string | null;
    detail: string | null;
    dependencies: DependencyReport[];
};

export type UptimeSample = {
    at: string;
    state: State;
    latencyMs: number | null;
};

export type StatusReport = {
    state: State;
    checkedAt: string;
    pollMs: number;
    services: ServiceReport[];
    /** Set by the monitor. `on` means a down service will email the alert list. */
    alerts?: 'on' | 'off';
    /** Recent checks for the apps on this report. Older apps are dropped. */
    history?: Record<string, UptimeSample[]>;
};

export type ProbeSnapshot = {
    ok: boolean;
    status: number | null;
    latencyMs: number;
    json: unknown;
};

const SAFE_DETAIL = new Set(['timeout', 'unreachable', 'auth failed', 'unavailable']);

const PLATFORM_DEPENDENCIES = [
    { id: 'database', name: 'Database' },
    { id: 'redis', name: 'Redis' },
    { id: 'worker', name: 'Worker' },
] as const;

export function overallState(states: State[]): State {
    if (states.some(state => state === 'down')) return 'down';
    if (states.some(state => state === 'degraded')) return 'degraded';
    return 'up';
}

export function buildReport(services: ServiceReport[], checkedAt: string, pollMs: number): StatusReport {
    return {
        state: overallState(services.map(service => service.state)),
        checkedAt,
        pollMs,
        services,
    };
}

export function serviceFromHttp(input: { id: string; name: string; probe: ProbeSnapshot }): ServiceReport {
    if (!input.probe.ok) {
        return {
            id: input.id,
            name: input.name,
            state: 'down',
            latencyMs: input.probe.status == null ? null : input.probe.latencyMs,
            version: null,
            detail: input.probe.status == null ? 'No response' : `HTTP ${input.probe.status}`,
            dependencies: [],
        };
    }
    return {
        id: input.id,
        name: input.name,
        state: 'up',
        latencyMs: input.probe.latencyMs,
        version: versionOf(input.probe.json),
        detail: null,
        dependencies: [],
    };
}

export function serviceFromPlatform(input: {
    id?: string;
    name?: string;
    health: ProbeSnapshot;
    ready: ProbeSnapshot | null;
}): ServiceReport {
    const id = input.id ?? 'platform';
    const name = input.name ?? 'Platform API';
    if (!input.health.ok) {
        return {
            id,
            name,
            state: 'down',
            latencyMs: input.health.status == null ? null : input.health.latencyMs,
            version: null,
            detail: input.health.status == null ? 'No response' : `HTTP ${input.health.status}`,
            dependencies: [],
        };
    }

    const checks = input.ready && isRecord(input.ready.json) && isRecord(input.ready.json.checks)
        ? input.ready.json.checks
        : null;
    if (!checks) {
        const readyOk = input.ready?.ok === true;
        return {
            id,
            name,
            state: readyOk ? 'up' : 'degraded',
            latencyMs: input.health.latencyMs,
            version: input.ready ? versionOf(input.ready.json) : null,
            detail: readyOk ? null : 'Readiness check failed',
            dependencies: [],
        };
    }

    const dependencies = PLATFORM_DEPENDENCIES.map(item => dependencyFrom(item.id, item.name, checks[item.id]));
    const dependencyDown = dependencies.some(item => item.state === 'down');

    return {
        id,
        name,
        state: dependencyDown || input.ready?.ok !== true ? 'degraded' : 'up',
        latencyMs: input.health.latencyMs,
        version: input.ready ? versionOf(input.ready.json) : null,
        detail: null,
        dependencies,
    };
}

/** A homepage GET is a curl-style check: 2xx passes, and the HTML body is ignored. */
export function applyHomepage(report: ServiceReport, probe: ProbeSnapshot | null): ServiceReport {
    if (!probe) return report;
    const failed = !probe.ok;
    const dependency: DependencyReport = {
        id: 'homepage',
        name: 'Homepage',
        state: failed ? 'down' : 'up',
        latencyMs: failed && probe.status == null ? null : probe.latencyMs,
        detail: failed ? (probe.status == null ? 'No response' : `HTTP ${probe.status}`) : null,
    };
    return {
        ...report,
        state: report.state === 'down' ? 'down' : failed ? 'degraded' : report.state,
        detail: report.state === 'up' && failed ? 'Homepage check failed' : report.detail,
        dependencies: [...report.dependencies, dependency],
    };
}

function dependencyFrom(id: string, name: string, value: unknown): DependencyReport {
    if (!isRecord(value)) {
        return { id, name, state: 'down', latencyMs: null, detail: 'unavailable' };
    }
    if (value.skipped === true && value.ok === true) {
        return { id, name, state: 'skipped', latencyMs: null, detail: null };
    }
    if (value.ok === true) {
        return { id, name, state: 'up', latencyMs: latencyOf(value.latencyMs), detail: null };
    }
    return {
        id,
        name,
        state: 'down',
        latencyMs: latencyOf(value.latencyMs),
        detail: safeDetail(value.error) ?? 'unavailable',
    };
}

function versionOf(json: unknown): string | null {
    if (!isRecord(json) || typeof json.version !== 'string') return null;
    if (json.version.length === 0 || json.version.length > 32) return null;
    if (!/^[\w.+-]+$/.test(json.version)) return null;
    return json.version;
}

function latencyOf(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 60_000) return null;
    return Math.round(value);
}

function safeDetail(value: unknown): string | null {
    return typeof value === 'string' && SAFE_DETAIL.has(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
