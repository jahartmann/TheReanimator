
import db from './src/lib/db';
import { scanAllClusterTags, getTags } from './src/app/actions/tags';
import { getAISettings } from './src/app/actions/ai';

async function diagnose() {
    console.log('--- DIAGNOSTIC START ---');

    // 1. Check AI Settings
    try {
        console.log('Checking AI Settings...');
        const settings = await getAISettings();
        console.log('AI Settings:', settings);
        if (!settings.enabled) console.error('❌ AI is DISABLED');
        if (!settings.model) console.error('❌ No AI Model selected');
    } catch (e) {
        console.error('❌ Failed to get AI settings:', e);
    }

    // 2. Check Tags
    console.log('\nScanning Cluster Tags...');
    try {
        const result = await scanAllClusterTags();
        console.log('Scan Result:', result);
    } catch (e) {
        console.error('❌ Scan failed:', e);
    }

    console.log('\nReading Tags from DB...');
    try {
        const tags = await getTags();
        console.log(`Found ${tags.length} tags in DB:`);
        tags.forEach(t => console.log(`- ${t.name} (${t.id}) [${t.color}]`));
    } catch (e) {
        console.error('❌ Failed to read tags:', e);
    }

    console.log('--- DIAGNOSTIC END ---');
}

diagnose();
