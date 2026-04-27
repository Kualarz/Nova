/**
 * Connector permission resolver.
 *
 * Phase 3 stored a per-tool permission ('always-allow' | 'needs-approval' |
 * 'never') in the connector_permissions table and exposed a UI for editing
 * it. Phase 3b enforces those permissions at agent tool-call time.
 *
 * Tool-name caveat: the runtime tool registry uses snake_case names like
 * `web_search`, `notion_search`, `search_emails`, while the connector
 * catalog uses dotted ids like `web-search.query`, `notion.search`,
 * `gmail.search`. We translate runtime → catalog name before looking up the
 * stored permission. Tools with no mapping (e.g. `get_news`,
 * `list_calendar_events`) fall through as internal-and-always-allowed.
 *
 * NOTE: when adding a new connector tool to `src/agent/tools/`, also add an
 * entry to RUNTIME_TO_CATALOG below so its permission can be enforced.
 */
import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';
import { CONNECTOR_CATALOG, defaultPermission } from './catalog.js';

export type ToolPermission = 'always-allow' | 'needs-approval' | 'never';

export interface ResolvedTool {
  toolName: string;        // original runtime tool name (as called by the agent)
  catalogName: string | null; // matched catalog tool name, if any
  connectorId: string | null;
  permission: ToolPermission;
}

/** Map runtime tool registry names → catalog tool names. */
const RUNTIME_TO_CATALOG: Record<string, string> = {
  web_search: 'web-search.query',
  get_weather: 'weather.get',
  notion_search: 'notion.search',
  notion_get_page: 'notion.get-page',
  // current `notion_append_to_page` is the closest analog to the catalog's
  // notion.update-page entry; reuse that permission row.
  notion_append_to_page: 'notion.update-page',
  search_emails: 'gmail.search',
  // get_news, list_calendar_events: not in catalog → treated as internal.
};

/**
 * Resolve the permission for a given (runtime) tool name. Returns
 * `'always-allow'` if the tool isn't part of any catalog'd connector — i.e.
 * NOVA-internal tools like memory, file ops, news, calendar stub. Falls
 * back to the catalog default if the user hasn't explicitly set a permission.
 */
export async function resolveToolPermission(toolName: string): Promise<ResolvedTool> {
  const catalogName = RUNTIME_TO_CATALOG[toolName] ?? null;
  if (!catalogName) {
    return { toolName, catalogName: null, connectorId: null, permission: 'always-allow' };
  }

  const connector = CONNECTOR_CATALOG.find(c => c.tools.some(t => t.name === catalogName));
  if (!connector) {
    return { toolName, catalogName, connectorId: null, permission: 'always-allow' };
  }
  const tool = connector.tools.find(t => t.name === catalogName)!;

  const config = getConfig();
  const db = await getDb();
  const stored = await db.listConnectorPermissions(config.NOVA_USER_ID, connector.id);
  const found = stored.find(s => s.tool === catalogName);

  const permission = (found?.permission ?? defaultPermission(tool.type)) as ToolPermission;
  return { toolName, catalogName, connectorId: connector.id, permission };
}
