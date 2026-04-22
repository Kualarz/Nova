import { getModelRouter } from '../providers/router.js';
import { getConfig } from '../lib/config.js';
import { MemoryCategory } from './store.js';

export interface CandidateMemory {
  content: string;
  category: MemoryCategory;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are extracting durable facts about the user from a conversation transcript.

Extract only things that are:
- Genuinely new or updated facts about the user
- Likely to be relevant in future conversations
- Not already obvious from the user profile

Categories:
- fact: objective, verifiable (where they live, what they work on, family)
- preference: how they like things (tools, communication style, food, etc.)
- observation: patterns you noticed (works late, avoids X, tends to Y)
- personality: how the AI should behave with them (dry humor lands, don't over-apologize)

Return a JSON array. Each item: { "content": "...", "category": "...", "confidence": 0.0-1.0 }
Use confidence 0.9+ for clear, explicit statements. 0.7-0.9 for inferred but likely. Below 0.7: skip.
Return [] if nothing worth extracting.

Conversation:
`;

export async function extractMemories(transcript: string): Promise<CandidateMemory[]> {
  if (!transcript.trim()) return [];

  const router = getModelRouter();
  const response = await router.chat([
    { role: 'user', content: EXTRACTION_PROMPT + transcript },
  ]);

  const text = response.content ?? '';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const candidates = JSON.parse(jsonMatch[0]) as CandidateMemory[];
    return candidates.filter(
      c => c.content && c.category && c.confidence >= 0.7
    );
  } catch {
    return [];
  }
}
