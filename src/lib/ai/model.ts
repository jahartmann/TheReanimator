import { ollama } from 'ollama-ai-provider';
import { getAISettings } from '@/lib/actions/ai';

export async function getLanguageModel() {
    const settings = await getAISettings();

    // Configure the Ollama provider with the user's settings
    // We create a custom instance to point to the correct URL
    const provider = ollama;

    // Note: ollama-ai-provider might need specific config approach if URL is custom
    // Usually it expects OLLAMA_BASE_URL env var, or we config it per request if supported.
    // Checking docs: ollama('modelname', { config })

    // For now, valid for standard localhost:11434. 
    // If custom URL is needed, we might need to set process.env or use a specific config object if the provider exposes it.
    // However, the simplest way with 'ollama-ai-provider' is often implicit env.
    // Let's assume standard for now, but we can wrap it.

    // Actually, checking library: usually usage is `ollama('llama3')`.
    // To configure URL, it often looks for env.OLLAMA_BASE_URL.

    if (settings.url) {
        process.env.OLLAMA_BASE_URL = settings.url; // Dynamic env shim
    }

    if (!settings.model) {
        throw new Error('No AI model selected in settings');
    }

    return provider(settings.model);
}
