import { NextResponse } from 'next/server';
import { denyUnlessAccess } from '@/lib/access-session';
import { applySchedule } from '@/lib/monitor';
import { publicConfig, saveConfig } from '@/lib/settings-store';

export const dynamic = 'force-dynamic';

export async function GET() {
    const denied = await denyUnlessAccess();
    if (denied) return denied;
    return NextResponse.json(publicConfig(), { headers: { 'cache-control': 'no-store' } });
}

export async function PUT(request: Request) {
    const denied = await denyUnlessAccess();
    if (denied) return denied;
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Settings must be JSON.' }, { status: 400 });
    }
    const saved = saveConfig(body);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
    applySchedule();
    return NextResponse.json(saved.settings, { headers: { 'cache-control': 'no-store' } });
}
