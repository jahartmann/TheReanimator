/**
 * Memory Consolidation - Short-term (chat) → Long-term (brain) transfer.
 * Extracts insights from conversations and saves them to the brain.
 */

import db from '@/lib/db';
import { saveBrainEntry, searchBrain, processEmbeddingQueue } from './brain';
import { classifyDomain, extractTags, type BrainDomain } from './domains';
import { getTodaysJournal } from './journal';

interface ChatMessage {
    id: number;
    role: string;
    content: string;
    tool_name?: string;
    tool_result?: string;
}

/**
 * Consolidate a chat session into brain entries.
 * Called at session end or by nightly job.
 */
export async function consolidateSession(sessionId: number): Promise<number> {
    const messages = db.prepare(`
        SELECT id, role, content, tool_name, tool_result
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    `).all(sessionId) as ChatMessage[];

    if (messages.length < 2) return 0; // Too few messages to extract insights (lowered from 3)

    // Check if already consolidated
    const existing = db.prepare(
        'SELECT id FROM memory_consolidation WHERE session_id = ?'
    ).get(sessionId);
    if (existing) return 0;

    const insights = extractInsights(messages);
    let savedCount = 0;

    for (const insight of insights) {
        // Check for duplicates using search — guard against embedding/FTS failures
        let duplicates: Awaited<ReturnType<typeof searchBrain>> = [];
        try {
            duplicates = await searchBrain(insight.title, 3);
        } catch {
            // searchBrain failure is non-fatal; proceed without duplicate check
        }
        const isDuplicate = duplicates.some(d =>
            d.entry.key === insight.key ||
            (d.rank < -5 && d.entry.title.toLowerCase() === insight.title.toLowerCase())
        );

        if (!isDuplicate) {
            const entry = saveBrainEntry({
                key: insight.key,
                title: insight.title,
                content: insight.content,
                domain: insight.domain as BrainDomain,
                importance: insight.importance,
                tags: insight.tags,
            });

            // Log the consolidation
            db.prepare(`
                INSERT INTO memory_consolidation (session_id, message_ids, brain_entry_id, consolidation_type)
                VALUES (?, ?, ?, 'auto')
            `).run(
                sessionId,
                JSON.stringify(insight.sourceMessageIds),
                entry.id
            );

            savedCount++;
        }
    }

    return savedCount;
}

/**
 * Run nightly consolidation across all unconsolidated sessions.
 * EXTENDED: Daily report generation, brain entry, email report, telegram summary.
 */
