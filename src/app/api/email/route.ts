import { NextResponse } from 'next/server';
import { denyUnlessAccess } from '@/lib/access-session';
import { sendStatusEmail } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

export async function POST() {
    const denied = await denyUnlessAccess();
    if (denied) return denied;
    const sent = await sendStatusEmail();
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 409 });
    return NextResponse.json({ subject: sent.subject }, { headers: { 'cache-control': 'no-store' } });
}
