import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ConversationStore } from '../src/storage/database.js';

describe('ConversationStore', () => {
  let store: ConversationStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'crabcrush-test-'));
    store = new ConversationStore(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates database and tables', () => {
    // 如果构造函数没抛错，说明 schema 创建成功
    expect(store).toBeDefined();
  });

  it('creates conversation and saves messages', () => {
    store.ensureConversation('sess-1', 'webchat', 'user-1');
    store.saveMessage('sess-1', 'user', '你好');
    store.saveMessage('sess-1', 'assistant', '你好！有什么可以帮你的？');

    const messages = store.getAllMessages('sess-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('你好');
    expect(messages[1].role).toBe('assistant');
  });

  it('auto-sets conversation title from first user message', () => {
    store.ensureConversation('sess-1');
    store.saveMessage('sess-1', 'user', '帮我写一段 Python 代码');

    const conversations = store.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe('帮我写一段 Python 代码');
  });

  it('getRecentMessages returns messages in chronological order with limit', () => {
    store.ensureConversation('sess-1');

    // 存 10 条消息
    for (let i = 1; i <= 5; i++) {
      store.saveMessage('sess-1', 'user', `问题 ${i}`);
      store.saveMessage('sess-1', 'assistant', `回答 ${i}`);
    }

    // 只取最近 4 条
    const recent = store.getRecentMessages('sess-1', 4);
    expect(recent).toHaveLength(4);
    expect(recent[0].content).toBe('问题 4'); // 最早的
    expect(recent[3].content).toBe('回答 5'); // 最新的
  });

  it('searchMessages finds matching content', () => {
    store.ensureConversation('sess-1');
    store.saveMessage('sess-1', 'user', '帮我查一下天气');
    store.saveMessage('sess-1', 'assistant', '今天北京晴，25度');

    store.ensureConversation('sess-2');
    store.saveMessage('sess-2', 'user', '写一段代码');

    const results = store.searchMessages('天气');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('帮我查一下天气');
  });

  it('deleteConversation removes conversation and all messages', () => {
    store.ensureConversation('sess-1');
    store.saveMessage('sess-1', 'user', '你好');
    store.saveMessage('sess-1', 'assistant', '你好！');

    store.deleteConversation('sess-1');

    expect(store.getAllMessages('sess-1')).toHaveLength(0);
    expect(store.listConversations()).toHaveLength(0);
  });

  it('getMessageCount returns correct count', () => {
    store.ensureConversation('sess-1');
    expect(store.getMessageCount('sess-1')).toBe(0);

    store.saveMessage('sess-1', 'user', '你好');
    store.saveMessage('sess-1', 'assistant', '你好！');
    expect(store.getMessageCount('sess-1')).toBe(2);
  });

  it('listConversations returns sorted by last active', () => {
    store.ensureConversation('old');
    store.saveMessage('old', 'user', '旧对话');

    store.ensureConversation('new');
    store.saveMessage('new', 'user', '新对话');

    const list = store.listConversations();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('new'); // 最新的在前
    expect(list[1].id).toBe('old');
  });

  it('handles multiple conversations independently', () => {
    store.ensureConversation('sess-1', 'webchat', 'user-a');
    store.ensureConversation('sess-2', 'dingtalk', 'user-b');

    store.saveMessage('sess-1', 'user', '消息 A');
    store.saveMessage('sess-2', 'user', '消息 B');

    expect(store.getAllMessages('sess-1')).toHaveLength(1);
    expect(store.getAllMessages('sess-2')).toHaveLength(1);
    expect(store.getAllMessages('sess-1')[0].content).toBe('消息 A');
    expect(store.getAllMessages('sess-2')[0].content).toBe('消息 B');
  });

  it('listConversations filters by channel', () => {
    store.ensureConversation('s1', 'webchat');
    store.saveMessage('s1', 'user', 'WebChat 消息');
    store.ensureConversation('s2', 'dingtalk');
    store.saveMessage('s2', 'user', '钉钉消息');

    expect(store.listConversations(50, 0, 'webchat')).toHaveLength(1);
    expect(store.listConversations(50, 0, 'webchat')[0].id).toBe('s1');
    expect(store.listConversations(50, 0, 'dingtalk')).toHaveLength(1);
    expect(store.listConversations(50, 0, 'dingtalk')[0].id).toBe('s2');
  });
});
