import { NextResponse } from 'next/server';
import { clearAccess } from '@/lib/access-session';

export const dynamic = 'force-dynamic';

export async function POST() {
    await clearAccess();
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
