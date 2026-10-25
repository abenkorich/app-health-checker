import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendHistory, uptimeRatio } from '../src/lib/history.ts';

describe('uptime history', () => {
    it('records the latest check and reports the share that stayed up', () => {
        const first = appendHistory({}, [{ id: 'billing', state: 'up', latencyMs: 12 }], '2026-10-25T08:00:00.000Z');
        const second = appendHistory(first, [
            { id: 'billing', state: 'down', latencyMs: null },
            { id: 'storefront', state: 'up', latencyMs: 8 },
        ], '2026-10-25T08:01:00.000Z');
        assert.equal(second.billing?.length, 2);
        assert.equal(second.storefront?.length, 1);
        assert.equal(uptimeRatio(second.billing ?? []), 0.5);
        assert.equal(uptimeRatio([]), null);
    });

    it('drops samples older than a day and apps that are no longer watched', () => {
        const history = appendHistory({
            billing: [{ at: '2026-10-23T08:00:00.000Z', state: 'up', latencyMs: 4 }],
            retired: [{ at: '2026-10-25T08:00:00.000Z', state: 'down', latencyMs: null }],
        }, [{ id: 'billing', state: 'up', latencyMs: 9 }], '2026-10-25T09:00:00.000Z');
        assert.deepEqual(history.billing?.map(sample => sample.at), ['2026-10-25T09:00:00.000Z']);
        assert.equal(history.retired, undefined);
    });
});
