-- NOVA database schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Requires: Supabase project named "nova", Sydney region

-- Extensions
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Users (single-user today; user_id on every table keeps schema future-proof)
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Tier 3 semantic memory
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  category text not null check (category in ('fact', 'preference', 'observation', 'personality')),
  embedding vector(1536) not null,
  source_conversation_id uuid,
  confidence real not null default 1.0,
  superseded_by uuid references memories(id),
  access_count int not null default 0,
  last_accessed_at timestamptz,
  promoted_to_tier1 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_user_category_idx on memories (user_id, category) where superseded_by is null;
create index memories_embedding_idx on memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Event log (flexible JSONB payload for new event types without migrations)
create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index events_user_type_time_idx on events (user_id, event_type, created_at desc);
create index events_payload_gin on events using gin (payload);

-- Conversations and messages
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary text,
  memory_extracted boolean not null default false
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null,
  tool_name text,
  tool_input jsonb,
  tool_output jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);

-- Add foreign key from memories to conversations (after both tables exist)
alter table memories
  add constraint memories_source_conversation_fk
  foreign key (source_conversation_id) references conversations(id);

-- Semantic similarity search for Tier 3 memories
create or replace function match_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  category text,
  confidence real,
  access_count int,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    m.id,
    m.content,
    m.category,
    m.confidence,
    m.access_count,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.user_id = match_user_id
    and m.superseded_by is null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Increment access stats for a list of memory IDs
create or replace function increment_memory_access(
  memory_ids uuid[],
  accessed_at timestamptz
)
returns void
language sql
as $$
  update memories
  set access_count = access_count + 1,
      last_accessed_at = accessed_at
  where id = any(memory_ids);
$$;

-- Insert Jimmy as the first (and only) user
-- After running, copy the returned UUID into NOVA_USER_ID in your .env
insert into users (name) values ('Jimmy') returning id;