export async function runNightlyConsolidation(): Promise<{
    sessionsProcessed: number;
    entriesSaved: number;
    journalConsolidated: boolean;
    embeddingsProcessed: number;
    dailyReportSent: boolean;
}> {
    console.log('[Consolidation] Starting nightly sleep phase...');

    // 1. Read today's journal
    const journalEntries = getTodaysJournal();
    console.log(`[Consolidation] Journal entries today: ${journalEntries.length}`);

    // 2. Consolidate chat sessions (existing logic)
    const sessions = db.prepare(`
        SELECT DISTINCT cs.id
        FROM chat_sessions cs
        JOIN chat_messages cm ON cm.session_id = cs.id
        LEFT JOIN memory_consolidation mc ON mc.session_id = cs.id
        WHERE mc.id IS NULL
        AND cs.updated_at > datetime('now', '-7 days')
        GROUP BY cs.id
        HAVING COUNT(cm.id) >= 3
    `).all() as { id: number }[];

    let totalSaved = 0;

    for (const session of sessions) {
        totalSaved += await consolidateSession(session.id);
    }

    // 3. Generate comprehensive daily report (replaces old critical-only logic)
    let journalConsolidated = false;
    let dailyReportSent = false;
    try {
        const { generateDailySummary } = await import('./active-learning');
        const report = generateDailySummary();

        // Save daily report to brain
        saveBrainEntry({
            key: report.brainEntry.key,
            title: report.brainEntry.title,
            content: report.brainEntry.content,
            domain: 'operations',
            importance: 5,
            tags: ['tagesbericht', 'auto', 'consolidation'],
        });
        journalConsolidated = true;
        console.log(`[Consolidation] Daily report saved to brain: ${report.brainEntry.key}`);

        // Send Telegram summary (short)
        try {
            const { broadcastMessage } = await import('@/lib/agent/telegram');
            await broadcastMessage(report.telegramSummary);
            console.log('[Consolidation] Telegram daily summary sent');
        } catch (e) {
            console.error('[Consolidation] Telegram summary failed:', e);
        }

        // Send Email report (detailed HTML)
        try {
            const { sendEmail } = await import('@/lib/email');

            // Get email recipients from notification preferences or settings
            const recipients: string[] = [];

            // From notification preferences
            try {
                const prefs = db.prepare(`
                    SELECT DISTINCT u.email FROM notification_preferences np
                    JOIN users u ON np.user_id = u.id
                    WHERE np.channel = 'email' AND u.email IS NOT NULL
                `).all() as { email: string }[];
                prefs.forEach(p => recipients.push(p.email));
            } catch { /* table might not exist */ }

            // From settings fallback
            if (recipients.length === 0) {
                try {
                    const emailSetting = db.prepare("SELECT value FROM settings WHERE key = 'notification_email'").get() as { value: string } | undefined;
                    if (emailSetting?.value) recipients.push(emailSetting.value);
                } catch { /* setting might not exist */ }
            }

            for (const email of recipients) {
                const subject = `[Reanimator] Tagesbericht — ${new Date().toLocaleDateString('de-DE')}`;
                await sendEmail(email, subject, report.htmlReport);
                console.log(`[Consolidation] Daily report email sent to ${email}`);
            }
            dailyReportSent = recipients.length > 0;
        } catch (e) {
            console.error('[Consolidation] Email report failed:', e);
        }
    } catch (e) {
        console.error('[Consolidation] Daily report generation failed:', e);
    }

    // 4. Process embedding queue (batch of 20)
    let embeddingsProcessed = 0;
    try {
        const result = await processEmbeddingQueue(20);
        embeddingsProcessed = result.processed;
        console.log(`[Consolidation] Embeddings processed: ${result.processed}, failed: ${result.failed}`);
    } catch (e) {
        console.error('[Consolidation] Embedding processing failed:', e);
    }

    // 5. Clean old working memory (> 24h)
    db.prepare("DELETE FROM working_memory WHERE updated_at < datetime('now', '-1 day')").run();

    // 6. Clean old monitor results (> 30 days)
    try {
        db.prepare("DELETE FROM monitor_results WHERE created_at < datetime('now', '-30 days')").run();
    } catch { /* table might not exist yet */ }

    // 7. Clean old notification history (> 90 days)
    try {
        db.prepare("DELETE FROM notification_history WHERE sent_at < datetime('now', '-90 days')").run();
    } catch { /* table might not exist yet */ }

    // 8. Brain statistics
    const brainStats = db.prepare('SELECT COUNT(*) as total FROM brain_entries').get() as { total: number };
    const withEmbeddings = db.prepare('SELECT COUNT(*) as total FROM brain_entries WHERE embedding IS NOT NULL').get() as { total: number };
    console.log(`[Consolidation] Brain: ${brainStats.total} entries, ${withEmbeddings.total} with embeddings`);

    console.log(`[Consolidation] Sleep phase complete: ${sessions.length} sessions, ${totalSaved} brain entries saved`);

    return {
        sessionsProcessed: sessions.length,
        entriesSaved: totalSaved,
        journalConsolidated,
        embeddingsProcessed,
        dailyReportSent,
    };
}

// --- Insight extraction ---

interface Insight {
    key: string;
    title: string;
    content: string;
    domain: string;
    importance: number;
    tags: string[];
    sourceMessageIds: number[];
}

