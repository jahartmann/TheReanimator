import db from '@/lib/db';
import NewServerForm from './NewServerForm';

export const dynamic = 'force-dynamic';

interface ServerItem {
    group_name?: string | null;
}

export default function NewServerPage() {
    // Get unique groups from existing servers
    const servers = db.prepare('SELECT DISTINCT group_name FROM servers WHERE group_name IS NOT NULL').all() as ServerItem[];
    const groups = servers
        .map(s => s.group_name)
        .filter((g): g is string => g !== null && g !== undefined && g.trim() !== '')
        .sort();

    return <NewServerForm existingGroups={groups} />;
}
