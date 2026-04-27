export interface ConnectorTool {
  name: string;
  description: string;
  type: 'read' | 'write' | 'delete';
}

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  envKey: string;          // .env key that indicates "connected"
  tools: ConnectorTool[];
}

export const CONNECTOR_CATALOG: ConnectorDef[] = [
  {
    id: 'gmail', name: 'Gmail', description: 'Read inbox, summarize emails, send replies',
    envKey: 'GOOGLE_CREDENTIALS_PATH',
    tools: [
      { name: 'gmail.search', description: 'Search email threads', type: 'read' },
      { name: 'gmail.get-thread', description: 'Read a specific email thread', type: 'read' },
      { name: 'gmail.list-labels', description: 'List user labels', type: 'read' },
      { name: 'gmail.create-draft', description: 'Create a draft email', type: 'write' },
      { name: 'gmail.create-label', description: 'Create a new label', type: 'write' },
      { name: 'gmail.send', description: 'Send an email', type: 'write' },
    ],
  },
  {
    id: 'notion', name: 'Notion', description: 'Read and update Notion pages',
    envKey: 'NOTION_API_KEY',
    tools: [
      { name: 'notion.search', description: 'Search pages', type: 'read' },
      { name: 'notion.get-page', description: 'Read a page', type: 'read' },
      { name: 'notion.create-page', description: 'Create a new page', type: 'write' },
      { name: 'notion.update-page', description: 'Update an existing page', type: 'write' },
    ],
  },
  {
    id: 'web-search', name: 'Web Search', description: 'Search the web',
    envKey: 'WEB_SEARCH_API_KEY',
    tools: [
      { name: 'web-search.query', description: 'Search the web for current info', type: 'read' },
    ],
  },
  {
    id: 'weather', name: 'OpenWeather', description: 'Real-time weather',
    envKey: 'OPENWEATHER_API_KEY',
    tools: [
      { name: 'weather.get', description: 'Get current weather + forecast', type: 'read' },
    ],
  },
  {
    id: 'telegram', name: 'Telegram', description: 'Send messages to Telegram chat',
    envKey: 'TELEGRAM_BOT_TOKEN',
    tools: [
      { name: 'telegram.send', description: 'Send a message', type: 'write' },
    ],
  },
];

export function defaultPermission(toolType: 'read' | 'write' | 'delete'): 'always-allow' | 'needs-approval' | 'never' {
  if (toolType === 'read') return 'always-allow';
  return 'needs-approval';
}
