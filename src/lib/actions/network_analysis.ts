'use server';

import db from '@/lib/db';
import { getNetworkConfig } from './network';
import { explainNetworkConfig, getAISettings } from './ai';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { getServerLocale } from '@/lib/utils/locale';

export interface AnalysisResult {
    id: number;
    server_id: number;
    type: 'network';
    content: string;
    created_at: string;
}

export async function getLatestNetworkAnalysis(serverId: number): Promise<AnalysisResult | null> {
    const user = await getCurrentUser();
    if (!user) return null;

    const row = db.prepare(`
        SELECT * FROM server_ai_analysis 
        WHERE server_id = ? AND type = 'network' 
        ORDER BY created_at DESC LIMIT 1
    `).get(serverId) as any;

    if (!row) return null;
    return row as AnalysisResult;
}

export async function runNetworkAnalysis(serverId: number): Promise<string> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    console.log(`[AI Analysis] Starting Network Analysis for Server ${serverId}...`);

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'servers' });
    const settings = await getAISettings();

    // 1. Fetch Config (always works, even without AI)
    let config;
    try {
        config = await getNetworkConfig(serverId);
    } catch (fetchError: any) {
        console.error(`[AI Analysis] Config fetch threw:`, fetchError);
        throw new Error(`SSH-Verbindungsfehler: ${fetchError.message}`);
    }

    if (!config.success || !config.interfaces) {
        const errorMsg = config.error || 'Netzwerkkonfiguration konnte nicht abgerufen werden';
        console.error(`[AI Analysis] Config fetch failed: ${errorMsg}`);
        throw new Error(`Konfigurationsfehler: ${errorMsg}`);
    }

    if (!Array.isArray(config.interfaces) || config.interfaces.length === 0) {
        throw new Error('Keine Netzwerk-Interfaces gefunden');
    }

    let analysisContent: string;

    // 2. Try AI analysis, fall back to raw data display
    if (settings.enabled && settings.model) {
        try {
            const analysisResult = await explainNetworkConfig(config.interfaces);
            analysisContent = JSON.stringify(analysisResult);
        } catch (aiError: any) {
            console.warn(`[AI Analysis] AI processing failed, using raw fallback:`, aiError.message);
            // Build a structured fallback from the raw network data
            analysisContent = JSON.stringify(buildRawAnalysis(config.interfaces));
        }
    } else {
        // AI disabled - build structured result from raw data
        analysisContent = JSON.stringify(buildRawAnalysis(config.interfaces));
    }

    // 3. Save to DB
    try {
        const stmt = db.prepare(`
            INSERT INTO server_ai_analysis (server_id, type, content)
            VALUES (?, 'network', ?)
        `);
        stmt.run(serverId, analysisContent);
    } catch (dbError: any) {
        console.error(`[AI Analysis] DB save failed:`, dbError);
    }

    console.log(`[AI Analysis] Completed for Server ${serverId}.`);
    return analysisContent;
}

/**
 * Build a structured analysis from raw interface data when AI is unavailable.
 */
function buildRawAnalysis(interfaces: any[]) {
    const topology = interfaces.map((iface: any) => ({
        interface: iface.iface || iface.name || 'unknown',
        type: iface.type || detectInterfaceType(iface.iface || ''),
        status: iface.active ? 'UP' : (iface.exists !== false ? 'DOWN' : 'MISSING'),
        ip_connect: iface.cidr || iface.address || '-',
        usage: iface.comments || iface.bridge_ports ? `Bridge: ${iface.bridge_ports}` : '-',
    }));

    return {
        summary: `Netzwerkübersicht: ${interfaces.length} Interfaces erkannt. Daten wurden ohne KI-Analyse direkt aus der Konfiguration gelesen.`,
        topology,
        security_analysis: [],
        performance_analysis: [],
        recommendations: [{
            action: 'KI-Analyse aktivieren',
            reason: 'Für detaillierte Sicherheits- und Performance-Analysen aktivieren Sie die KI in den Einstellungen.',
        }],
    };
}

function detectInterfaceType(name: string): string {
    if (name.startsWith('vmbr')) return 'Linux Bridge';
    if (name.startsWith('bond')) return 'Bond';
    if (name.startsWith('vlan') || name.includes('.')) return 'VLAN';
    if (name.startsWith('lo')) return 'Loopback';
    if (name.startsWith('eth') || name.startsWith('en')) return 'Physical';
    if (name.startsWith('wl')) return 'WiFi';
    if (name.startsWith('tap') || name.startsWith('veth')) return 'Virtual';
    return 'Unknown';
}
