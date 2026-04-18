import { getConfig } from '../../lib/config.js';
import type { ToolDefinition } from './index.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getConfig().NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function notionKeyGuard(): string | null {
  if (!getConfig().NOTION_API_KEY) {
    return 'Notion is not configured. Add NOTION_API_KEY to your .env (create an integration at notion.so/my-integrations).';
  }
  return null;
}

// Flatten Notion rich text to plain string
function richText(arr: Array<{ plain_text?: string }> | undefined): string {
  return (arr ?? []).map(b => b.plain_text ?? '').join('');
}

// Extract plain-text title from a Notion page
function pageTitle(page: Record<string, unknown>): string {
  const props = (page['properties'] as Record<string, unknown>) ?? {};
  for (const val of Object.values(props)) {
    const p = val as { type?: string; title?: Array<{ plain_text?: string }> };
    if (p.type === 'title') return richText(p.title) || '(untitled)';
  }
  return '(untitled)';
}

export const notionSearchTool: ToolDefinition = {
  name: 'notion_search',
  description:
    'Search across your Notion workspace for pages and databases matching a query. Returns page titles and URLs.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — keywords or page title fragment',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return. Default is 5.',
      },
    },
    required: ['query'],
  },
  async run(input) {
    const guard = notionKeyGuard();
    if (guard) return guard;

    const query = input['query'] as string;
    const maxResults = (input['max_results'] as number | undefined) ?? 5;

    const resp = await fetch(`${NOTION_API}/search`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({ query, page_size: maxResults }),
    });

    if (!resp.ok) {
      throw new Error(`Notion search failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = data.results ?? [];

    if (results.length === 0) return `No Notion pages found for "${query}".`;

    return results
      .map(page => {
        const title = pageTitle(page);
        const url = (page['url'] as string | undefined) ?? '';
        const objType = (page['object'] as string) === 'database' ? '[DB]' : '[Page]';
        return `${objType} ${title}\n${url}`;
      })
      .join('\n\n');
  },
};

export const notionGetPageTool: ToolDefinition = {
  name: 'notion_get_page',
  description:
    'Get the content of a Notion page by its ID or URL. Returns the page title and block content as plain text.',
  input_schema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'Notion page ID (32-char hex) or full Notion page URL',
      },
    },
    required: ['page_id'],
  },
  async run(input) {
    const guard = notionKeyGuard();
    if (guard) return guard;

    let pageId = input['page_id'] as string;

    // Extract ID from URL if full URL was given
    const urlMatch = pageId.match(/([a-f0-9]{32})/i);
    if (urlMatch) pageId = urlMatch[1]!;

    // Fetch page metadata
    const pageResp = await fetch(`${NOTION_API}/pages/${pageId}`, {
      headers: notionHeaders(),
    });
    if (!pageResp.ok) {
      throw new Error(`Notion get page failed: ${pageResp.status} ${pageResp.statusText}`);
    }
    const page = (await pageResp.json()) as Record<string, unknown>;
    const title = pageTitle(page);

    // Fetch blocks
    const blocksResp = await fetch(`${NOTION_API}/blocks/${pageId}/children?page_size=50`, {
      headers: notionHeaders(),
    });
    if (!blocksResp.ok) {
      return `Title: ${title}\n(Could not fetch page content)`;
    }

    const blocksData = (await blocksResp.json()) as {
      results?: Array<Record<string, unknown>>;
    };

    const lines: string[] = [`# ${title}`, ''];
    for (const block of blocksData.results ?? []) {
      const type = block['type'] as string;
      const blockContent = block[type] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
      const text = richText(blockContent?.rich_text);
      if (text) lines.push(text);
    }

    return lines.join('\n').slice(0, 4000); // cap at 4k chars to avoid huge context
  },
};

export const notionCreatePageTool: ToolDefinition = {
  name: 'notion_append_to_page',
  description:
    'Append a text note to an existing Notion page. Finds the page by search query first, then appends.',
  input_schema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'Notion page ID (32-char hex) or full Notion page URL',
      },
      content: {
        type: 'string',
        description: 'Text content to append as a new paragraph',
      },
    },
    required: ['page_id', 'content'],
  },
  async run(input) {
    const guard = notionKeyGuard();
    if (guard) return guard;

    let pageId = input['page_id'] as string;
    const content = input['content'] as string;

    const urlMatch = pageId.match(/([a-f0-9]{32})/i);
    if (urlMatch) pageId = urlMatch[1]!;

    const resp = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content } }],
            },
          },
        ],
      }),
    });

    if (!resp.ok) {
      throw new Error(`Notion append failed: ${resp.status} ${resp.statusText}`);
    }

    return `Appended to page ${pageId}.`;
  },
};
