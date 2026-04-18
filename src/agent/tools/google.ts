/**
 * Google Calendar and Gmail — Step 7 stubs.
 *
 * Full OAuth integration is Step 7 of the NOVA build plan.
 * Until then, these tools respond with a friendly setup prompt
 * so NOVA can explain the situation instead of erroring.
 */

import { ToolDefinition } from './index.js';

export const calendarTool: ToolDefinition = {
  name: 'list_calendar_events',
  description:
    'List upcoming Google Calendar events. Requires Step 7 OAuth setup — returns setup instructions until configured.',
  input_schema: {
    type: 'object',
    properties: {
      days_ahead: {
        type: 'number',
        description: 'How many days ahead to look (default: 7)',
      },
    },
    required: [],
  },
  async run(_input) {
    return (
      'Google Calendar is not yet configured. To enable it, complete Step 7 of the NOVA ' +
      'setup plan: create a Google Cloud project, enable the Calendar API, download OAuth 2.0 ' +
      'credentials (Desktop app type), and set GOOGLE_CREDENTIALS_PATH in your .env to the ' +
      'path of that credentials JSON file. Once done, the calendar integration will be wired up.'
    );
  },
};

export const gmailSearchTool: ToolDefinition = {
  name: 'search_emails',
  description:
    'Search Gmail threads by query string. Requires Step 7 OAuth setup — returns setup instructions until configured.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (e.g. "from:boss@example.com is:unread")',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of threads to return (default: 10)',
      },
    },
    required: ['query'],
  },
  async run(_input) {
    return (
      'Gmail is not yet configured. To enable it, complete Step 7 of the NOVA ' +
      'setup plan: create a Google Cloud project, enable the Gmail API (alongside Calendar), ' +
      'download OAuth 2.0 credentials (Desktop app type), and set GOOGLE_CREDENTIALS_PATH ' +
      'in your .env. Once the OAuth flow runs once, NOVA will be able to search and summarize ' +
      'your emails.'
    );
  },
};
