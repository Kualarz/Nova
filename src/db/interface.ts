import type { MemoryCategory, Memory } from '../memory/store.js';

export interface SessionStats {
  sessionCount: number;
  lastSession: string | null;  // ISO string or null if no sessions yet
  daysActive: number;
  memoryCount: number;         // active (non-superseded) Tier 3 memories
}

export type TaskStatus = 'running' | 'done' | 'error';

export interface Task {
  id: string;
  user_id: string;
  description: string;
  project_dir: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface InsertTaskParams {
  userId: string;
  description: string;
  projectDir: string;
}

export interface UpdateTaskParams {
  id: string;
  status: 'done' | 'error';
  result?: string;
  error?: string;
}

export interface InsertMemoryConnectionParams {
  memoryAId: string;
  memoryBId: string;
  similarity: number;
  type: string;
}

export interface FindSimilarForEdgesResult {
  id: string;
  similarity: number;
}

export interface FindSimilarForEdgesParams {
  embedding: number[];
  userId: string;
  limit: number;
  threshold: number;
  excludeId: string;
}

export interface FindNeighborMemoriesParams {
  memoryIds: string[];
  userId: string;
}

export interface Hook {
  id: string;
  event: string;
  skill_name: string;
  enabled: number;
}

export interface InsertHookParams {
  event: string;
  skillName: string;
}

export interface InsertMemoryParams {
  userId: string;
  content: string;
  category: MemoryCategory;
  embedding: number[];
  confidence: number;
  sourceConversationId?: string;
}

export interface MatchMemoriesParams {
  userId: string;
  embedding: number[];
  limit: number;
  threshold: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export interface ConversationSummary {
  id: string;
  started_at: string;
  ended_at: string | null;
  first_message: string | null;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithStats extends Project {
  chat_count: number;
}

export interface Routine {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  prompt: string;
  cron_expr: string;
  enabled: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_output: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutineRun {
  id: string;
  routine_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  output: string | null;
  error: string | null;
}

export interface CreateRoutineParams {
  name: string;
  description?: string;
  prompt: string;
  cron_expr: string;
}

export interface UpdateRoutineParams {
  name?: string;
  description?: string;
  prompt?: string;
  cron_expr?: string;
  enabled?: number;
  last_run_at?: string;
  last_run_status?: string;
  last_run_output?: string;
}

export interface DatabaseProvider {
  // Memories
  insertMemory(params: InsertMemoryParams): Promise<string>;
  matchMemories(params: MatchMemoriesParams): Promise<Memory[]>;
  listMemories(userId: string, limit: number): Promise<Memory[]>;
  supersedeMemory(oldId: string, newId: string): Promise<void>;
  incrementMemoryAccess(memoryIds: string[], accessedAt: string): Promise<void>;

  // Conversations
  startConversation(userId: string): Promise<string>;
  appendConversationMessage(conversationId: string, msg: ConversationMessage): Promise<void>;
  endConversation(id: string, summary?: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  getConversationMessages(conversationId: string): Promise<ConversationMessage[]>;
  listConversations(userId: string, limit: number): Promise<ConversationSummary[]>;
  getOrCreateCompanionConversation(userId: string): Promise<string>;

  // Events
  logEvent(userId: string, type: string, payload: unknown): Promise<void>;

  // Graph edges
  insertMemoryConnection(params: InsertMemoryConnectionParams): Promise<void>;
  findSimilarForEdges(params: FindSimilarForEdgesParams): Promise<FindSimilarForEdgesResult[]>;
  findNeighborMemories(params: FindNeighborMemoriesParams): Promise<Memory[]>;

  // Hooks
  getEnabledHooks(event: string): Promise<Hook[]>;
  insertHook(params: InsertHookParams): Promise<string>;

  // Tasks
  insertTask(params: InsertTaskParams): Promise<string>;
  updateTask(params: UpdateTaskParams): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listTasks(userId: string, limit: number): Promise<Task[]>;
  getTaskCount(userId: string): Promise<number>;

  // Projects
  listProjects(userId: string): Promise<ProjectWithStats[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(userId: string, name: string, description?: string, instructions?: string): Promise<string>;
  updateProject(id: string, updates: { name?: string; description?: string; instructions?: string }): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listProjectConversations(projectId: string): Promise<Array<{ id: string; started_at: string; ended_at: string | null; first_message: string | null }>>;
  linkConversationToProject(conversationId: string, projectId: string | null): Promise<void>;
  getConversationProjectId(conversationId: string): Promise<string | null>;

  // Project memories
  getLatestProjectMemory(projectId: string): Promise<{ id: string; content: string; source: string; created_at: string } | null>;
  insertProjectMemory(projectId: string, content: string, source: string): Promise<string>;
  listProjectsForCron(userId: string, sinceHours: number): Promise<Array<{ id: string; name: string }>>;

  // Connector permissions
  listConnectorPermissions(userId: string, connector?: string): Promise<Array<{ connector: string; tool: string; permission: string }>>;
  setConnectorPermission(userId: string, connector: string, tool: string, permission: 'always-allow' | 'needs-approval' | 'never'): Promise<void>;

  // Routines
  listRoutines(userId: string): Promise<Routine[]>;
  getRoutine(id: string): Promise<Routine | null>;
  createRoutine(userId: string, params: CreateRoutineParams): Promise<string>;
  updateRoutine(id: string, updates: UpdateRoutineParams): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  insertRoutineRun(routineId: string): Promise<string>;
  completeRoutineRun(id: string, status: string, output?: string, error?: string): Promise<void>;
  listRoutineRuns(routineId: string, limit: number): Promise<RoutineRun[]>;

  // Stats
  getSessionStats(userId: string): Promise<SessionStats>;

  // Setup
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}
