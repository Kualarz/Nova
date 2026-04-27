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
import { shouldFlush, flushMemories } from '../memory/flush.js';

// Module-level notices queue: slash-commands push here; REPL drains before each prompt.
let _sessionTaskNotices: string[] | null = null;

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

/**
 * Heuristic that flags prompts likely to benefit from a stronger model.
 * Used by adaptive routing — when ON and a COMPLEX_MODEL is configured,
 * prompts judged "complex" are routed there for the current turn only.
 */
export function isComplexPrompt(text: string): boolean {
  const signals = [
    text.length > 400,
    /\b(analyze|design|architect|debug|why|explain|compare|plan|strategy|evaluate)\b/i.test(text),
    /\?[\s\S]*\?/.test(text),
    /\b(step.?by.?step|reason through|think through)\b/i.test(text),
    /```/.test(text),
    text.split('\n').length > 5,
  ];
  return signals.filter(Boolean).length >= 2;
}

// TODO: TOOL_LOAD_MODE not yet wired — agent always preloads all tools.
// When the radio is "on-demand", we should expose a tool-discovery tool
// and load others lazily on demand. For now both modes behave identically.

export async function runTurn(
  systemPrompt: string,
  history: Message[],
  opts: {
    model?: string;
    requestApproval?: (tool: string, args: unknown, description: string) => Promise<boolean>;
    onToolCall?: (name: string, args: unknown, result: string, status: 'success' | 'error' | 'blocked') => Promise<void>;
    /** Phase 4.3: when set, restrict the tool catalog to these names only.
     *  Empty array `[]` means "no tools at all" (pure chat). `undefined` means full catalog. */
    allowedTools?: string[];
  } = {}
): Promise<{ text: string; newMessages: Message[]; modelUsed?: string }> {
  let tools = toApiTools();
  if (opts.allowedTools !== undefined) {
    const allow = new Set(opts.allowedTools);
    tools = allow.size === 0
      ? []
      : tools.filter(t => allow.has(t.function.name));
  }
  const added: Message[] = [];
  const router = getModelRouter();

  let messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  for (let i = 0; i < 10; i++) {
    // Pass undefined (not []) when there are no tools — some providers reject empty arrays.
    const response = await router.chat(messages, { tools: tools.length > 0 ? tools : undefined, model: opts.model });

    if (response.stop_reason === 'stop') {
      const text = response.content ?? '';
      const msg: Message = { role: 'assistant', content: text };
      added.push(msg);
      return { text, newMessages: added, modelUsed: opts.model };
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
        let toolStatus: 'success' | 'error' | 'blocked' = 'success';
        let parsedArgs: unknown = null;
        try {
          const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          parsedArgs = toolInput;
          console.log(chalk.dim(`  [tool] ${toolCall.function.name}(${toolCall.function.arguments})`));
          // Phase 3b: executeTool now consults connector_permissions.
          // `requestApproval` (when provided) lets it pause for user
          // approval over the WS channel for `'needs-approval'` tools.
          toolOutput = await executeTool(toolCall.function.name, toolInput, {
            requestApproval: opts.requestApproval,
          });
          if (toolOutput.startsWith('[blocked]') || toolOutput.startsWith('[denied]')) {
            toolStatus = 'blocked';
          }
        } catch (err) {
          toolOutput = `Error: ${(err as Error).message}`;
          toolStatus = 'error';
        }

        if (opts.onToolCall) {
          try {
            await opts.onToolCall(toolCall.function.name, parsedArgs, toolOutput, toolStatus);
          } catch {
            // best-effort logging; never break the agent loop
          }
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
    return { text, newMessages: added, modelUsed: opts.model };
  }

  return { text: '[Max tool iterations reached]', newMessages: added, modelUsed: opts.model };
}

/**
 * Used by the web UI WebSocket handler.
 * Caller owns the history and conversationId; this just runs one turn.
 */
export async function runWebTurn(
  systemPrompt: string,
  history: Message[],
  userPrompt: string,
  opts: {
    model?: string;
    adaptive?: boolean;
    requestApproval?: (tool: string, args: unknown, description: string) => Promise<boolean>;
  } = {}
): Promise<{ text: string; newMessages: Message[]; modelUsed?: string; modelReason?: string }> {
  const userMsg: Message = { role: 'user', content: userPrompt };
  const config = getConfig();

  // Optionally inject relevant Tier 3 (semantic) memories for this turn.
  let effectivePrompt = systemPrompt;
  if (config.MEMORY_SEARCH === 'on') {
    try {
      const tier3 = await buildTier3Injection(userPrompt);
      if (tier3) effectivePrompt = systemPrompt + '\n\n---\n\n' + tier3;
    } catch {
      // best-effort
    }
  }

  // Adaptive routing: pick COMPLEX_MODEL for "hard" prompts when enabled.
  let chosenModel = opts.model;
  let reason: string | undefined;
  if (opts.adaptive && config.COMPLEX_MODEL && isComplexPrompt(userPrompt)) {
    chosenModel = config.COMPLEX_MODEL;
    reason = 'adaptive: complex prompt';
  } else if (opts.adaptive) {
    reason = 'adaptive: default';
  }

  const result = await runTurn(effectivePrompt, [...history, userMsg], {
    model: chosenModel,
    requestApproval: opts.requestApproval,
  });
  return { ...result, modelUsed: chosenModel, modelReason: reason };
}

/**
 * Routine execution path — runs the full agent loop (so tools fire) with
 * an `onToolCall` hook for per-tool persistence. Auto-approves needs-approval
 * tools since the user authored the routine when creating it.
 */
export async function runRoutine(
  systemPrompt: string,
  userPrompt: string,
  opts: {
    onToolCall?: (name: string, args: unknown, result: string, status: 'success' | 'error' | 'blocked') => Promise<void>;
  } = {}
): Promise<string> {
  const history: Message[] = [{ role: 'user', content: userPrompt }];
  const { text } = await runTurn(systemPrompt, history, {
    requestApproval: () => Promise.resolve(true),
    onToolCall: opts.onToolCall,
  });
  return text;
}

export async function runPrompt(userPrompt: string): Promise<string> {
  const conversationId = await startConversation();
  let systemPrompt = await buildBaseSystemPrompt();

  if (getConfig().MEMORY_SEARCH === 'on') {
    try {
      const tier3 = await buildTier3Injection(userPrompt);
      if (tier3) systemPrompt = systemPrompt + '\n\n---\n\n' + tier3;
    } catch {
      // best-effort
    }
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
  let turnCount = 0;

  // Task completion notifications — module-level so slash-commands can push to it
  _sessionTaskNotices = [];

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
      if (getConfig().MEMORY_GENERATE === 'on') {
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
    // Print any queued task-completion notices before the prompt
    while (_sessionTaskNotices && _sessionTaskNotices.length > 0) {
      console.log(chalk.dim(_sessionTaskNotices.shift()));
    }

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

    if (!tier3Injected && getConfig().MEMORY_SEARCH === 'on') {
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

      // Periodic memory flush every FLUSH_EVERY turns
      turnCount++;
      if (shouldFlush(turnCount) && getConfig().MEMORY_GENERATE === 'on') {
        void flushMemories(buildTranscript(history), conversationId);
      }
    } catch (err) {
      console.error(chalk.red(`\n[nova] error: ${(err as Error).message}\n`));
    }
  }
}

/**
 * Returns the pending-task-notices array for the current session.
 * Slash-commands push to this; the REPL drains it before each prompt.
 * Returns null when called outside a runSession() context.
 */
export function getSessionTaskNotices(): string[] | null {
  return _sessionTaskNotices;
}