function extractInsights(messages: ChatMessage[]): Insight[] {
    const insights: Insight[] = [];

    // Extract tool-based insights (LOWERED threshold from 2 to 1)
    const toolSequences = extractToolSequences(messages);
    for (const seq of toolSequences) {
        if (seq.tools.length >= 1) {
            const insight = buildToolInsight(seq);
            if (insight) insights.push(insight);
        }
    }

    // Extract problem-solution patterns
    const problemSolutions = extractProblemSolutions(messages);
    for (const ps of problemSolutions) {
        insights.push(ps);
    }

    // NEW: Extract server/infrastructure info
    const infraInsights = extractInfrastructureInfo(messages);
    for (const inf of infraInsights) {
        insights.push(inf);
    }

    // NEW: Extract configuration discoveries
    const configInsights = extractConfigurationInfo(messages);
    for (const conf of configInsights) {
        insights.push(conf);
    }

    // NEW: Extract user preferences and decisions
    const prefInsights = extractUserPreferences(messages);
    for (const pref of prefInsights) {
        insights.push(pref);
    }

    return insights;
}

interface ToolSequence {
    tools: { name: string; result: string }[];
    userMessage: string;
    assistantSummary: string;
    messageIds: number[];
}

function extractToolSequences(messages: ChatMessage[]): ToolSequence[] {
    const sequences: ToolSequence[] = [];
    let currentSeq: ToolSequence | null = null;

    for (const msg of messages) {
        if (msg.role === 'user' && !currentSeq) {
            currentSeq = { tools: [], userMessage: msg.content, assistantSummary: '', messageIds: [msg.id] };
        } else if (msg.role === 'tool' && currentSeq && msg.tool_name) {
            currentSeq.tools.push({ name: msg.tool_name, result: msg.tool_result || msg.content });
            currentSeq.messageIds.push(msg.id);
        } else if (msg.role === 'assistant' && currentSeq) {
            currentSeq.assistantSummary = msg.content;
            currentSeq.messageIds.push(msg.id);
            if (currentSeq.tools.length > 0) {
                sequences.push(currentSeq);
            }
            currentSeq = null;
        } else if (msg.role === 'user' && currentSeq) {
            // New user message starts a new sequence
            if (currentSeq.tools.length > 0) {
                sequences.push(currentSeq);
            }
            currentSeq = { tools: [], userMessage: msg.content, assistantSummary: '', messageIds: [msg.id] };
        }
    }

    if (currentSeq && currentSeq.tools.length > 0) {
        sequences.push(currentSeq);
    }

    return sequences;
}

function buildToolInsight(seq: ToolSequence): Insight | null {
    const toolNames = seq.tools.map(t => t.name).join(', ');
    const timestamp = new Date().toISOString().slice(0, 10);
    const key = `auto_${toolNames.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${timestamp}`;

    const content = [
        `## Kontext`,
        `User-Anfrage: ${seq.userMessage.slice(0, 200)}`,
        '',
        `## Verwendete Tools`,
        ...seq.tools.map(t => `- **${t.name}**: ${t.result.slice(0, 150)}`),
        '',
        `## Ergebnis`,
        seq.assistantSummary.slice(0, 500),
    ].join('\n');

    const domain = classifyDomain(key, content);
    const tags = extractTags(content);

    return {
        key,
        title: `Auto-Insight: ${seq.userMessage.slice(0, 60)}`,
        content,
        domain,
        importance: 3,
        tags,
        sourceMessageIds: seq.messageIds,
    };
}

