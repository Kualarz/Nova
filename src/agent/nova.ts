import Anthropic from '@anthropic-ai/sdk';
import * as readline from 'readline';
import chalk from 'chalk';
import { getConfig } from '../lib/config.js';
import { buildBaseSystemPrompt, buildTier3Injection } from './system-prompt.js';
import { startConversation, appendMessage, endConversation } from '../conversations/store.js';
import { logEvent } from '../events/log.js';
import { appendToDailyNote } from '../memory/tier2-daily.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import { toApiTools, executeTool } from './tools/index.js';
import { handleSlashCommand, isSlashCommand } from './slash-commands.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

type ApiMessage = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
  return client;
}

function buildTranscript(history: ApiMessage[]): string {
  return history
    .map(m => {
      if (m.role === 'user') {
        const content = Array.isArray(m.content)
          ? m.content
              .map(b => {
                if (typeof b === 'string') return b;
                if (b.type === 'text') return b.text;
                if (b.type === 'tool_result') return `[tool result]`;
                return '';
              })
              .join('')
          : m.content;
        return `Jimmy: ${content}`;
      } else {
        const content = Array.isArray(m.content)
          ? m.content
              .map((b: ContentBlockParam) => {
                if (b.type === 'text') return b.text;
                if (b.type === 'tool_use') return `[called ${b.name}]`;
                return '';
              })
              .join('')
          : m.content;
        return `NOVA: ${content}`;
      }
    })
    .join('\n');
}

/**
 * Run a single Claude turn, handling tool-use loops automatically.
 * Returns the final assistant text.
 */
async function runTurn(
  systemPrompt: string,
  history: ApiMessage[]
): Promise<{ text: string; newMessages: ApiMessage[] }> {
  const tools = toApiTools();
  const added: ApiMessage[] = [];

  let messages = [...history];

  for (let i = 0; i < 10; i++) {
    const response = await getClient().messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools,
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');
      added.push({ role: 'assistant', content: response.content });
      return { text, newMessages: added };
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant message with tool_use blocks to history
      const assistantMsg: ApiMessage = { role: 'assistant', content: response.content };
      added.push(assistantMsg);
      messages = [...messages, assistantMsg];

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let toolOutput: string;
        try {
          console.log(chalk.dim(`  [tool] ${block.name}(${JSON.stringify(block.input)})`));
          toolOutput = await executeTool(block.name, block.input as Record<string, unknown>);
        } catch (err) {
          toolOutput = `Error: ${(err as Error).message}`;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolOutput,
        });
      }

      // Feed tool results back as a user message
      const toolResultMsg: ApiMessage = { role: 'user', content: toolResults };
      added.push(toolResultMsg);
      messages = [...messages, toolResultMsg];
      continue;
    }

    // Unexpected stop reason — return what we have
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    added.push({ role: 'assistant', content: response.content });
    return { text, newMessages: added };
  }

  return {
    text: '[Max tool iterations reached]',
    newMessages: added,
  };
}

export async function runSession(): Promise<void> {
  const conversationId = await startConversation();
  await logEvent('session_start', { conversation_id: conversationId });

  let systemPrompt = buildBaseSystemPrompt();
  const history: ApiMessage[] = [];
  let tier3Injected = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.dim('\nNOVA online. Type your message, or Ctrl+C to exit.\n'));

  const prompt = (): Promise<string> =>
    new Promise(resolve => rl.question(chalk.dim('nova > '), resolve));

  const handleShutdown = async (reason: string) => {
    rl.close();
    console.log(chalk.dim('\nexiting...'));

    try {
      const transcript = buildTranscript(history);
      if (transcript.trim()) {
        const candidates = await extractMemories(transcript);
        if (candidates.length > 0) {
          await reconcileMemories(candidates, conversationId);
          await logEvent('memory_extracted', {
            conversation_id: conversationId,
            count: candidates.length,
          });
        }
      }
      await endConversation(conversationId);
      await logEvent('session_end', { conversation_id: conversationId, reason });
    } catch (err) {
      console.error(chalk.red(`[nova] session end error: ${(err as Error).message}`));
    }

    process.exit(0);
  };

  process.on('SIGINT', () => { void handleShutdown('sigint'); });

  for (;;) {
    let userInput: string;
    try {
      userInput = await prompt();
    } catch {
      await handleShutdown('eof');
      return;
    }

    if (!userInput.trim()) continue;

    // Handle slash commands before sending to API
    if (isSlashCommand(userInput)) {
      await handleSlashCommand(userInput);
      continue;
    }

    history.push({ role: 'user', content: userInput });
    await appendMessage(conversationId, { role: 'user', content: userInput });
    await logEvent('message', { conversation_id: conversationId, role: 'user' });

    // Inject Tier 3 into system prompt after first message (one-time, best-effort)
    if (!tier3Injected) {
      tier3Injected = true;
      try {
        const tier3 = await buildTier3Injection(userInput);
        if (tier3) systemPrompt = systemPrompt + '\n\n---\n\n' + tier3;
      } catch {
        // best-effort
      }
    }

    try {
      const { text: assistantText, newMessages } = await runTurn(systemPrompt, history);

      // Splice all new messages (assistant + any tool turns) into history
      for (const msg of newMessages) {
        history.push(msg);
      }

      console.log('\n' + chalk.white(assistantText) + '\n');

      // Persist only the final assistant text (tool results are transient context)
      await appendMessage(conversationId, { role: 'assistant', content: assistantText });
      await logEvent('message', { conversation_id: conversationId, role: 'assistant' });

      if (userInput.length > 50) {
        await appendToDailyNote(userInput.slice(0, 200));
      }
    } catch (err) {
      console.error(chalk.red(`\n[nova] error: ${(err as Error).message}\n`));
    }
  }
}
