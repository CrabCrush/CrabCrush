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

export class ConversationStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保目录存在
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    // 开启 WAL 模式（并发读写性能更好）
    this.db.pragma('journal_mode = WAL');

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

    this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?)
    `).run(conversationId, role, content, now);

    // 更新会话的最后活跃时间和标题（用第一条用户消息作为标题）
    this.db.prepare(`
      UPDATE conversations SET last_active_at = ? WHERE id = ?
    `).run(now, conversationId);

    // 如果标题为空，用第一条用户消息的前 50 个字符作为标题
    if (role === 'user') {
      this.db.prepare(`
        UPDATE conversations SET title = ? WHERE id = ? AND title = ''
      `).run(content.slice(0, 50), conversationId);
    }
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

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
