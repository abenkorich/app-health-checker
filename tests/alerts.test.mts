import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alertRemindMs, planAlerts, readMailConfig, statusSnapshot } from '../src/lib/alerts.ts';
import { overallState, type ServiceReport, type StatusReport } from '../src/lib/aggregate.ts';

const checkedAt = '2026-10-24T16:46:00.000Z';

function service(id: string, state: ServiceReport['state'], detail: string | null = null): ServiceReport {
    return { id, name: id, state, latencyMs: null, version: null, detail, dependencies: [] };
}

function report(services: ServiceReport[]): StatusReport {
    return { state: overallState(services.map(service => service.state)), checkedAt, pollMs: 30_000, services };
}

describe('planAlerts', () => {
    it('emails once when a service is first seen down, then stays quiet', () => {
        const first = planAlerts({
            previous: null,
            report: report([service('Storefront', 'down', 'No response')]),
            now: 1_000,
            remindMs: 60_000,
        });
        assert.equal(first.emails.length, 1);
        assert.equal(first.emails[0]?.subject, 'App Health Checker: Storefront down · overall down');
        assert.equal(first.emails[0]?.text.includes('No response'), true);
        assert.equal(first.emails[0]?.html.includes('data-widget="Storefront"'), true);
        assert.equal(first.emails[0]?.html.includes('Overall down'), true);

        const second = planAlerts({
            previous: first.next,
            report: report([service('Storefront', 'down', 'No response')]),
            now: 2_000,
            remindMs: 60_000,
        });
        assert.deepEqual(second.emails, []);
    });

    it('reminds while a service stays down, then emails when it recovers', () => {
        const first = planAlerts({
            previous: null,
            report: report([service('POS', 'down')]),
            now: 0,
            remindMs: 60_000,
        });
        const reminded = planAlerts({
            previous: first.next,
            report: report([service('POS', 'down')]),
            now: 60_000,
            remindMs: 60_000,
        });
        assert.equal(reminded.emails[0]?.subject, 'App Health Checker: POS still down · overall down');

        const recovered = planAlerts({
            previous: reminded.next,
            report: report([service('POS', 'up')]),
            now: 70_000,
            remindMs: 60_000,
        });
        assert.equal(recovered.emails.length, 1);
        assert.equal(recovered.emails[0]?.kind, 'recovered');
        assert.equal(recovered.emails[0]?.subject, 'App Health Checker: POS up · overall up');
    });

    it('emails when the platform is degraded because a dependency is down', () => {
        const platform: ServiceReport = {
            ...service('Platform API', 'degraded'),
            id: 'platform',
            dependencies: [
                { id: 'database', name: 'Database', state: 'down', latencyMs: 12, detail: 'unreachable' },
                { id: 'redis', name: 'Redis', state: 'skipped', latencyMs: null, detail: null },
                { id: 'worker', name: 'Worker', state: 'up', latencyMs: 4, detail: null },
            ],
        };
        const planned = planAlerts({
            previous: null,
            report: report([platform]),
            now: 0,
            remindMs: 60_000,
        });
        assert.equal(planned.emails[0]?.subject, 'App Health Checker: Platform API degraded · overall degraded');
        assert.equal(planned.emails[0]?.html.includes('data-widget="platform"'), true);
        assert.equal(planned.emails[0]?.text.includes('Database: down (unreachable)'), true);
        assert.equal(planned.emails[0]?.text.includes('Redis'), false);
        assert.equal(planned.emails[0]?.text.includes('Worker'), false);
    });

    it('stays quiet for a degraded service when alerts are set to down only, and recovers without saying it is responding', () => {
        const first = planAlerts({
            previous: null,
            report: report([service('Platform API', 'down', 'No response')]),
            now: 0,
            remindMs: 60_000,
            alertOn: 'down',
        });
        const quieter = planAlerts({
            previous: first.next,
            report: report([service('Platform API', 'degraded', 'Readiness check failed')]),
            now: 1_000,
            remindMs: 60_000,
            alertOn: 'down',
        });
        assert.equal(quieter.emails.length, 1);
        assert.equal(quieter.emails[0]?.kind, 'recovered');
        assert.equal(quieter.emails[0]?.subject, 'App Health Checker: Platform API degraded · overall degraded');
        assert.equal(quieter.emails[0]?.text.includes('responding'), false);

        const held = planAlerts({
            previous: null,
            report: report([service('Platform API', 'degraded')]),
            now: 0,
            remindMs: 60_000,
            alertOn: 'down',
        });
        assert.deepEqual(held.emails, []);
    });

    it('does not copy an unsafe detail into the subject or body beyond the safe text already on the report', () => {
        const planned = planAlerts({
            previous: null,
            report: report([service('Console', 'down', 'unavailable')]),
            now: 0,
            remindMs: 60_000,
        });
        assert.equal(planned.emails[0]?.text.includes('password'), false);
    });

    it('builds a status email for every app and names the down count and overall state', () => {
        const email = statusSnapshot(report([
            service('Storefront', 'down', 'No response'),
            service('POS', 'up'),
        ]));
        assert.equal(email.kind, 'status');
        assert.equal(email.subject, 'App Health Checker: 1 down · overall down');
        assert.equal(email.html.includes('data-widget="Storefront"'), true);
        assert.equal(email.html.includes('data-widget="POS"'), true);
        assert.equal(email.text.includes('Overall: down'), true);
    });
});

describe('readMailConfig', () => {
    it('stays off until a recipient, host, and from address are set', () => {
        assert.equal(readMailConfig({}), null);
        assert.equal(readMailConfig({ ALERT_EMAIL_TO: 'ops@example.com' }), null);
        const config = readMailConfig({
            ALERT_EMAIL_TO: 'ops@example.com, not-an-email',
            EMAIL_SMTP_HOST: 'smtp.example.com',
            EMAIL_SMTP_PORT: '587',
            EMAIL_FROM_ADDRESS: 'Vendure status <status@example.com>',
            EMAIL_SMTP_USERNAME: 'status@example.com',
            EMAIL_SMTP_PASSWORD: 'secret-value',
        });
        assert.deepEqual(config && { ...config, pass: 'hidden' }, {
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            user: 'status@example.com',
            pass: 'hidden',
            from: 'Vendure status <status@example.com>',
            to: ['ops@example.com'],
        });
    });

    it('uses port 465 as an implicit TLS connection', () => {
        const config = readMailConfig({
            ALERT_EMAIL_TO: 'ops@example.com',
            EMAIL_SMTP_HOST: 'smtp.example.com',
            EMAIL_FROM_ADDRESS: 'status@example.com',
        });
        assert.equal(config?.port, 465);
        assert.equal(config?.secure, true);
    });

    it('keeps the reminder interval inside a safe range', () => {
        assert.equal(alertRemindMs({}), 15 * 60 * 1000);
        assert.equal(alertRemindMs({ ALERT_REMIND_MS: '1' }), 60_000);
    });
});
