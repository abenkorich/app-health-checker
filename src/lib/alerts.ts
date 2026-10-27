import type { ServiceReport, State, StatusReport } from './aggregate';

export type AlertMemory = {
    state: State;
    alertedAt: number | null;
};

export type AlertEmail = {
    kind: 'down' | 'recovered' | 'status';
    subject: string;
    text: string;
    html: string;
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
    if (opened.length > 0) emails.push(statusEmail(opened, input.report, false));
    if (reminded.length > 0) emails.push(statusEmail(reminded, input.report, true));
    if (recovered.length > 0) emails.push(statusEmail(recovered, input.report, false, 'recovered'));
    return { next, emails };
}

/** A full board snapshot, sent when someone asks for the current status. */
export function statusSnapshot(report: StatusReport): AlertEmail {
    const down = report.services.filter(service => service.state === 'down');
    const degraded = report.services.filter(service => service.state === 'degraded');
    const parts = [down.length > 0 ? `${down.length} down` : 'none down'];
    if (degraded.length > 0) parts.push(`${degraded.length} degraded`);
    const subject = `App Health Checker: ${parts.join(', ')} · overall ${report.state}`;
    const lines = [
        `Overall: ${report.state}`,
        '',
        ...report.services.map(describeService),
        '',
        `Checked ${report.checkedAt}`,
    ];
    return {
        kind: 'status',
        subject,
        text: lines.join('\n'),
        html: renderEmail(down, report, false, 'status'),
    };
}

function statusEmail(
    focus: ServiceReport[],
    report: StatusReport,
    reminder: boolean,
    kind: AlertEmail['kind'] = 'down',
): AlertEmail {
    const subject = `App Health Checker: ${statusPhrase(focus, reminder)} · overall ${report.state}`;
    const lines = [
        `Overall: ${report.state}`,
        '',
        ...focus.map(service => (
            kind === 'recovered' ? `${service.name} is ${service.state}.` : describeService(service)
        )),
        '',
        `Checked ${report.checkedAt}`,
    ];
    return {
        kind,
        subject,
        text: lines.join('\n'),
        html: renderEmail(focus, report, reminder, kind),
    };
}

function statusPhrase(services: ServiceReport[], reminder: boolean): string {
    const still = reminder ? 'still ' : '';
    if (services.length === 1) return `${oneLine(services[0].name)} ${still}${services[0].state}`;
    const parts: string[] = [];
    const down = services.filter(service => service.state === 'down').length;
    const degraded = services.filter(service => service.state === 'degraded').length;
    const up = services.filter(service => service.state === 'up').length;
    if (down > 0) parts.push(`${down} ${still}down`);
    if (degraded > 0) parts.push(`${degraded} ${still}degraded`);
    if (up > 0) parts.push(`${up} up`);
    return parts.join(', ') || `${services.length} ${still}${worst(services)}`;
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

const STATE_COLOR: Record<State, { bar: string; ink: string; wash: string }> = {
    up: { bar: '#1f8a4c', ink: '#166534', wash: '#ecfdf3' },
    degraded: { bar: '#d97706', ink: '#92400e', wash: '#fff7ed' },
    down: { bar: '#2563eb', ink: '#1d4ed8', wash: '#eff6ff' },
};

function renderEmail(focus: ServiceReport[], report: StatusReport, reminder: boolean, kind: AlertEmail['kind']): string {
    const headline = kind === 'status' ? 'Current status' : kind === 'recovered' ? 'Recovered' : reminder ? 'Still down' : 'Needs attention';
    const widgets = report.services.map(widget).join('');
    const names = focus.map(service => esc(service.name)).join(', ');
    const subtitle = names ? `${esc(headline)} · ${names}` : esc(headline);
    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#122027;">
<tr><td style="padding:0 4px 16px;">
<div style="font-size:12px;font-weight:600;letter-spacing:0.08em;color:#5c6b73;">APP HEALTH CHECKER</div>
<div style="margin-top:6px;font-size:22px;font-weight:650;letter-spacing:-0.02em;">Overall ${esc(report.state)}</div>
<div style="margin-top:4px;font-size:14px;color:#5c6b73;">${subtitle}</div>
</td></tr>
${widgets}
<tr><td style="padding:8px 4px 0;font-size:12px;color:#5c6b73;">Checked ${esc(report.checkedAt)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function widget(service: ServiceReport): string {
    const color = STATE_COLOR[service.state];
    const meta = [service.latencyMs == null ? '' : `${service.latencyMs} ms`, service.version ?? '']
        .filter(Boolean)
        .map(esc)
        .join(' · ');
    const failing = service.dependencies.filter(item => item.state !== 'up' && item.state !== 'skipped');
    const deps = failing.map(item => (
        `<div style="margin-top:4px;font-size:13px;color:#5c6b73;">${esc(item.name)}: ${esc(item.state)}${item.detail ? ` (${esc(item.detail)})` : ''}</div>`
    )).join('');
    return `<tr><td style="padding:0 0 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" data-widget="${esc(service.id)}" style="background:#ffffff;border:1px solid #e4e8eb;border-left:3px solid ${color.bar};border-radius:10px;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:15px;font-weight:650;">${esc(service.name)}</td>
<td align="right"><span style="display:inline-block;padding:2px 8px;border-radius:7px;background:${color.wash};color:${color.ink};font-size:12px;font-weight:650;">${esc(label(service.state))}</span></td>
</tr></table>
${meta ? `<div style="margin-top:8px;font-size:13px;color:#5c6b73;">${meta}</div>` : ''}
${service.detail ? `<div style="margin-top:6px;font-size:13px;color:#122027;">${esc(service.detail)}</div>` : ''}
${deps}
</td></tr>
</table>
</td></tr>`;
}

function label(state: State): string {
    if (state === 'up') return 'Up';
    if (state === 'degraded') return 'Degraded';
    return 'Down';
}

function esc(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function oneLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
}

function worst(services: ServiceReport[]): State {
    return services.some(service => service.state === 'down') ? 'down' : 'degraded';
}

function shouldAlert(state: State, alertOn: AlertWhen): boolean {
    if (state === 'down') return true;
    if (state === 'degraded') return alertOn === 'down-and-degraded';
    return false;
}
