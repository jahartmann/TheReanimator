'use server';

import { headers, cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import db from '@/lib/db';
import { request } from 'undici';

// Helper function to get locale from request
async function getServerLocale(): Promise<string> {
    const headersList = await headers();
    const cookieStore = await cookies();

    // Try to get locale from cookie first
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
    if (cookieLocale && routing.locales.includes(cookieLocale as any)) {
        return cookieLocale;
    }

    // Try to get from Accept-Language header
    const acceptLanguage = headersList.get('accept-language');
    if (acceptLanguage) {
        const preferredLocale = acceptLanguage.split(',')[0].split('-')[0];
        if (routing.locales.includes(preferredLocale as any)) {
            return preferredLocale;
        }
    }

    // Fallback to default locale
    return routing.defaultLocale;
}

// --- Settings Management ---

export async function getAISettings() {
    console.log('[AI] Loading settings from DB...');
    try {
        const url = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_url') as { value: string } | undefined;
        const model = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_model') as { value: string } | undefined;
        const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_enabled') as { value: string } | undefined;

        const settings = {
            url: url?.value || 'http://localhost:11434',
            model: model?.value || '',
            enabled: enabled?.value === 'true' // Default to false if not set
        };
        console.log('[AI] Loaded settings:', settings);
        return settings;
    } catch (error) {
        console.error('[AI] Failed to load settings:', error);
        return {
            url: 'http://localhost:11434',
            model: '',
            enabled: false
        };
    }
}

export async function saveAISettings(url: string, model: string, enabled: boolean) {
    console.log('[AI] Saving settings:', { url, model, enabled });
    try {
        const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

        const infoUrl = upsert.run('ai_url', url);
        const infoModel = upsert.run('ai_model', model);
        const infoEnabled = upsert.run('ai_enabled', String(enabled));

        console.log('[AI] Settings saved to DB. Changes:', {
            urlChanges: infoUrl.changes,
            modelChanges: infoModel.changes,
            enabledChanges: infoEnabled.changes
        });

        return { success: true };
    } catch (error) {
        console.error('[AI] Failed to save settings:', error);
        return { success: false, error: String(error) };
    }
}

// --- Ollama API Proxy ---

export interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    modified_at: string;
}

export async function checkOllamaConnection(url: string) {
    try {
        // Remove trailing slash
        const cleanUrl = url.replace(/\/$/, '');

        // Create abort controller with 5 second timeout (fast fail)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const res = await request(`${cleanUrl}/api/tags`, {
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' }
            });

            if (res.statusCode !== 200) {
                return { success: false, message: `Ollama returned status ${res.statusCode}` };
            }

            const data = await res.body.json() as { models: OllamaModel[] };
            return { success: true, models: data.models };
        } finally {
            clearTimeout(timeoutId);
        }
    } catch (e: any) {
        if (e.name === 'AbortError' || e.code === 'UND_ERR_CONNECT_TIMEOUT') {
            return { success: false, message: 'Connection timed out (5s). Is Ollama running?' };
        }
        if (e.code === 'ECONNREFUSED') {
            return { success: false, message: 'Connection refused. Check URL and port.' };
        }
        return { success: false, message: e.message || 'Connection failed' };
    }
}

export async function generateAIResponse(
    prompt: string,
    systemContext?: string,
    onProgress?: (partialResponse: string, tokenCount: number) => void
): Promise<string> {
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsAI' });

    const settings = await getAISettings();
    if (!settings.enabled) throw new Error(t('aiDisabled'));
    if (!settings.model) throw new Error(t('aiModelNotSelected'));

    // Create abort controller with 300 second timeout (5 minutes for large models)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    // Track last activity for heartbeat
    let lastActivityTime = Date.now();
    const activityTimeoutId = setInterval(() => {
        // If no activity for 60 seconds during streaming, abort
        if (Date.now() - lastActivityTime > 60000) {
            controller.abort();
        }
    }, 10000);

    try {
        const cleanUrl = settings.url.replace(/\/$/, '');

        const payload = {
            model: settings.model,
            prompt: prompt,
            system: systemContext || "Du bist ein hilfreicher Systemadministrator-Assistent für Proxhost.",
            stream: true, // Enable streaming for progress tracking
            options: {
                temperature: 0.3 // Low temperature for factual admin tasks
            }
        };

        const res = await request(`${cleanUrl}/api/generate`, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        });

        if (res.statusCode !== 200) {
            throw new Error(`Ollama Error: ${res.statusCode}`);
        }

        // Stream response and collect tokens
        let fullResponse = '';
        let tokenCount = 0;

        for await (const chunk of res.body) {
            lastActivityTime = Date.now(); // Update activity time on each chunk

            const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.response) {
                        fullResponse += json.response;
                        tokenCount++;

                        // Call progress callback if provided
                        if (onProgress && tokenCount % 10 === 0) {
                            onProgress(fullResponse, tokenCount);
                        }
                    }
                    if (json.done) {
                        // Final callback
                        if (onProgress) {
                            onProgress(fullResponse, tokenCount);
                        }
                    }
                } catch {
                    // Skip invalid JSON lines
                }
            }
        }

        return fullResponse;

    } catch (e: any) {
        if (e.name === 'AbortError') {
            throw new Error(t('timeoutError'));
        }
        console.error('AI Generation Error:', e);
        throw new Error(t('generationError') + `${e.message}`);
    } finally {
        clearTimeout(timeoutId);
        clearInterval(activityTimeoutId);
    }
}