function extractProblemSolutions(messages: ChatMessage[]): Insight[] {
    const insights: Insight[] = [];

    // Look for error → fix patterns
    for (let i = 0; i < messages.length - 2; i++) {
        const msg = messages[i];
        if (msg.role !== 'user') continue;

        const problemKeywords = /(?:fehler|error|problem|kaputt|geht nicht|funktioniert nicht|down|crashed|failed)/i;
        if (!problemKeywords.test(msg.content)) continue;

        // Find the solution (assistant response after tools)
        for (let j = i + 1; j < messages.length; j++) {
            if (messages[j].role === 'assistant' && messages[j].content.length > 50) {
                const solutionKeywords = /(?:gelöst|fixed|behoben|lösung|solution|erfolgreich|funktioniert|läuft)/i;
                if (solutionKeywords.test(messages[j].content)) {
                    const timestamp = new Date().toISOString().slice(0, 10);
                    const key = `troubleshooting_auto_${timestamp}_${i}`;
                    const content = [
                        `## Problem`,
                        msg.content.slice(0, 300),
                        '',
                        `## Lösung`,
                        messages[j].content.slice(0, 500),
                    ].join('\n');

                    insights.push({
                        key,
                        title: `Troubleshooting: ${msg.content.slice(0, 60)}`,
                        content,
                        domain: 'troubleshooting',
                        importance: 5,
                        tags: extractTags(content),
                        sourceMessageIds: [msg.id, messages[j].id],
                    });
                    break;
                }
            }
        }
    }

    return insights;
}

/**
 * Extract infrastructure information (server specs, VM configs, storage layout).
 */
