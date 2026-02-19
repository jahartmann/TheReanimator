/**
 * Web Search - Optional DuckDuckGo/SearXNG integration for the agent.
 * Activated via settings. Falls back gracefully when unavailable.
 */

import db from '@/lib/db';

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

interface SearchResponse {
    success: boolean;
    query: string;
    results: SearchResult[];
    error?: string;
}

/**
 * Check if web search is enabled in settings.
 */
export function isSearchEnabled(): boolean {
    try {
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'web_search_enabled'").get() as any;
        return setting?.value === 'true';
    } catch {
        return false;
    }
}

/**
 * Get the configured search engine URL.
 */
function getSearchUrl(): string {
    try {
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'web_search_url'").get() as any;
        return setting?.value || 'https://api.duckduckgo.com/';
    } catch {
        return 'https://api.duckduckgo.com/';
    }
}

/**
 * Perform a web search using DuckDuckGo Instant Answer API.
 */
export async function searchWeb(query: string, limit: number = 5): Promise<SearchResponse> {
    if (!isSearchEnabled()) {
        return {
            success: false,
            query,
            results: [],
            error: 'Web-Suche ist deaktiviert. Aktiviere sie in den Einstellungen.',
        };
    }

    try {
        const searchUrl = getSearchUrl();

        // DuckDuckGo Instant Answer API
        if (searchUrl.includes('duckduckgo')) {
            return await searchDuckDuckGo(query, limit);
        }

        // SearXNG API
        return await searchSearXNG(searchUrl, query, limit);
    } catch (e: any) {
        return {
            success: false,
            query,
            results: [],
            error: `Suchfehler: ${e.message}`,
        };
    }
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResponse> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
        headers: { 'User-Agent': 'Reanimator/1.0' },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`DuckDuckGo API error: ${response.status}`);
    }

    const data = await response.json();
    const results: SearchResult[] = [];

    // Abstract (main answer)
    if (data.Abstract) {
        results.push({
            title: data.Heading || query,
            url: data.AbstractURL || '',
            snippet: data.Abstract,
        });
    }

    // Related topics
    if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, limit - results.length)) {
            if (topic.Text) {
                results.push({
                    title: topic.Text.slice(0, 80),
                    url: topic.FirstURL || '',
                    snippet: topic.Text,
                });
            }
        }
    }

    return { success: true, query, results: results.slice(0, limit) };
}

async function searchSearXNG(baseUrl: string, query: string, limit: number): Promise<SearchResponse> {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=de`;

    const response = await fetch(url, {
        headers: { 'User-Agent': 'Reanimator/1.0' },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`SearXNG API error: ${response.status}`);
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || []).slice(0, limit).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.content || '',
    }));

    return { success: true, query, results };
}
