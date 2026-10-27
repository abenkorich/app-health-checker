import { alertRemindMs, readMailConfig, type AlertWhen, type MailConfig } from './alerts.ts';
import { parseRedisUrl } from './redis.ts';
import { envUrl, pollIntervalMs, probeTimeoutMs, SERVICE_CATALOG, type AppType, type Target } from './targets.ts';

export type ServiceSetting = {
    id: string;
    name: string;
    type: AppType;
    kind: Target['kind'];
    enabled: boolean;
    healthUrl: string;
    readyUrl: string;
    homeUrl: string;
    workerUrl: string;
    redisUrl: string;
};

export type StatusSettings = {
    pollSeconds: number;
    timeoutSeconds: number;
    alertOn: AlertWhen;
    remindMinutes: number;
    recipients: string;
    from: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    services: ServiceSetting[];
};

export type PublicSettings = Omit<StatusSettings, 'smtpPassword'> & {
    passwordSet: boolean;
};

export type SettingsInput = Partial<Omit<StatusSettings, 'services' | 'smtpPassword'>> & {
    smtpPassword?: string;
    services?: Array<Partial<ServiceSetting> & { id: string }>;
};

/** Env values fill the form the first time. A saved file replaces them. */
export function defaultSettings(env: NodeJS.ProcessEnv = process.env): StatusSettings {
    const port = Number(env.EMAIL_SMTP_PORT || 465);
    return {
        pollSeconds: Math.round(pollIntervalMs(env) / 1000),
        timeoutSeconds: Math.max(1, Math.round(probeTimeoutMs(env) / 1000)),
        alertOn: 'down-and-degraded',
        remindMinutes: Math.max(1, Math.round(alertRemindMs(env) / 60_000)),
        recipients: env.ALERT_EMAIL_TO?.trim() ?? '',
        from: env.EMAIL_FROM_ADDRESS?.trim() ?? '',
        smtpHost: env.EMAIL_SMTP_HOST?.trim() ?? '',
        smtpPort: Number.isInteger(port) && port > 0 && port < 65536 ? port : 465,
        smtpUser: env.EMAIL_SMTP_USERNAME?.trim() ?? '',
        smtpPassword: env.EMAIL_SMTP_PASSWORD ?? '',
        services: SERVICE_CATALOG.map(item => {
            const health = envUrl(env, item.env, item.fallback);
            const ready = item.readyEnv && item.readyFallback
                ? envUrl(env, item.readyEnv, item.readyFallback)
                : { enabled: false, url: '' };
            const home = item.homeEnv && item.homeFallback
                ? envUrl(env, item.homeEnv, item.homeFallback)
                : { enabled: false, url: '' };
            const worker = item.workerEnv && item.workerFallback
                ? envUrl(env, item.workerEnv, item.workerFallback)
                : { enabled: false, url: '' };
            const redis = item.redisEnv && item.redisFallback
                ? envUrl(env, item.redisEnv, item.redisFallback)
                : { enabled: false, url: '' };
            return {
                id: item.id,
                name: item.name,
                type: item.type,
                kind: item.kind,
                enabled: health.enabled,
                healthUrl: health.url,
                readyUrl: ready.enabled ? ready.url : '',
                homeUrl: home.enabled ? home.url : '',
                workerUrl: worker.enabled ? worker.url : '',
                redisUrl: redis.enabled ? redis.url : '',
            };
        }),
    };
}

export function toPublic(settings: StatusSettings): PublicSettings {
    const { smtpPassword, ...rest } = settings;
    return { ...rest, passwordSet: smtpPassword.trim().length > 0 };
}

export function parseSettings(input: unknown, current: StatusSettings): { ok: true; settings: StatusSettings } | { ok: false; error: string } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Settings must be an object.' };
    const body = input as SettingsInput;
    const pollSeconds = integer(body.pollSeconds, 15, 24 * 60 * 60);
    const timeoutSeconds = integer(body.timeoutSeconds, 1, 10);
    const remindMinutes = integer(body.remindMinutes, 1, 24 * 60);
    const smtpPort = integer(body.smtpPort, 1, 65535);
    if (pollSeconds == null) return { ok: false, error: 'Check interval must be between 15 seconds and 24 hours.' };
    if (timeoutSeconds == null) return { ok: false, error: 'Timeout must be between 1 and 10 seconds.' };
    if (remindMinutes == null) return { ok: false, error: 'Reminder must be between 1 minute and 24 hours.' };
    if (smtpPort == null) return { ok: false, error: 'SMTP port must be between 1 and 65535.' };
    if (body.alertOn !== 'down' && body.alertOn !== 'down-and-degraded') {
        return { ok: false, error: 'Choose when email is sent.' };
    }

    const recipients = typeof body.recipients === 'string' ? body.recipients : '';
    const emails = recipients.split(',').map(item => item.trim()).filter(Boolean);
    if (emails.some(item => !/^[^\s@]+@[^\s@]+$/.test(item))) {
        return { ok: false, error: 'Recipients must be email addresses, separated by commas.' };
    }
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const smtpHost = typeof body.smtpHost === 'string' ? body.smtpHost.trim() : '';
    const smtpUser = typeof body.smtpUser === 'string' ? body.smtpUser.trim() : '';
    if (emails.length > 0 && (!smtpHost || !from.includes('@'))) {
        return { ok: false, error: 'Email needs an SMTP host and a from address.' };
    }

    const services = parseServices(body.services, current);
    if (!services.ok) return services;

    const password = typeof body.smtpPassword === 'string' && body.smtpPassword.length > 0
        ? body.smtpPassword
        : current.smtpPassword;

    return {
        ok: true,
        settings: {
            pollSeconds,
            timeoutSeconds,
            alertOn: body.alertOn,
            remindMinutes,
            recipients: emails.join(', '),
            from,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPassword: password,
            services: services.services,
        },
    };
}

