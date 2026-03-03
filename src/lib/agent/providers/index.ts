export interface LLMProvider {
    chat(messages: any[], options?: { temperature?: number; maxTokens?: number }): AsyncGenerator<string>;
    name: string;
}

export { OllamaProvider } from './ollama';
export { AnthropicProvider } from './anthropic';
export { OpenAIProvider } from './openai';
export { createProvider } from './factory';
