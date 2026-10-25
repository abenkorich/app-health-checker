import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    accessToken,
    clearLoginFailures,
    cookieMatches,
    isAccessConfigured,
    loginAllowed,
    noteLoginFailure,
    verifyAccessSecret,
} from '../src/lib/access.ts';

const env = { STATUS_SECRET: 'local-status-key' };

describe('status access', () => {
    it('stays closed until STATUS_SECRET is set', () => {
        assert.equal(isAccessConfigured({}), false);
        assert.equal(isAccessConfigured({ STATUS_SECRET: '   ' }), false);
        assert.equal(verifyAccessSecret('local-status-key', {}), false);
    });

    it('accepts the env key and a cookie that is its hash, not the key itself', () => {
        assert.equal(verifyAccessSecret('local-status-key', env), true);
        assert.equal(verifyAccessSecret('wrong', env), false);
        const token = accessToken('local-status-key');
        assert.equal(token.includes('local-status-key'), false);
        assert.equal(cookieMatches(token, env), true);
        assert.equal(cookieMatches(accessToken('wrong'), env), false);
    });

    it('stops a key after eight failures inside the window', () => {
        const key = `access-test-${Date.now()}`;
        clearLoginFailures(key);
        assert.equal(loginAllowed(key), true);
        for (let i = 0; i < 8; i += 1) noteLoginFailure(key);
        assert.equal(loginAllowed(key), false);
        clearLoginFailures(key);
        assert.equal(loginAllowed(key), true);
    });
});
