import db from '@/lib/db';

export interface LogFinding {
    title: string;
    severity: 'critical' | 'warning' | 'info';
    logLines: string[];
    explanation: string;
    recommendation: string;
}

function getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value || null;
}

/**
 * Analyzes log lines using the configured LLM provider.
 * Returns an array of findings, or an empty array on failure.
 */
export async function analyzeLogsWithAI(
    logLines: string[],
    serverName: string,
): Promise<LogFinding[]> {
    try {
        // Dynamic import to avoid issues in browser/build contexts
        const { createProvider } = await import('@/lib/agent/providers/factory');

        const provider = createProvider();

        // Limit to 200 lines max
        const limitedLines = logLines.slice(-200);
        const logText = limitedLines.join('\n');

        const prompt = `You are a Linux system log analyst. Analyze the following logs from server "${serverName}" and identify issues, anomalies, or notable events.

Return ONLY a valid JSON array of findings. No explanation outside the JSON.

Each finding must have this exact shape:
{
  "title": "short title",
  "severity": "critical" | "warning" | "info",
  "logLines": ["relevant log line 1", "relevant log line 2"],
  "explanation": "what is happening and why it matters",
  "recommendation": "concrete action to resolve or investigate"
}

If there are no noteworthy findings, return an empty array: []

Logs:
\`\`\`
${logText}
\`\`\``;

        const messages = [
            { role: 'user', content: prompt },
        ];

        // Collect the full streamed response
        let fullResponse = '';
        for await (const chunk of provider.chat(messages, { temperature: 0.1 })) {
            fullResponse += chunk;
        }

        // Extract JSON array from the response using regex
        const match = fullResponse.match(/\[[\s\S]*\]/);
        if (!match) {
            console.warn('[LogAnalyzer] No JSON array found in LLM response');
            return [];
        }

        const findings: LogFinding[] = JSON.parse(match[0]);

        // Validate and sanitize findings
        return findings.filter(
            (f) =>
                typeof f.title === 'string' &&
                ['critical', 'warning', 'info'].includes(f.severity) &&
                Array.isArray(f.logLines) &&
                typeof f.explanation === 'string' &&
                typeof f.recommendation === 'string',
        );
    } catch (err) {
        console.error('[LogAnalyzer] Failed to analyze logs:', err);
        return [];
    }
}
