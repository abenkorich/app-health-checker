import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRedisUrl, probeRedis } from '../src/lib/redis.ts';

describe('redis url', () => {
    it('reads the host and port and keeps the password out of the probe result', async () => {
        const parsed = parseRedisUrl('redis://:s3cret@127.0.0.1:6379/0');
        assert.equal(parsed?.host, '127.0.0.1');
        assert.equal(parsed?.port, 6379);
        assert.equal(parsed?.password, 's3cret');
        assert.equal(parseRedisUrl('http://127.0.0.1:6379'), null);

        const probe = await probeRedis('redis://:s3cret@127.0.0.1:1', 200);
        assert.equal(probe.ok, false);
        assert.equal(JSON.stringify(probe).includes('s3cret'), false);
    });
});
