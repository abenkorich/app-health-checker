import type { State, UptimeSample } from './aggregate';

export type History = Record<string, UptimeSample[]>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 500;

/** Keep a day of checks for the apps that were just probed. */
export function appendHistory(
    history: History,
    services: Array<{ id: string; state: State; latencyMs: number | null }>,
    at: string,
): History {
    const cutoff = Date.parse(at) - DAY_MS;
    const next: History = {};
    for (const service of services) {
        const previous = (history[service.id] ?? []).filter(sample => {
            const time = Date.parse(sample.at);
            return Number.isFinite(time) && time >= cutoff && time <= Date.parse(at);
        });
        previous.push({ at, state: service.state, latencyMs: service.latencyMs });
        next[service.id] = previous.slice(-MAX_SAMPLES);
    }
    return next;
}

/** Share of samples that were fully up. `null` when nothing has been recorded. */
export function uptimeRatio(samples: UptimeSample[]): number | null {
    if (samples.length === 0) return null;
    return samples.filter(sample => sample.state === 'up').length / samples.length;
}
