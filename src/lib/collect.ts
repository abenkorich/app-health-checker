import { applyHomepage, applyRedis, applyWorker, buildReport, serviceFromHttp, serviceFromPlatform, type ServiceReport, type StatusReport } from './aggregate';
import { probeUrl } from './probe';
import { probeRedis } from './redis';
import { loadConfig } from './settings-store';
import { targetsFrom, type StatusSettings } from './settings-model';
import type { Target } from './targets';

export async function collectStatus(settings: StatusSettings = loadConfig(), now = new Date()): Promise<StatusReport> {
    const timeoutMs = settings.timeoutSeconds * 1000;
    const targets = targetsFrom(settings);
    const services = await Promise.all(targets.map(target => probeTarget(target, timeoutMs)));
    return buildReport(services, now.toISOString(), settings.pollSeconds * 1000);
}

async function probeTarget(target: Target, timeoutMs: number): Promise<ServiceReport> {
    const [report, home, worker, redis] = await Promise.all([
        probeHealth(target, timeoutMs),
        target.type === 'web-app' && target.homeUrl ? probeUrl(target.homeUrl, timeoutMs) : Promise.resolve(null),
        target.type === 'api' && target.workerUrl ? probeUrl(target.workerUrl, timeoutMs) : Promise.resolve(null),
        target.type === 'api' && target.redisUrl ? probeRedis(target.redisUrl, timeoutMs) : Promise.resolve(null),
    ]);
    return applyHomepage(applyWorker(applyRedis(report, redis), worker), home);
}

async function probeHealth(target: Target, timeoutMs: number): Promise<ServiceReport> {
    if (target.type === 'api') {
        const health = await probeUrl(target.healthUrl, timeoutMs);
        if (!target.readyUrl) return serviceFromHttp({ id: target.id, name: target.name, probe: health });
        const ready = health.ok ? await probeUrl(target.readyUrl, timeoutMs) : null;
        return serviceFromPlatform({ id: target.id, name: target.name, health, ready });
    }
    const probe = await probeUrl(target.healthUrl, timeoutMs);
    return serviceFromHttp({ id: target.id, name: target.name, probe });
}