function extractInfrastructureInfo(messages: ChatMessage[]): Insight[] {
    const insights: Insight[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role !== 'tool') continue;

        // Server info tools
        if (msg.tool_name === 'getServerDetails' || msg.tool_name === 'listVMs') {
            try {
                const result = JSON.parse(msg.tool_result || msg.content);
                if (result.success) {
                    const timestamp = Date.now();
                    const serverName = result.server || 'unknown';
                    const key = `infrastructure_${serverName}_${timestamp}`.replace(/[^a-zA-Z0-9_]/g, '_');

                    let content = '';
                    if (msg.tool_name === 'getServerDetails') {
                        content = [
                            `# Server: ${serverName}`,
                            '',
                            '## System Information',
                            result.system ? `- **OS**: ${result.system.os || 'N/A'}` : '',
                            result.system ? `- **Kernel**: ${result.system.kernel || 'N/A'}` : '',
                            result.system ? `- **Uptime**: ${result.system.uptime || 'N/A'}` : '',
                            '',
                            '## Resources',
                            result.cpu ? `- **CPU**: ${result.cpu.model || 'N/A'} (${result.cpu.cores || 'N/A'} cores)` : '',
                            result.memory ? `- **RAM**: ${result.memory.total || 'N/A'}` : '',
                            '',
                            '## Network',
                            result.networkCount ? `- **Interfaces**: ${result.networkCount}` : '',
                        ].filter(Boolean).join('\n');
                    } else if (msg.tool_name === 'listVMs') {
                        const vmCount = result.count || 0;
                        content = [
                            `# VMs on ${serverName}`,
                            '',
                            `Total VMs/Containers: ${vmCount}`,
                            '',
                            result.vms && result.vms.length > 0 ? '## VM List' : '',
                            ...(result.vms || []).slice(0, 10).map((vm: any) =>
                                `- **${vm.name || vm.vmid}** (${vm.type || 'qemu'}): ${vm.status || 'unknown'} - ${vm.maxmem ? Math.round(parseInt(vm.maxmem) / 1024 / 1024 / 1024) + 'GB RAM' : ''}`
                            ),
                        ].filter(Boolean).join('\n');
                    }

                    if (content) {
                        insights.push({
                            key,
                            title: `Infrastructure: ${serverName}`,
                            content,
                            domain: 'infrastructure',
                            importance: 4,
                            tags: extractTags(content),
                            sourceMessageIds: [msg.id],
                        });
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }

        // Diagnostic command results (df, free, ip a, etc.)
        if (msg.tool_name === 'runAutonomousCommand' || msg.tool_name === 'executeSSHCommand') {
            try {
                const result = JSON.parse(msg.tool_result || msg.content);
                if (result.success && result.output) {
                    const output = result.output.toLowerCase();
                    const timestamp = Date.now();

                    // Storage diagnostics
                    if (output.includes('filesystem') || output.includes('/dev/')) {
                        const serverName = result.server || 'unknown';
                        const key = `diagnostics_storage_${serverName}_${timestamp}`.replace(/[^a-zA-Z0-9_]/g, '_');
                        insights.push({
                            key,
                            title: `Storage Diagnostics: ${serverName}`,
                            content: `# Storage Information - ${serverName}\n\n\`\`\`\n${result.output.slice(0, 1000)}\n\`\`\``,
                            domain: 'infrastructure',
                            importance: 3,
                            tags: ['storage', 'diagnostics'],
                            sourceMessageIds: [msg.id],
                        });
                    }
                }
            } catch {
                // Ignore
            }
        }
    }

    return insights;
}

/**
 * Extract configuration information and settings.
 */
function extractConfigurationInfo(messages: ChatMessage[]): Insight[] {
    const insights: Insight[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Look for configuration-related conversations
        if (msg.role === 'user') {
            const configKeywords = /(?:config|konfiguration|einstellung|setting|setup|wie.+einricht|wie.+konfigur)/i;
            if (configKeywords.test(msg.content)) {
                // Find the assistant's answer
                for (let j = i + 1; j < Math.min(i + 5, messages.length); j++) {
                    if (messages[j].role === 'assistant' && messages[j].content.length > 80) {
                        const timestamp = Date.now();
                        const key = `config_auto_${timestamp}`;
                        insights.push({
                            key,
                            title: `Configuration: ${msg.content.slice(0, 60)}`,
                            content: [
                                `# Configuration Note`,
                                '',
                                '## Question',
                                msg.content.slice(0, 300),
                                '',
                                '## Answer',
                                messages[j].content.slice(0, 600),
                            ].join('\n'),
                            domain: 'config',
                            importance: 4,
                            tags: extractTags(msg.content + ' ' + messages[j].content),
                            sourceMessageIds: [msg.id, messages[j].id],
                        });
                        break;
                    }
                }
            }
        }
    }

    return insights;
}

/**
 * Extract user preferences, decisions, and important facts they share.
 */
function extractUserPreferences(messages: ChatMessage[]): Insight[] {
    const insights: Insight[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role !== 'user') continue;

        // Preference indicators
        const prefPatterns = [
            /(?:ich möchte|ich will|ich brauche|wichtig ist|präferiere|bevorzuge)/i,
            /(?:immer|niemals|nie|always|never)/i,
            /(?:in zukunft|von nun an|ab jetzt)/i,
        ];

        for (const pattern of prefPatterns) {
            if (pattern.test(msg.content)) {
                const timestamp = Date.now();
                const key = `preference_${timestamp}`;
                insights.push({
                    key,
                    title: `User Preference: ${msg.content.slice(0, 50)}`,
                    content: [
                        `# User Preference`,
                        '',
                        msg.content.slice(0, 500),
                        '',
                        `*Erfasst am: ${new Date().toLocaleDateString('de-DE')}*`,
                    ].join('\n'),
                    domain: 'notes',
                    importance: 6,
                    tags: ['user-preference'],
                    sourceMessageIds: [msg.id],
                });
                break;
            }
        }

        // Important decisions or plans
        const decisionPatterns = /(?:entscheid|plan|strategie|ziel|goal|objective|werde.+machen)/i;
        if (decisionPatterns.test(msg.content) && msg.content.length > 50) {
            const timestamp = Date.now();
            const key = `decision_${timestamp}`;
            insights.push({
                key,
                title: `Decision/Plan: ${msg.content.slice(0, 50)}`,
                content: [
                    `# Decision / Plan`,
                    '',
                    msg.content.slice(0, 500),
                    '',
                    `*Dokumentiert am: ${new Date().toLocaleDateString('de-DE')}*`,
                ].join('\n'),
                domain: 'notes',
                importance: 5,
                tags: ['decision', 'planning'],
                sourceMessageIds: [msg.id],
            });
        }
    }

    return insights;
}
