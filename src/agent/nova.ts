import * as readline from 'readline';
import chalk from 'chalk';
import { getConfig } from '../lib/config.js';
import { getModelRouter } from '../providers/router.js';
import type { Message } from '../providers/interface.js';
import { buildBaseSystemPrompt, buildTier3Injection } from './system-prompt.js';
import { startConversation, appendMessage, endConversation } from '../conversations/store.js';
import { logEvent } from '../events/log.js';
import { appendToDailyNote } from '../memory/tier2-daily.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import { toApiTools, executeTool } from './tools/index.js';
import { handleSlashCommand, isSlashCommand } from './slash-commands.js';
import { fireHook } from '../automation/hooks.js';

function buildTranscript(history: Message[]): string {
  return history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      if (m.tool_calls?.length) {
        const names = m.tool_calls.map(tc => tc.function.name).join(', ');
        return `NOVA: [called ${names}]`;
      }
      const text = m.content ?? '';
      return m.role === 'user' ? `Jimmy: ${text}` : `NOVA: ${text}`;
    })
    .join('\n');
}

async function runTurn(
  systemPrompt: string,
  history: Message[]
): Promise<{ text: string; newMessages: Message[] }> {
  const tools = toApiTools();
  const added: Message[] = [];
  const router = getModelRouter();

  let messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  for (let i = 0; i < 10; i++) {
    const response = await router.chat(messages, { tools });

    if (response.stop_reason === 'stop') {
      const text = response.content ?? '';
      const msg: Message = { role: 'assistant', content: text };
      added.push(msg);
      return { text, newMessages: added };
    }

    if (response.stop_reason === 'tool_calls' && response.tool_calls?.length) {
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      };
      added.push(assistantMsg);
      messages = [...messages, assistantMsg];

      for (const toolCall of response.tool_calls) {
        let toolOutput: string;
        try {
          const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          console.log(chalk.dim(`  [tool] ${toolCall.function.name}(${toolCall.function.arguments})`));
          toolOutput = await executeTool(toolCall.function.name, toolInput);
        } catch (err) {
          toolOutput = `Error: ${(err as Error).message}`;
        }

        const resultMsg: Message = {
          role: 'tool',
          content: toolOutput,
          tool_call_id: toolCall.id,
        };
        added.push(resultMsg);
        messages = [...messages, resultMsg];
      }
      continue;
    }

    const text = response.content ?? '';
    added.push({ role: 'assistant', content: text });
    return { text, newMessages: added };
  }

  return { text: '[Max tool iterations reached]', newMessages: added };
}

export async function runPrompt(userPrompt: string): Promise<string> {
  const conversationId = await startConversation();
  let systemPrompt = await buildBaseSystemPrompt();

  try {
    const tier3 = await buildTier3Injection(userPrompt);
    if (tier3) systemPrompt = systemPrompt + '\n\n---\n\n' + tier3;
  } catch {
    // best-effort
  }

  const history: Message[] = [{ role: 'user', content: userPrompt }];
  await appendMessage(conversationId, { role: 'user', content: userPrompt });

  const { text, newMessages } = await runTurn(systemPrompt, history);

  await appendMessage(conversationId, { role: 'assistant', content: text });
  await endConversation(conversationId);

  // Log tool messages but don't re-append them — runTurn already has them in newMessages
  void newMessages;

  return text;
}

export async function runSession(): Promise<void> {
  const config = getConfig();
  const conversationId = await startConversation();
  await logEvent('session_start', { conversation_id: conversationId });

  let systemPrompt = await buildBaseSystemPrompt();
  const history: Message[] = [];
  let tier3Injected = false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.dim('\nNOVA online. Type your message, or Ctrl+C to exit.\n'));
  fireHook('session.start').catch(() => {});

  const prompt = (): Promise<string> =>
    new Promise(resolve => rl.question(chalk.dim('nova > '), resolve));

  const handleShutdown = async (reason: string) => {
    rl.close();
    console.log(chalk.dim('\nexiting...'));
    try {
      await fireHook('session.end').catch(() => {});
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

    if (isSlashCommand(userInput)) {
      await handleSlashCommand(userInput);
      continue;
    }

    history.push({ role: 'user', content: userInput });
    await appendMessage(conversationId, { role: 'user', content: userInput });
    await logEvent('message', { conversation_id: conversationId, role: 'user' });

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
      const { text, newMessages } = await runTurn(systemPrompt, history);
      for (const msg of newMessages) history.push(msg);

      console.log('\n' + chalk.white(text) + '\n');

      await appendMessage(conversationId, { role: 'assistant', content: text });
      await logEvent('message', { conversation_id: conversationId, role: 'assistant' });

      if (userInput.length > 50) {
        await appendToDailyNote(userInput.slice(0, 200));
      }
    } catch (err) {
      console.error(chalk.red(`\n[nova] error: ${(err as Error).message}\n`));
    }
  }
}
