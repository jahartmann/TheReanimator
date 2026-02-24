/**
 * Conversational VM creation - Agent-guided VM/Container setup via Chat or Telegram.
 */

import { startWizard, updateWizardStep, getStepInfo, getWizardSummary, applyTemplate, completeWizard, type WizardState, type WizardData } from './wizard';
import { listTemplates } from './templates';

/**
 * Start a conversational VM creation flow.
 * Returns the first prompt for the user.
 */
export function startConversationalWizard(userId?: number, sessionType: 'chat' | 'telegram' = 'chat'): {
    wizard: WizardState;
    prompt: string;
} {
    const wizard = startWizard(userId, sessionType);
    const templates = listTemplates();

    let prompt = '🚀 **VM/Container Wizard**\n\n';
    prompt += 'Ich helfe dir beim Erstellen einer neuen VM oder eines Containers.\n\n';

    if (templates.length > 0) {
        prompt += '**Verfügbare Templates:**\n';
        templates.forEach((t, i) => {
            prompt += `${i + 1}. **${t.name}** (${t.base_type.toUpperCase()}) - ${t.description || `${t.default_cores} Cores, ${t.default_memory}MB RAM`}\n`;
        });
        prompt += '\nWähle ein Template (Nummer) oder sage "von Scratch" für manuelle Konfiguration.';
    } else {
        prompt += 'Was möchtest du erstellen?\n';
        prompt += '1. **VM** (QEMU/KVM)\n';
        prompt += '2. **Container** (LXC)\n';
    }

    return { wizard, prompt };
}

/**
 * Process a step in the conversational wizard.
 * Returns the next prompt or a completion summary.
 */
export function processConversationalStep(wizardId: number, userInput: string, currentStep: number, currentData: WizardData): {
    updatedData: Partial<WizardData>;
    nextPrompt: string;
    isComplete: boolean;
} {
    const input = userInput.trim().toLowerCase();

    switch (currentStep) {
        case 1: // Template selection
            return processTemplateStep(input);

        case 2: // Base config
            return processBaseConfigStep(input, currentData);

        case 3: // Network
            return processNetworkStep(input, currentData);

        case 4: // Storage
            return processStorageStep(input, currentData);

        case 5: // Post-provisioning
            return processProvisioningStep(input, currentData);

        case 6: // Confirmation
            return processConfirmationStep(input, currentData);

        default:
            return { updatedData: {}, nextPrompt: 'Unbekannter Schritt.', isComplete: false };
    }
}

function processTemplateStep(input: string): ReturnType<typeof processConversationalStep> {
    const templates = listTemplates();
    const templateNum = parseInt(input);

    if (templateNum > 0 && templateNum <= templates.length) {
        const template = templates[templateNum - 1];
        return {
            updatedData: {
                templateId: template.id,
                baseType: template.base_type,
                cores: template.default_cores,
                memory: template.default_memory,
                disk: template.default_disk,
                osType: template.default_os_type,
            },
            nextPrompt: `✅ Template **${template.name}** gewählt.\n\nGib einen **Namen** für die ${template.base_type === 'lxc' ? 'Container' : 'VM'} ein:`,
            isComplete: false,
        };
    }

    if (input.includes('scratch') || input.includes('manuell') || input.includes('vm')) {
        return {
            updatedData: { baseType: 'vm' },
            nextPrompt: 'Gib einen **Namen** für die VM ein:',
            isComplete: false,
        };
    }

    if (input.includes('container') || input.includes('lxc')) {
        return {
            updatedData: { baseType: 'lxc' },
            nextPrompt: 'Gib einen **Namen** für den Container ein:',
            isComplete: false,
        };
    }

    return {
        updatedData: {},
        nextPrompt: 'Bitte wähle ein Template (Nummer) oder "VM"/"Container":',
        isComplete: false,
    };
}

function processBaseConfigStep(input: string, data: WizardData): ReturnType<typeof processConversationalStep> {
    if (!data.name) {
        return {
            updatedData: { name: input },
            nextPrompt: `Name: **${input}**\n\nWie viele **CPU-Cores**? (Standard: ${data.cores || 2})`,
            isComplete: false,
        };
    }

    // Parse cores/memory/disk from input
    const num = parseInt(input);
    if (!isNaN(num) && !data.cores) {
        return {
            updatedData: { cores: num },
            nextPrompt: `CPU: **${num} Cores**\n\nWie viel **RAM** in MB? (Standard: ${data.memory || 2048})`,
            isComplete: false,
        };
    }

    return {
        updatedData: { memory: num || data.memory || 2048 },
        nextPrompt: `RAM: **${num || data.memory || 2048} MB**\n\nWelche **Netzwerk-Bridge**? (Standard: vmbr0)`,
        isComplete: false,
    };
}

function processNetworkStep(input: string, data: WizardData): ReturnType<typeof processConversationalStep> {
    const bridge = input || 'vmbr0';
    return {
        updatedData: { network: { bridge, ...data.network } },
        nextPrompt: `Netzwerk: **${bridge}**\n\nWelcher **Storage**? (Standard: local-lvm)`,
        isComplete: false,
    };
}

function processStorageStep(input: string, data: WizardData): ReturnType<typeof processConversationalStep> {
    const storage = input || 'local-lvm';
    return {
        updatedData: { storage },
        nextPrompt: `Storage: **${storage}**\n\nSoll die ${data.baseType === 'lxc' ? 'Container' : 'VM'} automatisch gestartet werden? (ja/nein)`,
        isComplete: false,
    };
}

function processProvisioningStep(input: string, data: WizardData): ReturnType<typeof processConversationalStep> {
    const autoStart = input === 'ja' || input === 'yes' || input === 'y';
    const summary = getWizardSummary({ ...data, autoStart });

    return {
        updatedData: { autoStart },
        nextPrompt: `📋 **Zusammenfassung:**\n\n${summary}\n\nAlles korrekt? (ja = erstellen, nein = abbrechen)`,
        isComplete: false,
    };
}

function processConfirmationStep(input: string, data: WizardData): ReturnType<typeof processConversationalStep> {
    if (input === 'ja' || input === 'yes' || input === 'y') {
        return {
            updatedData: {},
            nextPrompt: '✅ Erstelle die Ressource...',
            isComplete: true,
        };
    }

    return {
        updatedData: {},
        nextPrompt: '❌ Erstellung abgebrochen.',
        isComplete: true,
    };
}
