/**
 * 本地对话持久化 — SQLite 存储层
 *
 * 设计原则：
 * - 存储和发送分离：SQLite 存所有历史，API 只发精选上下文
 * - 零配置：自动创建 DB 文件，用户无需安装任何数据库
 * - 单文件：~/.crabcrush/data/conversations.db
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StoredMessage {
  id: number;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  channel: string;
  senderId: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}

export interface PermissionGrant {
  id?: number;
  principalKey: string;
  grantKey: string;
  scope: 'persistent';
  resourceType: 'path' | 'domain' | 'database' | 'other';
  resourceValue: string;
  createdAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
  meta: Record<string, unknown>;
}

export interface AuditEventRecord {
  id: number;
  conversationId: string;
  principalKey: string;
  eventType: string;
  operationId: string | null;
  toolName: string | null;
  grantKey: string | null;
  allowed: boolean | null;
  scope: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export class ConversationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保目录存在
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    // 开启 WAL 模式（并发读写性能更好）
    this.db.pragma('journal_mode = WAL');
    // 启用外键约束（SQLite 默认关闭，开启后 messages.conversation_id 才真正受 FK 保护）
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
  }

  /**
   * 初始化数据库表结构
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL DEFAULT 'webchat',
        sender_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_conversations_last_active
        ON conversations(last_active_at DESC);

      CREATE TABLE IF NOT EXISTS permission_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        principal_key TEXT NOT NULL,
        grant_key TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('persistent')),
        resource_type TEXT NOT NULL CHECK(resource_type IN ('path', 'domain', 'database', 'other')),
        resource_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        revoked_at INTEGER,
        meta_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_grants_active
        ON permission_grants(principal_key, grant_key);

      CREATE INDEX IF NOT EXISTS idx_permission_grants_principal
        ON permission_grants(principal_key, last_used_at DESC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        principal_key TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        operation_id TEXT,
        tool_name TEXT,
        grant_key TEXT,
        allowed INTEGER,
        scope TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_conversation
        ON audit_events(conversation_id, created_at ASC, id ASC);

      CREATE INDEX IF NOT EXISTS idx_audit_events_operation
        ON audit_events(operation_id, created_at ASC, id ASC);
    `);
  }

  /**
   * 确保会话存在（不存在则创建）
   */
  ensureConversation(id: string, channel = 'webchat', senderId = ''): void {
    const existing = this.db.prepare(
      'SELECT id FROM conversations WHERE id = ?',
    ).get(id);

    if (!existing) {
      this.db.prepare(`
        INSERT INTO conversations (id, channel, sender_id, title, created_at, last_active_at)
        VALUES (?, ?, ?, '', ?, ?)
      `).run(id, channel, senderId, Date.now(), Date.now());
    }
  }

  /**
   * 保存一条消息
   */
  saveMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
    const now = Date.now();

    const save = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO messages (conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `).run(conversationId, role, content, now);

      this.db.prepare(`
        UPDATE conversations SET last_active_at = ? WHERE id = ?
      `).run(now, conversationId);

      if (role === 'user') {
        this.db.prepare(`
          UPDATE conversations SET title = ? WHERE id = ? AND title = ''
        `).run(content.slice(0, 50), conversationId);
      }
    });

    save();
  }

  /**
   * 获取会话的最近 N 条消息（用于构建 API 上下文）
   * @param offset 跳过前 N 条最晚的，用于分页加载更早的消息
   */
  getRecentMessages(conversationId: string, limit = 40, offset = 0): StoredMessage[] {
    const rows = this.db.prepare(`
      SELECT id, conversation_id as conversationId, role, content, created_at as createdAt
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset) as StoredMessage[];

    return rows.reverse();
  }

  /**
   * 获取会话的全部消息（用于导出）
   */
  getAllMessages(conversationId: string): StoredMessage[] {
    return this.db.prepare(`
      SELECT id, conversation_id as conversationId, role, content, created_at as createdAt
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as StoredMessage[];
  }

  /**
   * 获取会话列表（按最后活跃时间倒序）
   * @param channel 可选，筛选渠道（如 'webchat'）
   */
  listConversations(limit = 50, offset = 0, channel?: string): Conversation[] {
    const where = channel ? 'WHERE c.channel = ?' : '';
    const params = channel ? [channel, limit, offset] : [limit, offset];
    const sql = `
      SELECT
        c.id, c.channel, c.sender_id as senderId, c.title,
        c.created_at as createdAt, c.last_active_at as lastActiveAt,
        COUNT(m.id) as messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.last_active_at DESC
      LIMIT ? OFFSET ?
    `;
    return this.db.prepare(sql).all(...params) as Conversation[];
  }

  /**
   * 搜索消息内容
   */
  searchMessages(query: string, limit = 20): (StoredMessage & { conversationTitle: string })[] {
    return this.db.prepare(`
      SELECT
        m.id, m.conversation_id as conversationId, m.role, m.content,
        m.created_at as createdAt, c.title as conversationTitle
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit) as (StoredMessage & { conversationTitle: string })[];
  }

  /**
   * 删除一个会话及其所有消息
   */
  deleteConversation(conversationId: string): void {
    const del = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    });
    del();
  }

  /**
   * 获取会话消息数量
   */
  getMessageCount(conversationId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
    ).get(conversationId) as { count: number };
    return row.count;
  }

  hasActivePermissionGrant(principalKey: string, grantKey: string): boolean {
    const row = this.db.prepare(`
      SELECT 1
      FROM permission_grants
      WHERE principal_key = ? AND grant_key = ? AND revoked_at IS NULL
      LIMIT 1
    `).get(principalKey, grantKey);
    return Boolean(row);
  }

  savePermissionGrant(input: {
    principalKey: string;
    grantKey: string;
    scope: 'persistent';
    resourceType: 'path' | 'domain' | 'database' | 'other';
    resourceValue: string;
    meta?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    const metaJson = JSON.stringify(input.meta ?? {});
    this.db.prepare(`
      INSERT INTO permission_grants (
        principal_key, grant_key, scope, resource_type, resource_value,
        created_at, last_used_at, revoked_at, meta_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(principal_key, grant_key) DO UPDATE SET
        scope = excluded.scope,
        resource_type = excluded.resource_type,
        resource_value = excluded.resource_value,
        last_used_at = excluded.last_used_at,
        revoked_at = NULL,
        meta_json = excluded.meta_json
    `).run(
      input.principalKey,
      input.grantKey,
      input.scope,
      input.resourceType,
      input.resourceValue,
      now,
      now,
      metaJson,
    );
  }

  touchPermissionGrant(principalKey: string, grantKey: string): void {
    this.db.prepare(`
      UPDATE permission_grants
      SET last_used_at = ?
      WHERE principal_key = ? AND grant_key = ? AND revoked_at IS NULL
    `).run(Date.now(), principalKey, grantKey);
  }

  listPermissionGrants(principalKey?: string): PermissionGrant[] {
    const sql = principalKey
      ? `
        SELECT principal_key as principalKey, grant_key as grantKey, scope,
          id,
          resource_type as resourceType, resource_value as resourceValue,
          created_at as createdAt, last_used_at as lastUsedAt, revoked_at as revokedAt,
          meta_json as metaJson
        FROM permission_grants
        WHERE principal_key = ? AND revoked_at IS NULL
        ORDER BY last_used_at DESC
      `
      : `
        SELECT principal_key as principalKey, grant_key as grantKey, scope,
          id,
          resource_type as resourceType, resource_value as resourceValue,
          created_at as createdAt, last_used_at as lastUsedAt, revoked_at as revokedAt,
          meta_json as metaJson
        FROM permission_grants
        WHERE revoked_at IS NULL
        ORDER BY last_used_at DESC
      `;
    const rows = principalKey
      ? this.db.prepare(sql).all(principalKey)
      : this.db.prepare(sql).all();
    return rows.map((row) => ({
      ...(row as Omit<PermissionGrant, 'meta'> & { metaJson: string }),
      meta: parseJsonObject((row as { metaJson: string }).metaJson),
    }));
  }

  revokePermissionGrant(principalKey: string, grantKey: string): boolean {
    const result = this.db.prepare(`
      UPDATE permission_grants
      SET revoked_at = ?
      WHERE principal_key = ? AND grant_key = ? AND revoked_at IS NULL
    `).run(Date.now(), principalKey, grantKey);
    return result.changes > 0;
  }

  saveAuditEvent(input: {
    conversationId: string;
    principalKey?: string;
    eventType: string;
    operationId?: string;
    toolName?: string;
    grantKey?: string;
    allowed?: boolean;
    scope?: string;
    payload?: Record<string, unknown>;
    createdAt?: number;
  }): void {
    this.db.prepare(`
      INSERT INTO audit_events (
        conversation_id, principal_key, event_type, operation_id, tool_name,
        grant_key, allowed, scope, payload_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.conversationId,
      input.principalKey ?? '',
      input.eventType,
      input.operationId ?? null,
      input.toolName ?? null,
      input.grantKey ?? null,
      typeof input.allowed === 'boolean' ? (input.allowed ? 1 : 0) : null,
      input.scope ?? null,
      JSON.stringify(input.payload ?? {}),
      input.createdAt ?? Date.now(),
    );
  }

  listAuditEvents(conversationId: string, limit = 200, offset = 0): AuditEventRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        conversation_id as conversationId,
        principal_key as principalKey,
        event_type as eventType,
        operation_id as operationId,
        tool_name as toolName,
        grant_key as grantKey,
        allowed,
        scope,
        payload_json as payloadJson,
        created_at as createdAt
      FROM audit_events
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset) as Array<{
      id: number;
      conversationId: string;
      principalKey: string;
      eventType: string;
      operationId: string | null;
      toolName: string | null;
      grantKey: string | null;
      allowed: number | null;
      scope: string | null;
      payloadJson: string;
      createdAt: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      principalKey: row.principalKey,
      eventType: row.eventType,
      operationId: row.operationId,
      toolName: row.toolName,
      grantKey: row.grantKey,
      allowed: row.allowed === null ? null : Boolean(row.allowed),
      scope: row.scope,
      payload: parseJsonObject(row.payloadJson),
      createdAt: row.createdAt,
    }));
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
