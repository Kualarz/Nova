import Anthropic from '@anthropic-ai/sdk';
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

let _client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
  return _client;
}

export async function extractMemories(transcript: string): Promise<CandidateMemory[]> {
  if (!transcript.trim()) return [];

  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: EXTRACTION_PROMPT + transcript }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

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