export function targetsFrom(settings: StatusSettings): Target[] {
    const targets: Target[] = [];
    for (const service of settings.services) {
        if (!service.enabled) continue;
        const target: Target = {
            id: service.id,
            name: service.name,
            type: service.type,
            kind: service.type === 'api' ? 'platform' : 'http',
            healthUrl: service.healthUrl,
        };
        if (service.type === 'api' && service.readyUrl.trim()) target.readyUrl = service.readyUrl.trim();
        if (service.type === 'api' && service.workerUrl.trim()) target.workerUrl = service.workerUrl.trim();
        if (service.type === 'api' && service.redisUrl.trim()) target.redisUrl = service.redisUrl.trim();
        if (service.type === 'web-app' && service.homeUrl.trim()) target.homeUrl = service.homeUrl.trim();
        targets.push(target);
    }
    return targets;
}

export function mailFromSettings(settings: StatusSettings): MailConfig | null {
    return readMailConfig({
        ALERT_EMAIL_TO: settings.recipients,
        EMAIL_FROM_ADDRESS: settings.from,
        EMAIL_SMTP_HOST: settings.smtpHost,
        EMAIL_SMTP_PORT: String(settings.smtpPort),
        EMAIL_SMTP_USERNAME: settings.smtpUser,
        EMAIL_SMTP_PASSWORD: settings.smtpPassword,
    });
}

function parseServices(
    input: SettingsInput['services'],
    current: StatusSettings,
): { ok: true; services: ServiceSetting[] } | { ok: false; error: string } {
    if (!input) return { ok: true, services: current.services };
    if (input.length > 30) return { ok: false, error: 'Keep the list to 30 apps.' };
    const services: ServiceSetting[] = [];
    const used = new Set<string>();
    for (const item of input) {
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!name || name.length > 80) return { ok: false, error: 'Each app needs a name of up to 80 characters.' };
        const enabled = item.enabled === true;
        const healthUrl = typeof item.healthUrl === 'string' ? item.healthUrl.trim() : '';
        const readyUrl = typeof item.readyUrl === 'string' ? item.readyUrl.trim() : '';
        const known = current.services.find(service => service.id === item.id);
        const homeUrl = typeof item.homeUrl === 'string' ? item.homeUrl.trim() : (known?.homeUrl ?? '');
        const workerUrl = typeof item.workerUrl === 'string' ? item.workerUrl.trim() : (known?.workerUrl ?? '');
        const redisUrl = typeof item.redisUrl === 'string' ? item.redisUrl.trim() : (known?.redisUrl ?? '');
        const type: AppType = item.type === 'api' || item.type === 'web-app'
            ? item.type
            : (known?.type ?? (readyUrl ? 'api' : 'web-app'));
        if (enabled && !isHttp(healthUrl)) return { ok: false, error: `${name} needs an http or https health URL.` };
        if (readyUrl && !isHttp(readyUrl)) return { ok: false, error: `${name} ready URL must be http or https.` };
        if (homeUrl && !isHttp(homeUrl)) return { ok: false, error: `${name} homepage URL must be http or https.` };
        if (workerUrl && !isHttp(workerUrl)) return { ok: false, error: `${name} worker URL must be http or https.` };
        if (redisUrl && !parseRedisUrl(redisUrl)) return { ok: false, error: `${name} Redis URL must start with redis:// or rediss://.` };
        const requested = typeof item.id === 'string' && /^[a-z0-9][a-z0-9-]{0,48}$/.test(item.id) ? item.id : '';
        const id = requested && !used.has(requested) ? requested : uniqueId(name, used);
        used.add(id);
        services.push({
            id,
            name,
            type,
            kind: type === 'api' ? 'platform' : 'http',
            enabled,
            healthUrl,
            readyUrl,
            homeUrl,
            workerUrl,
            redisUrl,
        });
    }
    return { ok: true, services };
}

function uniqueId(name: string, used: Set<string>): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const base = slug || 'app';
    let id = base;
    let n = 2;
    while (used.has(id)) {
        id = `${base.slice(0, 40)}-${n}`;
        n += 1;
    }
    return id;
}

function isHttp(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function integer(value: unknown, min: number, max: number): number | null {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) return null;
    return number;
}
