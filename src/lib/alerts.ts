import type { ServiceReport, State, StatusReport } from './aggregate';

export type AlertMemory = {
    state: State;
    alertedAt: number | null;
};

export type AlertEmail = {
    kind: 'down' | 'recovered';
    subject: string;
    text: string;
};

export type MailConfig = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    to: string[];
};

const DEFAULT_REMIND_MS = 15 * 60 * 1000;

/** How long a service can stay down before another email. */
export function alertRemindMs(env: NodeJS.ProcessEnv = process.env): number {
    const value = Number(env.ALERT_REMIND_MS || DEFAULT_REMIND_MS);
    if (!Number.isFinite(value)) return DEFAULT_REMIND_MS;
    return Math.min(24 * 60 * 60 * 1000, Math.max(60_000, Math.round(value)));
}

type MailEnv = Record<string, string | undefined>;

/**
 * SMTP settings shared with the platform (`EMAIL_SMTP_*`, `EMAIL_FROM_ADDRESS`).
 * Alerts stay off until `ALERT_EMAIL_TO` is set, so a dev board does not send mail.
 */
export function readMailConfig(env: MailEnv = process.env): MailConfig | null {
    const host = env.EMAIL_SMTP_HOST?.trim() ?? '';
    const from = env.EMAIL_FROM_ADDRESS?.trim() ?? '';
    const to = (env.ALERT_EMAIL_TO ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(item => /^[^\s@]+@[^\s@]+$/.test(item));
    if (!host || !from || to.length === 0) return null;
    const port = Number(env.EMAIL_SMTP_PORT || 465);
    const safePort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 465;
    return {
        host,
        port: safePort,
        secure: safePort === 465,
        user: env.EMAIL_SMTP_USERNAME?.trim() ?? '',
        pass: env.EMAIL_SMTP_PASSWORD ?? '',
        from,
        to,
    };
}

export type AlertWhen = 'down' | 'down-and-degraded';

export function planAlerts(input: {
    previous: Map<string, AlertMemory> | null;
    report: StatusReport;
    now: number;
    remindMs: number;
    alertOn?: AlertWhen;
}): { next: Map<string, AlertMemory>; emails: AlertEmail[] } {
    const alertOn = input.alertOn ?? 'down-and-degraded';
    const next = new Map<string, AlertMemory>();
    const opened: ServiceReport[] = [];
    const reminded: ServiceReport[] = [];
    const recovered: ServiceReport[] = [];

    for (const service of input.report.services) {
        const prev = input.previous?.get(service.id);
        const paging = shouldAlert(service.state, alertOn);
        const wasPaging = prev ? shouldAlert(prev.state, alertOn) : false;
        if (!paging) {
            if (wasPaging) recovered.push(service);
            next.set(service.id, { state: service.state, alertedAt: null });
            continue;
        }

        const changed = !wasPaging || prev?.state !== service.state;
        const due = prev?.alertedAt != null && input.now - prev.alertedAt >= input.remindMs;
        if (changed) opened.push(service);
        else if (due) reminded.push(service);
        next.set(service.id, {
            state: service.state,
            alertedAt: changed || due ? input.now : (prev?.alertedAt ?? input.now),
        });
    }

    const emails: AlertEmail[] = [];
    if (opened.length > 0) emails.push(downEmail(opened, input.report.checkedAt, false));
    if (reminded.length > 0) emails.push(downEmail(reminded, input.report.checkedAt, true));
    if (recovered.length > 0) emails.push(recoveredEmail(recovered, input.report.checkedAt));
    return { next, emails };
}

function downEmail(services: ServiceReport[], checkedAt: string, reminder: boolean): AlertEmail {
    const subject = services.length === 1
        ? `App Health Checker: ${services[0].name} is ${reminder ? 'still ' : ''}${services[0].state}`
        : `App Health Checker: ${services.length} services are ${reminder ? 'still ' : ''}${worst(services)}`;
    const lines = services.map(describeService);
    lines.push('', `Checked ${checkedAt}`);
    return { kind: 'down', subject, text: lines.join('\n') };
}

function recoveredEmail(services: ServiceReport[], checkedAt: string): AlertEmail {
    const allUp = services.every(service => service.state === 'up');
    const subject = services.length === 1
        ? `App Health Checker: ${services[0].name} ${allUp ? 'is responding' : `is ${services[0].state}`}`
        : `App Health Checker: ${services.length} services ${allUp ? 'are responding' : 'left the alert state'}`;
    const lines = services.map(service => (
        service.state === 'up'
            ? `${service.name} is responding again.`
            : `${service.name} is ${service.state}.`
    ));
    lines.push('', `Checked ${checkedAt}`);
    return { kind: 'recovered', subject, text: lines.join('\n') };
}

function describeService(service: ServiceReport): string {
    const lines = [`${service.name} is ${service.state}.`];
    if (service.detail) lines.push(service.detail);
    for (const dependency of service.dependencies) {
        if (dependency.state === 'up' || dependency.state === 'skipped') continue;
        lines.push(`${dependency.name}: ${dependency.state}${dependency.detail ? ` (${dependency.detail})` : ''}`);
    }
    return lines.join('\n');
}

function worst(services: ServiceReport[]): State {
    return services.some(service => service.state === 'down') ? 'down' : 'degraded';
}

function shouldAlert(state: State, alertOn: AlertWhen): boolean {
    if (state === 'down') return true;
    if (state === 'degraded') return alertOn === 'down-and-degraded';
    return false;
}
