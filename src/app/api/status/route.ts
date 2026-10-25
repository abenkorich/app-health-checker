import { NextResponse } from 'next/server';
import { denyUnlessAccess } from '@/lib/access-session';
import { currentReport, startMonitor } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    startMonitor();
    const denied = await denyUnlessAccess();
    if (denied) return denied;
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const body = await currentReport(refresh);
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
}
