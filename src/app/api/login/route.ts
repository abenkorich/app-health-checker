import { NextResponse } from 'next/server';
import { clearLoginFailures, isAccessConfigured, loginAllowed, noteLoginFailure, verifyAccessSecret } from '@/lib/access';
import { grantAccess } from '@/lib/access-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    if (!isAccessConfigured()) {
        return NextResponse.json({ error: 'locked' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    const key = clientKey(request);
    if (!loginAllowed(key)) {
        return NextResponse.json({ error: 'limited' }, { status: 429, headers: { 'cache-control': 'no-store' } });
    }
    const secret = await readSecret(request);
    if (!verifyAccessSecret(secret)) {
        noteLoginFailure(key);
        return NextResponse.json({ error: 'invalid' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    }
    clearLoginFailures(key);
    await grantAccess();
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}

async function readSecret(request: Request): Promise<string> {
    try {
        const body = (await request.json()) as { secret?: unknown };
        return typeof body.secret === 'string' ? body.secret : '';
    } catch {
        return '';
    }
}

function clientKey(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || request.headers.get('x-real-ip')?.trim() || 'local';
}
