import { getConfig } from '../../lib/config.js';
import type { ToolDefinition } from './index.js';

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for current information. Use this for recent events, facts, or anything outside training knowledge. Returns up to 5 results with title, URL, and snippet.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
    },
    required: ['query'],
  },
  async run(input) {
    const query = input['query'] as string;
    const config = getConfig();

    if (!config.WEB_SEARCH_API_KEY) {
      return 'Web search is not configured. Add WEB_SEARCH_API_KEY to your .env (get a free key at api.search.brave.com).';
    }

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false`;
    const resp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.WEB_SEARCH_API_KEY,
      },
    });

    if (!resp.ok) {
      throw new Error(`Brave Search error ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as BraveResponse;
    const results = data.web?.results ?? [];

    if (results.length === 0) {
      return 'No results found.';
    }

    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description ?? ''}`)
      .join('\n\n');
  },
};
