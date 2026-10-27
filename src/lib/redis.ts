import net from 'node:net';
import tls from 'node:tls';

export type RedisProbe = {
    ok: boolean;
    latencyMs: number;
    detail: 'timeout' | 'unreachable' | 'auth failed' | null;
};

export function parseRedisUrl(value: string): { host: string; port: number; username: string; password: string; tls: boolean } | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return null;
    const host = url.hostname;
    if (!host) return null;
    const port = url.port ? Number(url.port) : 6379;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
        host,
        port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        tls: url.protocol === 'rediss:',
    };
}

/** RESP PING. A password in the URL is sent as AUTH and is not returned. */
export function probeRedis(value: string, timeoutMs: number): Promise<RedisProbe> {
    const target = parseRedisUrl(value);
    if (!target) return Promise.resolve({ ok: false, latencyMs: 0, detail: 'unreachable' });
    const started = Date.now();
    return new Promise(resolve => {
        const socket = target.tls
            ? tls.connect({ host: target.host, port: target.port, servername: target.host })
            : net.connect({ host: target.host, port: target.port });
        let settled = false;
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => finish('timeout'), timeoutMs);

        function finish(detail: RedisProbe['detail']) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            const latencyMs = Date.now() - started;
            resolve(detail ? { ok: false, latencyMs, detail } : { ok: true, latencyMs, detail: null });
        }

        socket.on('error', () => finish('unreachable'));
        socket.on('data', data => {
            chunks.push(Buffer.from(data));
            const text = Buffer.concat(chunks).toString('utf8');
            if (text.includes('\r\n-') || text.startsWith('-')) {
                finish('auth failed');
                return;
            }
            if (text.includes('+PONG')) finish(null);
        });

        const parts: string[][] = [];
        if (target.password) {
            parts.push(target.username ? ['AUTH', target.username, target.password] : ['AUTH', target.password]);
        }
        parts.push(['PING']);
        try {
            socket.write(parts.map(encodeRedisCommand).join(''));
        } catch {
            finish('unreachable');
        }
    });
}

function encodeRedisCommand(parts: string[]): string {
    return `*${parts.length}\r\n${parts.map(part => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}
