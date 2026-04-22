import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillLoader } from '../../src/skills/loader.js';

function mkTmp(): string {
  const dir = join(tmpdir(), `nova-skills-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SkillLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a single skill from a .md file', async () => {
    writeFileSync(join(tmpDir, 'web-search.md'), [
      '---',
      'name: web-search',
      'description: Search the web for current information',
      'tools:',
      '  - web_search',
      'reversible: true',
      '---',
      '',
      '# Web Search',
      '',
      'Always cite the source URL.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('web-search');
    expect(skills[0]!.description).toBe('Search the web for current information');
    expect(skills[0]!.tools).toEqual(['web_search']);
    expect(skills[0]!.reversible).toBe(true);
    expect(skills[0]!.enabled).toBe(true);
    expect(skills[0]!.body).toContain('Always cite the source URL');
  });

  it('returns empty array when skills directory does not exist', async () => {
    const loader = new SkillLoader('/nonexistent/path');
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it('skips disabled skills', async () => {
    writeFileSync(join(tmpDir, 'disabled.md'), [
      '---',
      'name: disabled-skill',
      'description: This skill is off',
      'tools: []',
      'enabled: false',
      '---',
      '',
      'Disabled body.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it('loads multiple skills and skips non-.md files', async () => {
    writeFileSync(join(tmpDir, 'weather.md'), [
      '---',
      'name: weather',
      'description: Get current weather',
      'tools:',
      '  - get_weather',
      '---',
      '',
      'Weather instructions.',
    ].join('\n'));

    writeFileSync(join(tmpDir, 'news.md'), [
      '---',
      'name: news',
      'description: Fetch news headlines',
      'tools:',
      '  - get_news',
      '---',
      '',
      'News instructions.',
    ].join('\n'));

    // Non-.md files should be ignored
    writeFileSync(join(tmpDir, 'README.txt'), 'ignore me');

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(2);
    const names = skills.map(s => s.name).sort();
    expect(names).toEqual(['news', 'weather']);
  });

  it('buildSkillsPrompt returns formatted string with all skill bodies', async () => {
    writeFileSync(join(tmpDir, 'weather.md'), [
      '---',
      'name: weather',
      'description: Get current weather',
      'tools:',
      '  - get_weather',
      '---',
      '',
      'Check weather with get_weather tool.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const prompt = await loader.buildSkillsPrompt();

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('weather');
    expect(prompt).toContain('Check weather with get_weather tool.');
  });

  it('buildSkillsPrompt returns empty string when no skills', async () => {
    const loader = new SkillLoader(tmpDir);
    const prompt = await loader.buildSkillsPrompt();
    expect(prompt).toBe('');
  });
});
