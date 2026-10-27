import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultSettings, parseSettings, toPublic } from '../src/lib/settings-model.ts';

describe('parseSettings', () => {
    const current = defaultSettings({});

    it('keeps a saved password when the form sends a blank one, and hides it from the public view', () => {
        const parsed = parseSettings({ ...current, smtpPassword: '', pollSeconds: 45 }, { ...current, smtpPassword: 'kept-secret' });
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.settings.pollSeconds, 45);
        assert.equal(parsed.settings.smtpPassword, 'kept-secret');
        const pub = toPublic(parsed.settings);
        assert.equal(pub.passwordSet, true);
        assert.equal('smtpPassword' in pub, false);
    });

    it('rejects a bad recipient and a health URL that is not http', () => {
        const badRecipient = parseSettings({ ...current, recipients: 'ops' }, current);
        assert.equal(badRecipient.ok, false);

        const badUrl = parseSettings({
            ...current,
            services: current.services.map(service => (
                service.id === 'storefront' ? { ...service, healthUrl: 'file:///tmp/health' } : service
            )),
        }, current);
        assert.equal(badUrl.ok, false);
    });

    it('keeps an added external app and drops one that was removed', () => {
        const parsed = parseSettings({
            ...current,
            services: [
                current.services[0],
                { id: 'billing', name: 'Billing', enabled: true, healthUrl: 'https://billing.example/health', readyUrl: '' },
            ],
        }, current);
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.deepEqual(parsed.settings.services.map(service => service.id), ['platform', 'billing']);
        assert.equal(parsed.settings.services[1]?.type, 'web-app');
        assert.equal(parsed.settings.services[1]?.kind, 'http');
        assert.equal(parsed.settings.services[1]?.homeUrl, '');
        assert.equal(parsed.settings.services[1]?.workerUrl, '');
        assert.equal(parsed.settings.services[1]?.redisUrl, '');
    });

    it('keeps the seeded homepage when a saved app omits it, and rejects a non-http homepage', () => {
        const omitted = parseSettings({
            ...current,
            services: current.services.map(({ homeUrl: _home, ...service }) => service),
        }, current);
        assert.equal(omitted.ok, true);
        if (!omitted.ok) return;
        assert.equal(omitted.settings.services.find(service => service.id === 'storefront')?.homeUrl, 'http://127.0.0.1:3001/');
        assert.equal(omitted.settings.services.find(service => service.id === 'platform')?.type, 'api');
        assert.equal(omitted.settings.services.find(service => service.id === 'platform')?.workerUrl, 'http://127.0.0.1:3020/health');
        assert.equal(omitted.settings.services.find(service => service.id === 'platform')?.redisUrl, 'redis://127.0.0.1:6379');

        const badHome = parseSettings({
            ...current,
            services: current.services.map(service => (
                service.id === 'storefront' ? { ...service, homeUrl: 'file:///tmp/index.html' } : service
            )),
        }, current);
        assert.equal(badHome.ok, false);

        const api = parseSettings({
            ...current,
            services: [
                ...current.services,
                { id: 'billing', name: 'Billing', type: 'api', enabled: true, healthUrl: 'https://billing.example/health', readyUrl: '', workerUrl: 'https://billing.example/worker' },
            ],
        }, current);
        assert.equal(api.ok, true);
        if (!api.ok) return;
        assert.equal(api.settings.services.find(service => service.id === 'billing')?.kind, 'platform');
        assert.equal(api.settings.services.find(service => service.id === 'billing')?.workerUrl, 'https://billing.example/worker');

        const badWorker = parseSettings({
            ...current,
            services: current.services.map(service => (
                service.id === 'platform' ? { ...service, workerUrl: 'file:///tmp/worker' } : service
            )),
        }, current);
        assert.equal(badWorker.ok, false);

        const redis = parseSettings({
            ...current,
            services: current.services.map(({ redisUrl: _redis, ...service }) => (
                service.id === 'platform' ? service : { ...service, redisUrl: '' }
            )),
        }, current);
        assert.equal(redis.ok, true);
        if (!redis.ok) return;
        assert.equal(redis.settings.services.find(service => service.id === 'platform')?.redisUrl, 'redis://127.0.0.1:6379');

        const badRedis = parseSettings({
            ...current,
            services: current.services.map(service => (
                service.id === 'platform' ? { ...service, redisUrl: 'http://127.0.0.1:6379' } : service
            )),
        }, current);
        assert.equal(badRedis.ok, false);
    });

    it('allows an empty recipient list, which leaves mail off', () => {
        const parsed = parseSettings({ ...current, recipients: '', smtpHost: '', from: '' }, current);
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.settings.recipients, '');
        assert.equal(parsed.settings.services.length, 5);
    });
});
