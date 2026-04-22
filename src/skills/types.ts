/** Parsed frontmatter from a skill .md file. */
export interface SkillFrontmatter {
  /** Unique skill identifier — matches the filename without .md */
  name: string;
  /** One-sentence description shown to the model as context */
  description: string;
  /** Tool names this skill covers — must match keys in ALL_TOOLS */
  tools: string[];
  /** Whether this skill's actions can be undone. Default: true */
  reversible?: boolean;
  /** Whether this skill is enabled. Default: true */
  enabled?: boolean;
}

/** A fully parsed skill — frontmatter + body content. */
export interface Skill {
  /** Unique identifier (from frontmatter or filename) */
  name: string;
  /** One-sentence description */
  description: string;
  /** Tool names this skill covers */
  tools: string[];
  /** Whether this skill's actions can be undone */
  reversible: boolean;
  /** Whether this skill is active */
  enabled: boolean;
  /** Full markdown body — usage instructions for the model */
  body: string;
  /** Absolute path to the source .md file */
  filePath: string;
}
