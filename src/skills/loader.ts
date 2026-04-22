import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { Skill, SkillFrontmatter } from './types.js';

export class SkillLoader {
  private skillsDir: string;
  private _skills: Skill[] | null = null;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /** Load all enabled skills from the skills directory. Results are cached per instance. */
  async loadAll(): Promise<Skill[]> {
    if (this._skills !== null) return this._skills;

    if (!existsSync(this.skillsDir)) {
      this._skills = [];
      return this._skills;
    }

    let files: string[];
    try {
      files = readdirSync(this.skillsDir).filter(f => f.endsWith('.md'));
    } catch {
      this._skills = [];
      return this._skills;
    }

    const skills: Skill[] = [];

    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = matter(raw);
        const fm = parsed.data as Partial<SkillFrontmatter>;

        // Name defaults to filename without .md
        const name = fm.name ?? file.replace(/\.md$/, '');
        const description = fm.description ?? '';
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        const reversible = fm.reversible !== false; // default true
        const enabled = fm.enabled !== false;       // default true
        const body = parsed.content.trim();

        // Skip disabled skills
        if (!enabled) continue;

        skills.push({ name, description, tools, reversible, enabled, body, filePath });
      } catch (err) {
        console.warn(`[skills] Failed to parse ${file}: ${(err as Error).message}`);
      }
    }

    this._skills = skills;
    return skills;
  }

  /** Return a formatted prompt section with all skill bodies, ready to inject into system prompt. */
  async buildSkillsPrompt(): Promise<string> {
    const skills = await this.loadAll();
    if (skills.length === 0) return '';

    const lines: string[] = ['## Skills'];
    lines.push('');
    lines.push(`NOVA has ${skills.length} active skill${skills.length !== 1 ? 's' : ''}. Each skill provides instructions for using a set of tools.`);
    lines.push('');

    for (const skill of skills) {
      lines.push(`### ${skill.name}`);
      lines.push(`**Tools:** ${skill.tools.join(', ') || 'none'}`);
      lines.push(`**Description:** ${skill.description}`);
      lines.push('');
      if (skill.body) {
        lines.push(skill.body);
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  }

  /** Invalidate cache (call after a skill file is edited). */
  invalidate(): void {
    this._skills = null;
  }
}

// Module-level singleton — points to workspace/skills/ relative to cwd
let _loader: SkillLoader | null = null;

export function getSkillLoader(skillsDir?: string): SkillLoader {
  if (!_loader) {
    const dir = skillsDir ?? join(process.cwd(), 'workspace', 'skills');
    _loader = new SkillLoader(dir);
  }
  return _loader;
}

export function resetSkillLoader(): void {
  _loader = null;
}
