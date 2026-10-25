import type { ProbeSnapshot } from './aggregate';

export async function probeUrl(url: string, timeoutMs: number): Promise<ProbeSnapshot> {
    if (!/^https?:\/\//i.test(url)) {
        return { ok: false, status: null, latencyMs: 0, json: null };
    }
    const started = Date.now();
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
            redirect: 'follow',
        });
        const latencyMs = Date.now() - started;
        const text = await response.text();
        let json: unknown = null;
        if (text.length > 0 && text.length <= 8192) {
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
        }
        return { ok: response.ok, status: response.status, latencyMs, json };
    } catch {
        return { ok: false, status: null, latencyMs: Date.now() - started, json: null };
    }
}
