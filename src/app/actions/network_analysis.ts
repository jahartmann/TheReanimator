'use server';

import db from '@/lib/db';
import { getNetworkConfig } from './network';
import { explainNetworkConfig, getAISettings } from './ai';

export interface AnalysisResult {
    id: number;
    server_id: number;
    type: 'network';
    content: string;
    created_at: string;
}

export async function getLatestNetworkAnalysis(serverId: number): Promise<AnalysisResult | null> {
    const row = db.prepare(`
        SELECT * FROM server_ai_analysis 
        WHERE server_id = ? AND type = 'network' 
        ORDER BY created_at DESC LIMIT 1
    `).get(serverId) as any;

    if (!row) return null;
    return row as AnalysisResult;
}

export async function runNetworkAnalysis(serverId: number): Promise<string> {
    console.log(`[AI Analysis] Starting Network Analysis for Server ${serverId}...`);

    const settings = await getAISettings();
    if (!settings.enabled) throw new Error('KI-Funktionen sind deaktiviert.');

    try {
        // 1. Fetch Config
        const config = await getNetworkConfig(serverId);
        if (!config.success || !config.interfaces) {
            const errorMsg = config.error || 'Netzwerkkonfiguration konnte nicht abgerufen werden';
            console.error(`[AI Analysis] Config fetch failed: ${errorMsg}`);
            throw new Error(`Konfigurationsfehler: ${errorMsg}`);
        }

        // Ensure we have valid interfaces data
        if (!Array.isArray(config.interfaces) || config.interfaces.length === 0) {
            throw new Error('Keine Netzwerk-Interfaces gefunden');
        }

        // 2. AI Analysis
        let analysisResult;
        try {
            analysisResult = await explainNetworkConfig(config.interfaces);
        } catch (aiError: any) {
            console.error(`[AI Analysis] AI processing failed:`, aiError);
            throw new Error(`KI-Analyse fehlgeschlagen: ${aiError.message}`);
        }

        // Serialize for DB/Frontend
        const analysisContent = JSON.stringify(analysisResult);

        // 3. Save to DB
        try {
            const stmt = db.prepare(`
                INSERT INTO server_ai_analysis (server_id, type, content)
                VALUES (?, 'network', ?)
            `);
            stmt.run(serverId, analysisContent);
        } catch (dbError: any) {
            console.error(`[AI Analysis] DB save failed:`, dbError);
            // Still return the explanation even if save fails
            console.warn('[AI Analysis] Returning result despite DB save failure');
            return analysisContent;
        }

        console.log(`[AI Analysis] Completed & Saved for Server ${serverId}.`);
        return analysisContent;

    } catch (error: any) {
        console.error(`[AI Analysis] Failed for Server ${serverId}:`, error);
        throw error; // Re-throw with improved error message
    }
}
