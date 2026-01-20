import { getLibraryContent } from '@/app/actions/library';
import db from '@/lib/db';
import { LibraryView } from '@/components/library/LibraryView';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
    const items = await getLibraryContent();
    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

    // Transform items to match LibraryView expected props if needed, 
    // but they should match if I copied the interface correctly.
    // getLibraryContent return type is compatible with LibraryView props.

    return (
        <LibraryView initialItems={items} servers={servers} />
    );
}
