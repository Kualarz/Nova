/**
 * Claude Code integration — spawns `claude -p` subprocess for coding tasks.
 *
 * Each task runs in the background. The task ID is returned immediately;
 * the result is written to the DB when the subprocess finishes.
 * The caller can notify the user on the next turn via the in-session task map.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { createTask, completeTask, failTask } from './store.js';

export interface SpawnResult {
  /** DB task ID — use this with /tasks to check status */
  taskId: string;
}

/** Pending completions: taskId → { resolve, reject } for tests / awaiting callers */
const _pending = new Map<string, () => void>();

/**
 * Spawn a Claude Code session for the given task.
 * Returns the task ID immediately; completes asynchronously.
 * Pass onComplete to be notified when done (used by the REPL to inline-notify Jimmy).
 */
export async function spawnClaudeTask(
  description: string,
  projectDir: string,
  onComplete?: (taskId: string, status: 'done' | 'error', output: string) => void
): Promise<SpawnResult> {
  // Resolve and validate the project directory
  const resolvedDir = path.resolve(projectDir || process.cwd());
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Project directory does not exist: ${resolvedDir}`);
  }

  const taskId = await createTask(description, resolvedDir);

  // Spawn in background — do not await
  void runSubprocess(taskId, description, resolvedDir, onComplete);

  return { taskId };
}

async function runSubprocess(
  taskId: string,
  description: string,
  cwd: string,
  onComplete?: (taskId: string, status: 'done' | 'error', output: string) => void
): Promise<void> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    const errChunks: string[] = [];

    const child = spawn('claude', ['-p', description, '--output-format', 'text'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Inherit parent env so claude picks up its own config/auth
      env: process.env,
    });

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk.toString()));

    child.on('close', async (code) => {
      const stdout = chunks.join('').trim();
      const stderr = errChunks.join('').trim();

      let status: 'done' | 'error';
      let output: string;

      if (code === 0 && stdout) {
        status = 'done';
        output = stdout;
        await completeTask(taskId, stdout).catch(() => {});
      } else {
        status = 'error';
        output = stderr || stdout || `Process exited with code ${code}`;
        await failTask(taskId, output).catch(() => {});
      }

      onComplete?.(taskId, status, output);
      resolve();
    });

    child.on('error', async (err) => {
      const msg = err.message;
      await failTask(taskId, msg).catch(() => {});
      onComplete?.(taskId, 'error', msg);
      resolve();
    });
  });
}
