-- Valute Migration 002: AI Memories
-- Persistent memory system for Val (AI assistant)

CREATE TABLE IF NOT EXISTS ai_memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('preference', 'fact', 'goal', 'behavior', 'context')),
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  last_accessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_category ON ai_memories(category);

ALTER TABLE ai_conversations ADD COLUMN summary TEXT;
