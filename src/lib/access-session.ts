import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
    ACCESS_COOKIE,
    accessCookieOptions,
    accessSecret,
    accessToken,
    cookieMatches,
    isAccessConfigured,
} from './access';

export async function requestHasAccess(): Promise<boolean> {
    if (!isAccessConfigured()) return false;
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    return cookieMatches(token);
}

export async function grantAccess(): Promise<void> {
    const secret = accessSecret();
    if (!secret) return;
    const store = await cookies();
    store.set(ACCESS_COOKIE, accessToken(secret), accessCookieOptions(process.env.NODE_ENV === 'production'));
}

export async function clearAccess(): Promise<void> {
    const store = await cookies();
    store.delete(ACCESS_COOKIE);
}

export async function denyUnlessAccess(): Promise<NextResponse | null> {
    if (await requestHasAccess()) return null;
    return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
    );
}
