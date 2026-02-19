/**
 * VM Wizard - State machine for step-by-step VM/Container creation.
 * Steps: 1. Template, 2. Base Config, 3. Network, 4. Storage, 5. Post-Provisioning, 6. Confirm
 */

import db from '@/lib/db';
import { getTemplate, type VMTemplate } from './templates';

export interface WizardState {
    id: number;
    userId: number | null;
    sessionType: 'web' | 'telegram' | 'chat';
    currentStep: number;
    totalSteps: number;
    data: WizardData;
    status: 'in_progress' | 'completed' | 'cancelled';
}

export interface WizardData {
    templateId?: number;
    baseType?: 'vm' | 'lxc';
    name?: string;
    cores?: number;
    memory?: number;
    disk?: string;
    osType?: string;
    serverId?: number;
    network?: {
        bridge?: string;
        vlan?: number;
        ip?: string;
        gateway?: string;
    };
    storage?: string;
    provisioningProfileId?: number;
    monitoringEnabled?: boolean;
    autoStart?: boolean;
    template?: string; // LXC template path
    password?: string;
}

const WIZARD_STEPS = [
    { step: 1, name: 'Template wählen', description: 'Wähle ein Template oder starte von Null' },
    { step: 2, name: 'Basis-Konfiguration', description: 'Name, CPU, RAM, Disk' },
    { step: 3, name: 'Netzwerk', description: 'Bridge, VLAN, IP-Adresse' },
    { step: 4, name: 'Storage', description: 'Speicher-Pool auswählen' },
    { step: 5, name: 'Post-Provisioning', description: 'Provisioning-Profil und Monitoring' },
    { step: 6, name: 'Bestätigung', description: 'Zusammenfassung prüfen und erstellen' },
];

/**
 * Start a new wizard session.
 */
export function startWizard(userId?: number, sessionType: 'web' | 'telegram' | 'chat' = 'web'): WizardState {
    const result = db.prepare(`
        INSERT INTO vm_wizard_sessions (user_id, session_type, current_step, total_steps, data, status)
        VALUES (?, ?, 1, 6, '{}', 'in_progress')
    `).run(userId || null, sessionType);

    return {
        id: result.lastInsertRowid as number,
        userId: userId || null,
        sessionType,
        currentStep: 1,
        totalSteps: 6,
        data: {},
        status: 'in_progress',
    };
}

/**
 * Update wizard step data and advance to next step.
 */
export function updateWizardStep(wizardId: number, stepData: Partial<WizardData>): WizardState {
    const session = db.prepare('SELECT * FROM vm_wizard_sessions WHERE id = ?').get(wizardId) as any;
    if (!session) throw new Error('Wizard-Session nicht gefunden.');

    const currentData = safeJsonParse(session.data, {});
    const updatedData = { ...currentData, ...stepData };
    const nextStep = Math.min(session.current_step + 1, session.total_steps);

    db.prepare(`
        UPDATE vm_wizard_sessions SET data = ?, current_step = ? WHERE id = ?
    `).run(JSON.stringify(updatedData), nextStep, wizardId);

    return {
        id: wizardId,
        userId: session.user_id,
        sessionType: session.session_type,
        currentStep: nextStep,
        totalSteps: session.total_steps,
        data: updatedData,
        status: 'in_progress',
    };
}

/**
 * Go back one step.
 */
export function previousStep(wizardId: number): WizardState {
    const session = db.prepare('SELECT * FROM vm_wizard_sessions WHERE id = ?').get(wizardId) as any;
    if (!session) throw new Error('Wizard-Session nicht gefunden.');

    const prevStep = Math.max(session.current_step - 1, 1);
    db.prepare('UPDATE vm_wizard_sessions SET current_step = ? WHERE id = ?').run(prevStep, wizardId);

    return {
        id: wizardId,
        userId: session.user_id,
        sessionType: session.session_type,
        currentStep: prevStep,
        totalSteps: session.total_steps,
        data: safeJsonParse(session.data, {}),
        status: 'in_progress',
    };
}

/**
 * Apply a template to the wizard data.
 */
export function applyTemplate(wizardId: number, templateId: number): WizardState {
    const template = getTemplate(templateId);
    if (!template) throw new Error('Template nicht gefunden.');

    return updateWizardStep(wizardId, {
        templateId,
        baseType: template.base_type,
        cores: template.default_cores,
        memory: template.default_memory,
        disk: template.default_disk,
        osType: template.default_os_type,
        autoStart: template.auto_start,
        provisioningProfileId: template.provisioning_profile_id || undefined,
    });
}

/**
 * Get the current step info and prompt.
 */
export function getStepInfo(currentStep: number): { name: string; description: string } {
    return WIZARD_STEPS[currentStep - 1] || WIZARD_STEPS[0];
}

/**
 * Generate a summary of the wizard configuration.
 */
export function getWizardSummary(data: WizardData): string {
    const lines: string[] = [];
    lines.push(`**Typ**: ${data.baseType === 'lxc' ? 'LXC Container' : 'QEMU VM'}`);
    if (data.name) lines.push(`**Name**: ${data.name}`);
    lines.push(`**CPU**: ${data.cores || 2} Cores`);
    lines.push(`**RAM**: ${(data.memory || 2048)} MB`);
    lines.push(`**Disk**: ${data.disk || '32G'}`);
    if (data.network?.bridge) lines.push(`**Netzwerk**: ${data.network.bridge}${data.network.vlan ? ` (VLAN ${data.network.vlan})` : ''}`);
    if (data.network?.ip) lines.push(`**IP**: ${data.network.ip}`);
    if (data.storage) lines.push(`**Storage**: ${data.storage}`);
    if (data.autoStart) lines.push(`**Auto-Start**: Ja`);
    return lines.join('\n');
}

/**
 * Cancel a wizard session.
 */
export function cancelWizard(wizardId: number): void {
    db.prepare("UPDATE vm_wizard_sessions SET status = 'cancelled' WHERE id = ?").run(wizardId);
}

/**
 * Mark wizard as completed.
 */
export function completeWizard(wizardId: number): void {
    db.prepare("UPDATE vm_wizard_sessions SET status = 'completed' WHERE id = ?").run(wizardId);
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
