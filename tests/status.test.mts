import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHomepage, applyRedis, applyWorker, overallState, serviceFromHttp, serviceFromPlatform } from '../src/lib/aggregate.ts';
import { loadTargets, pollIntervalMs } from '../src/lib/targets.ts';

describe('overallState', () => {
    it('stays up when every service is up', () => {
        assert.equal(overallState(['up', 'up']), 'up');
    });

    it('is degraded when a dependency fails and nothing is down', () => {
        assert.equal(overallState(['up', 'degraded']), 'degraded');
    });

    it('is down when any service does not answer', () => {
        assert.equal(overallState(['degraded', 'down']), 'down');
    });
});

describe('service reports', () => {
    it('marks an http app down without copying the response body', () => {
        const report = serviceFromHttp({
            id: 'storefront',
            name: 'Storefront',
            probe: { ok: false, status: null, latencyMs: 20, json: { error: 'password=secret' } },
        });
        assert.equal(report.state, 'down');
        assert.equal(report.detail, 'No response');
        assert.equal(JSON.stringify(report).includes('secret'), false);
    });

    it('reads a safe version from a healthy app', () => {
        const report = serviceFromHttp({
            id: 'console',
            name: 'Console',
            probe: { ok: true, status: 200, latencyMs: 14, json: { ok: true, version: '0.1.0' } },
        });
        assert.equal(report.state, 'up');
        assert.equal(report.version, '0.1.0');
        assert.equal(report.latencyMs, 14);
    });

    it('keeps the platform up when Redis is unused and the other checks pass', () => {
        const report = serviceFromPlatform({
            health: { ok: true, status: 200, latencyMs: 8, json: { status: 'ok' } },
            ready: {
                ok: true,
                status: 200,
                latencyMs: 30,
                json: {
                    version: '0.1.0',
                    checks: {
                        database: { ok: true, latencyMs: 4 },
                        redis: { ok: true, skipped: true, latencyMs: null },
                        worker: { ok: true, latencyMs: 6 },
                    },
                },
            },
        });
        assert.equal(report.state, 'up');
        assert.equal(report.version, '0.1.0');
        assert.equal(report.dependencies.find(item => item.id === 'redis')?.state, 'skipped');
    });

    it('degrades the platform when the worker is down and drops unsafe error text', () => {
        const report = serviceFromPlatform({
            health: { ok: true, status: 200, latencyMs: 8, json: { status: 'ok' } },
            ready: {
                ok: false,
                status: 503,
                latencyMs: 40,
                json: {
                    version: '0.1.0',
                    checks: {
                        database: { ok: true, latencyMs: 4 },
                        redis: { ok: true, skipped: true },
                        worker: { ok: false, latencyMs: 2500, error: 'connect ECONNREFUSED 10.0.0.8:3020 password' },
                    },
                },
            },
        });
        assert.equal(report.state, 'degraded');
        assert.equal(report.dependencies.find(item => item.id === 'worker')?.detail, 'unavailable');
        assert.equal(JSON.stringify(report).includes('password'), false);
        assert.equal(JSON.stringify(report).includes('10.0.0.8'), false);
    });

    it('treats a ready URL without dependency checks as up when it responds', () => {
        const report = serviceFromPlatform({
            id: 'billing',
            name: 'Billing',
            health: { ok: true, status: 200, latencyMs: 11, json: { ok: true, version: '2.0.0' } },
            ready: { ok: true, status: 200, latencyMs: 12, json: { ok: true, version: '2.0.0' } },
        });
        assert.equal(report.id, 'billing');
        assert.equal(report.state, 'up');
        assert.equal(report.dependencies.length, 0);
    });
});

describe('homepage curl', () => {
    const up = serviceFromHttp({
        id: 'storefront',
        name: 'Storefront',
        probe: { ok: true, status: 200, latencyMs: 20, json: { ok: true, version: '1.4.0' } },
    });

    it('keeps the app up when the homepage returns HTML', () => {
        const report = applyHomepage(up, { ok: true, status: 200, latencyMs: 40, json: null });
        assert.equal(report.state, 'up');
        assert.equal(report.version, '1.4.0');
        assert.equal(report.dependencies.find(item => item.id === 'homepage')?.state, 'up');
    });

    it('marks the app degraded when the homepage curl fails', () => {
        const report = applyHomepage(up, { ok: false, status: 500, latencyMs: 30, json: null });
        assert.equal(report.state, 'degraded');
        assert.equal(report.detail, 'Homepage check failed');
        assert.equal(report.dependencies.find(item => item.id === 'homepage')?.detail, 'HTTP 500');
    });

    it('stays down when the health URL is already down', () => {
        const down = serviceFromHttp({
            id: 'storefront',
            name: 'Storefront',
            probe: { ok: false, status: null, latencyMs: 3000, json: null },
        });
        const report = applyHomepage(down, { ok: false, status: null, latencyMs: 3000, json: null });
        assert.equal(report.state, 'down');
        assert.equal(report.dependencies.find(item => item.id === 'homepage')?.detail, 'No response');
    });
});

describe('worker url', () => {
    const up = serviceFromHttp({
        id: 'billing',
        name: 'Billing',
        probe: { ok: true, status: 200, latencyMs: 10, json: { ok: true } },
    });

    it('marks an API degraded when the worker URL fails', () => {
        const report = applyWorker(up, { ok: false, status: null, latencyMs: 3000, json: null });
        assert.equal(report.state, 'degraded');
        assert.equal(report.detail, 'Worker check failed');
        assert.equal(report.dependencies.find(item => item.id === 'worker')?.detail, 'No response');
    });
});

describe('redis url', () => {
    const up = serviceFromHttp({
        id: 'billing',
        name: 'Billing',
        probe: { ok: true, status: 200, latencyMs: 10, json: { ok: true } },
    });

    it('marks an API degraded when the Redis ping fails', () => {
        const report = applyRedis(up, { ok: false, latencyMs: 12, detail: 'auth failed' });
        assert.equal(report.state, 'degraded');
        assert.equal(report.detail, 'Redis check failed');
        assert.equal(report.dependencies.find(item => item.id === 'redis')?.detail, 'auth failed');
        assert.equal(JSON.stringify(report).includes('secret'), false);
    });
});

describe('loadTargets', () => {
    it('uses the local ports and can turn an app off', () => {
        const targets = loadTargets({ LMS_HEALTH_URL: 'off' });
        assert.deepEqual(
            targets.map(target => target.id),
            ['platform', 'storefront', 'pos', 'console'],
        );
        assert.equal(targets[0]?.healthUrl, 'http://127.0.0.1:3000/health');
        assert.equal(targets[0]?.type, 'api');
        assert.equal(targets[0]?.readyUrl, 'http://127.0.0.1:3000/health/ready');
        assert.equal(targets[0]?.workerUrl, 'http://127.0.0.1:3020/health');
        assert.equal(targets[0]?.redisUrl, 'redis://127.0.0.1:6379');
        assert.equal(targets.find(target => target.id === 'storefront')?.type, 'web-app');
        assert.equal(targets.find(target => target.id === 'storefront')?.homeUrl, 'http://127.0.0.1:3001/');
    });

    it('keeps the poll interval inside a safe range', () => {
        assert.equal(pollIntervalMs({}), 30_000);
        assert.equal(pollIntervalMs({ STATUS_POLL_MS: '100' }), 15_000);
        assert.equal(pollIntervalMs({ STATUS_POLL_MS: '999999999' }), 24 * 60 * 60 * 1000);
    });
});
