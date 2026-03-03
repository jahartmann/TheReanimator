import { getJobs, getServersForDropdown } from '@/lib/actions/tasks';
import { TasksClient } from '@/components/tasks/TasksClient';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
    const jobs = await getJobs();
    const servers = await getServersForDropdown();

    return (
        <TasksClient
            initialJobs={jobs}
            servers={servers}
        />
    );
}
