import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';
import type { Task } from '../db/interface.js';

export type { Task };

export async function createTask(description: string, projectDir: string): Promise<string> {
  const db = await getDb();
  const config = getConfig();
  return db.insertTask({
    userId: config.NOVA_USER_ID,
    description,
    projectDir,
  });
}

export async function completeTask(id: string, result: string): Promise<void> {
  const db = await getDb();
  await db.updateTask({ id, status: 'done', result });
}

export async function failTask(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.updateTask({ id, status: 'error', error });
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb();
  await db.deleteTask(id);
}

export async function listRecentTasks(limit = 11): Promise<Task[]> {
  const db = await getDb();
  const config = getConfig();
  return db.listTasks(config.NOVA_USER_ID, limit);
}

export async function getTaskCount(): Promise<number> {
  const db = await getDb();
  const config = getConfig();
  return db.getTaskCount(config.NOVA_USER_ID);
}
