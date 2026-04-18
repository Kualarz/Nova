import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../lib/config.js';

function dailyNotePath(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(getConfig().NOVA_WORKSPACE_PATH, 'memory', `${yyyy}-${mm}-${dd}.md`);
}

function todayPath(): string {
  return dailyNotePath(new Date());
}

function yesterdayPath(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dailyNotePath(d);
}

function ensureTodayNote(): void {
  const p = todayPath();
  if (!fs.existsSync(p)) {
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(p, `# Daily Note — ${today}\n\n`, 'utf-8');
  }
}

export function getTier2Context(): string {
  ensureTodayNote();
  const parts: string[] = [];

  const todayContent = fs.existsSync(todayPath()) ? fs.readFileSync(todayPath(), 'utf-8') : '';
  const yesterdayContent = fs.existsSync(yesterdayPath()) ? fs.readFileSync(yesterdayPath(), 'utf-8') : '';

  if (yesterdayContent.trim()) parts.push(yesterdayContent.trim());
  if (todayContent.trim()) parts.push(todayContent.trim());

  return parts.join('\n\n');
}

export function appendToDailyNote(entry: string): void {
  ensureTodayNote();
  const timestamp = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  fs.appendFileSync(todayPath(), `\n- ${timestamp}: ${entry}\n`, 'utf-8');
}
