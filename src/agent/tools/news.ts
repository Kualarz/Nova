import * as fs from 'fs';
import * as path from 'path';
import RssParser from 'rss-parser';
import { getConfig } from '../../lib/config.js';
import type { ToolDefinition } from './index.js';

interface FeedConfig {
  name: string;
  url: string;
  category: string;
}

interface FeedsFile {
  feeds: FeedConfig[];
}

function loadFeedsConfig(): FeedConfig[] {
  const wsPath = getConfig().NOVA_WORKSPACE_PATH;
  const feedsPath = path.join(wsPath, 'news-feeds.yaml');
  if (!fs.existsSync(feedsPath)) return [];

  // Minimal YAML parser — just extract feed entries
  const raw = fs.readFileSync(feedsPath, 'utf-8');
  const feeds: FeedConfig[] = [];
  const lines = raw.split('\n');
  let current: Partial<FeedConfig> = {};

  for (const line of lines) {
    const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
    if (nameMatch) {
      if (current.name && current.url) feeds.push(current as FeedConfig);
      current = { name: nameMatch[1]!.trim() };
    }
    const urlMatch = line.match(/^\s*url:\s*(.+)$/);
    if (urlMatch) current.url = urlMatch[1]!.trim();
    const catMatch = line.match(/^\s*category:\s*(.+)$/);
    if (catMatch) current.category = catMatch[1]!.trim();
  }
  if (current.name && current.url) feeds.push(current as FeedConfig);
  return feeds;
}

const parser = new RssParser({ timeout: 8000 });

export const newsTool: ToolDefinition = {
  name: 'get_news',
  description:
    'Fetch recent news headlines from configured RSS feeds. Optionally filter by category (ai, world, tech) and/or time window. Returns top headlines with title, source, and link.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['ai', 'world', 'tech', 'all'],
        description: 'News category to fetch. Use "all" for everything.',
      },
      since_hours: {
        type: 'number',
        description: 'Only return items published within this many hours. Default is 24.',
      },
      max_items: {
        type: 'number',
        description: 'Maximum number of headlines to return. Default is 10.',
      },
    },
    required: [],
  },
  async run(input) {
    const category = (input['category'] as string | undefined) ?? 'all';
    const sinceHours = (input['since_hours'] as number | undefined) ?? 24;
    const maxItems = (input['max_items'] as number | undefined) ?? 10;
    const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    const allFeeds = loadFeedsConfig();
    const targetFeeds =
      category === 'all' ? allFeeds : allFeeds.filter(f => f.category === category);

    if (targetFeeds.length === 0) {
      return `No feeds configured for category "${category}".`;
    }

    const results: Array<{ title: string; source: string; link: string; date: Date }> = [];

    const fetches = targetFeeds.map(async feed => {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of parsed.items ?? []) {
          const pubDate = item.pubDate ? new Date(item.pubDate) : null;
          if (pubDate && pubDate < cutoff) continue;
          results.push({
            title: item.title ?? '(no title)',
            source: feed.name,
            link: item.link ?? '',
            date: pubDate ?? new Date(0),
          });
        }
      } catch {
        // Skip failed feeds silently — network issues shouldn't block the session
      }
    });

    await Promise.allSettled(fetches);

    if (results.length === 0) {
      return `No news found in the last ${sinceHours} hours for category "${category}".`;
    }

    // Sort newest first, deduplicate by title
    results.sort((a, b) => b.date.getTime() - a.date.getTime());
    const seen = new Set<string>();
    const unique = results.filter(r => {
      const key = r.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique
      .slice(0, maxItems)
      .map(r => `[${r.source}] ${r.title}\n${r.link}`)
      .join('\n\n');
  },
};
