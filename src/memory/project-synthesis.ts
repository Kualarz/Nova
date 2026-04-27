import { getDb } from '../db/client.js';
import { getModelRouter } from '../providers/router.js';

export async function synthesizeProjectMemory(
  projectId: string,
  source: 'chat-end' | 'nightly-cron'
): Promise<string | null> {
  const db = await getDb();
  const project = await db.getProject(projectId);
  if (!project) return null;

  const conversations = await db.listProjectConversations(projectId);
  if (!conversations.length) return null;

  // Pull last 5 chats' messages to keep prompt size manageable
  const recent = conversations.slice(0, 5);
  const transcript: string[] = [];
  for (const c of recent) {
    const msgs = await db.getConversationMessages(c.id);
    const userMsgs = msgs.filter(m => m.role === 'user' || m.role === 'assistant').slice(-20);
    if (!userMsgs.length) continue;
    transcript.push(`--- Chat ${c.id.slice(0, 8)} ---`);
    for (const m of userMsgs) {
      transcript.push(`${m.role}: ${m.content?.slice(0, 500) ?? ''}`);
    }
  }

  if (!transcript.length) return null;

  const prompt = `You're maintaining the memory for a project called "${project.name}".
${project.description ? 'Description: ' + project.description : ''}
${project.instructions ? 'Instructions: ' + project.instructions : ''}

Below are recent chats inside this project. Write a concise (4-8 bullet points) synthesis of what's been discussed, decided, or learned. Focus on durable facts, decisions, recurring themes, open questions. No fluff.

${transcript.join('\n').slice(0, 12000)}`;

  try {
    const router = getModelRouter();
    const resp = await router.chat([
      { role: 'system', content: 'You synthesize project chat history into concise memory.' },
      { role: 'user', content: prompt },
    ], { temperature: 0.3 });

    const synthesis = (resp.content ?? '').trim();
    if (!synthesis) return null;

    await db.insertProjectMemory(projectId, synthesis, source);
    return synthesis;
  } catch (err) {
    console.warn('[project-synthesis]', (err as Error).message);
    return null;
  }
}
