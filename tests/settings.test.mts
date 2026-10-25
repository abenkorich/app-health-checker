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
        assert.equal(parsed.settings.services[1]?.kind, 'http');
        assert.equal(parsed.settings.services[1]?.homeUrl, '');
    });

    it('keeps the seeded homepage when a saved app omits it, and rejects a non-http homepage', () => {
        const omitted = parseSettings({
            ...current,
            services: current.services.map(({ homeUrl: _home, ...service }) => service),
        }, current);
        assert.equal(omitted.ok, true);
        if (!omitted.ok) return;
        assert.equal(omitted.settings.services.find(service => service.id === 'storefront')?.homeUrl, 'http://127.0.0.1:3001/');

        const badHome = parseSettings({
            ...current,
            services: current.services.map(service => (
                service.id === 'storefront' ? { ...service, homeUrl: 'file:///tmp/index.html' } : service
            )),
        }, current);
        assert.equal(badHome.ok, false);
    });

    it('allows an empty recipient list, which leaves mail off', () => {
        const parsed = parseSettings({ ...current, recipients: '', smtpHost: '', from: '' }, current);
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.settings.recipients, '');
        assert.equal(parsed.settings.services.length, 5);
    });
});