// --- Specific Features ---

export async function analyzeLogWithAI(logContent: string): Promise<string> {
    // Truncate log if too long (Ollama context limits)
    const truncatedLog = logContent.length > 8000 ? logContent.slice(-8000) : logContent;

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsAI' });

    const context = t('logAnalysisPrompt');

    return generateAIResponse(t('hereIsLog') + truncatedLog, context);
}

// Helper to separate JSON from text
function parseAIJSON(response: string) {
    try {
        // Step 1: Remove markdown code block wrappers if present
        let cleaned = response.trim();

        // Remove ```json ... ``` or ``` ... ``` wrappers
        const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            cleaned = codeBlockMatch[1].trim();
        }

        // Step 2: Extract JSON object or array
        const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;

        // Step 3: Parse with validation
        const parsed = JSON.parse(jsonStr);

        // Basic schema validation for HealthResult
        if (typeof parsed === 'object' && parsed !== null) {
            if (parsed.score !== undefined && typeof parsed.score !== 'number') {
                parsed.score = parseInt(parsed.score) || 100;
            }
            if (!Array.isArray(parsed.issues)) {
                parsed.issues = [];
            }
        }

        return parsed;
    } catch (e) {
        console.error('AI JSON Parse Error:', e, 'Response:', response.substring(0, 200));
        return null;
    }
}



export type HealthIssue = {
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    fix?: string;
};

export type HealthResult = {
    score: number; // 0-100
    issues: HealthIssue[];
    summary: string;
    markdown_report?: string; // New detailed report
};

export async function analyzeConfigWithAI(config: string, type: 'qemu' | 'lxc'): Promise<HealthResult> {
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsAI' });

    const context = t('configAnalysisPrompt', { type, config }).trim();

    const response = await generateAIResponse(context, '');
    const result = parseAIJSON(response);

    if (!result) {
        return { score: 100, issues: [], summary: t('parseError') };
    }
    return result;
}

export async function analyzeHostWithAI(files: { filename: string, content: string }[]): Promise<HealthResult> {
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsAI' });

    const context = t('hostAnalysisPrompt', {
        files: files.map(f => `=== ${f.filename} ===\n${f.content}\n`).join('\n')
    }).trim();

    const response = await generateAIResponse(context, '');
    return parseAIJSON(response) || { score: 100, issues: [], summary: t('parseError') };
}

// --- Network Analysis Types ---

export interface NetworkTopology {
    interface: string;
    type: string;
    status: string;
    ip_connect: string;
    usage: string;
}

export interface NetworkIssue {
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    recommendation: string;
}

export interface NetworkRecommendation {
    action: string;
    command?: string;
    reason: string;
}

export interface NetworkAnalysisResult {
    summary: string;
    topology: NetworkTopology[];
    security_analysis: NetworkIssue[];
    performance_analysis: NetworkIssue[];
    recommendations: NetworkRecommendation[];
}

export async function explainNetworkConfig(interfaces: any[]): Promise<NetworkAnalysisResult> {
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsAI' });

    const response = await generateAIResponse(t('hereIsConfig') + JSON.stringify(interfaces, null, 2), t('networkAnalysisPrompt'));

    // Use parseAIJSON helper to extract JSON from markdown block if needed
    const result = parseAIJSON(response);

    if (!result) {
        // Fallback structure if parsing fails entirely
        return {
            summary: t('networkAnalysisFailed'),
            topology: [],
            security_analysis: [{ severity: 'critical', title: t('parseErrorTitle'), description: t('parseErrorDesc'), recommendation: t('parseErrorRec') }],
            performance_analysis: [],
            recommendations: []
        };
    }

    return result as NetworkAnalysisResult;
}
