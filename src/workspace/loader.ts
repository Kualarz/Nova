import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../lib/config.js';

function workspacePath(...parts: string[]): string {
  return path.join(getConfig().NOVA_WORKSPACE_PATH, ...parts);
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function loadSoul(): string {
  return readFile(workspacePath('SOUL.md'));
}

export function loadAgents(): string {
  return readFile(workspacePath('AGENTS.md'));
}

export function loadUser(): string {
  return readFile(workspacePath('USER.md'));
}

export function loadTier1Memory(): string {
  return readFile(workspacePath('MEMORY.md'));
}

export interface WorkspaceContext {
  soul: string;
  agents: string;
  user: string;
  tier1Memory: string;
}

export function loadWorkspace(): WorkspaceContext {
  return {
    soul: loadSoul(),
    agents: loadAgents(),
    user: loadUser(),
    tier1Memory: loadTier1Memory(),
  };
}
