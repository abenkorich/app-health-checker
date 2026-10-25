import { isAccessConfigured } from '@/lib/access';
import { requestHasAccess } from '@/lib/access-session';
import { Board } from '@/components/board';
import { Gate } from '@/components/gate';

export const dynamic = 'force-dynamic';

export default async function Page() {
    if (!isAccessConfigured()) return <Gate mode="unset" />;
    if (!(await requestHasAccess())) return <Gate mode="login" />;
    return <Board />;
}
