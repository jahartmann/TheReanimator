import type { LLMProvider } from './index';
import { OllamaProvider } from './ollama';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import db from '@/lib/db';

type ProviderType = 'ollama' | 'anthropic' | 'openai';

function getSetting(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value || null;
}

export function createProvider(overrides?: {
    provider?: ProviderType;
    model?: string;
    url?: string;
}): LLMProvider {
    const providerType = (overrides?.provider || getSetting('ai_provider') || 'ollama') as ProviderType;

    switch (providerType) {
        case 'anthropic': {
            const apiKey = getSetting('ai_anthropic_key');
            if (!apiKey) throw new Error('Anthropic API key not configured (ai_anthropic_key)');
            const model = overrides?.model || getSetting('ai_model') || 'claude-sonnet-4-20250514';
            return new AnthropicProvider(apiKey, model);
        }

        case 'openai': {
            const apiKey = getSetting('ai_openai_key');
            if (!apiKey) throw new Error('OpenAI API key not configured (ai_openai_key)');
            const model = overrides?.model || getSetting('ai_model') || 'gpt-4o';
            const baseUrl = overrides?.url || getSetting('ai_openai_base_url') || 'https://api.openai.com/v1';
            return new OpenAIProvider(apiKey, model, baseUrl);
        }

        case 'ollama':
        default: {
            const url = overrides?.url || getSetting('ai_url') || 'http://localhost:11434';
            const model = overrides?.model || getSetting('ai_model') || 'llama3';
            return new OllamaProvider(url, model);
        }
    }
}

/**
 * Create provider with fallback chain: try primary, fall back to secondary on error.
 */
export async function createProviderWithFallback(): Promise<LLMProvider> {
    const primaryType = (getSetting('ai_provider') || 'ollama') as ProviderType;
    const fallbackType = getSetting('ai_fallback_provider') as ProviderType | null;

    try {
        return createProvider({ provider: primaryType });
    } catch (primaryError) {
        if (fallbackType && fallbackType !== primaryType) {
            console.warn(`[AI] Primary provider "${primaryType}" failed, falling back to "${fallbackType}":`, primaryError);
            return createProvider({ provider: fallbackType });
        }
        throw primaryError;
    }
}
