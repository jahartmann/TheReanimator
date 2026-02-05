import { tool as createTool } from 'ai';
import { z } from 'zod';
import db from '@/lib/db';

export const getServers = createTool({
    description: 'Gibt eine Liste aller überwachten Server und deren Status zurück.',
    parameters: z.object({}),
    execute: async () => {
        const servers = db.prepare('SELECT id, name, type, ip, status_cache FROM servers').all();
        return servers;
    },
});

export const getBackups = createTool({
    description: 'Listet die letzten Backups des gesamten Clusters auf.',
    parameters: z.object({
        limit: z.number().optional().describe('Anzahl der Backups (Standard: 5)'),
    }),
    execute: async ({ limit = 5 }: { limit?: number } = {}) => { // Default empty object if no params
        try {
            const backups = db.prepare(`
        SELECT b.id, b.name, b.backup_date, b.size, s.name as server_name 
        FROM backups b
        JOIN servers s ON b.server_id = s.id
        ORDER BY b.backup_date DESC
        LIMIT ?
        `).all(limit);
            return backups;
        } catch {
            return [];
        }
    },
});

export const getFailedBackups = createTool({
    description: 'Zeigt fehlgeschlagene Backups an.',
    parameters: z.object({}),
    execute: async () => {
        try {
            const failed = db.prepare(`
        SELECT b.id, b.name, b.backup_date, s.name as server_name 
        FROM backups b
        JOIN servers s ON b.server_id = s.id
        WHERE b.status = 'failed' OR b.status = 'error'
        ORDER BY b.backup_date DESC
        LIMIT 10
        `).all();
            return failed.length > 0 ? failed : "Keine fehlgeschlagenen Backups gefunden.";
        } catch (e) {
            return "Konnte Fehlgeschlagene Backups nicht abrufen (Schema-Fehler).";
        }
    },
});

export const restartService = createTool({
    description: 'Startet einen Dienst auf einem Server neu (SSH).',
    parameters: z.object({
        serverName: z.string().describe('Name des Servers'),
        serviceName: z.string().describe('Name des Dienstes (z.B. nginx, apache2)'),
    }),
    execute: async ({ serverName, serviceName }: { serverName: string, serviceName: string }) => {
        const server = db.prepare('SELECT ip FROM servers WHERE name LIKE ?').get(`%${serverName}%`) as { ip: string } | undefined;
        if (!server) return `Server '${serverName}' nicht gefunden.`;

        return `SIMULATION: Würde 'systemctl restart ${serviceName}' auf ${server.ip} ausführen. (SSH Implementierung ausstehend)`;
    },
});

export const tools = {
    getServers,
    getBackups,
    getFailedBackups,
    restartService
};
