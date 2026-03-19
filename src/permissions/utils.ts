import type { ToolExecutionPreview } from '../tools/types.js';

export type GrantResourceType = 'path' | 'domain' | 'database' | 'other';
export const WEBCHAT_DEFAULT_SENDER_ID = 'webchat:default';

/**
 * 计算授权主体：
 * - WebChat 当前不区分用户，统一视为一个本地主体
 * - 其他渠道按 channel + senderId 区分
 */
export function getPrincipalKey(channel = 'webchat', senderId = ''): string {
  if (channel === 'webchat') return WEBCHAT_DEFAULT_SENDER_ID;
  return `${channel}:${senderId || 'anonymous'}`;
}

/**
 * 从 grantKey / preview 中推断资源类型与资源值，供持久授权与审计展示使用。
 * 这层只做最小推断，不追求覆盖未来所有工具。
 */
export function inferGrantResource(
  grantKey: string,
  preview?: ToolExecutionPreview,
): { resourceType: GrantResourceType; resourceValue: string } {
  const firstTarget = preview?.targets?.[0] || '';

  if (grantKey.startsWith('web:')) {
    return { resourceType: 'domain', resourceValue: grantKey.slice('web:'.length) || firstTarget };
  }
  if (grantKey.startsWith('network:search:')) {
    return {
      resourceType: 'domain',
      resourceValue: grantKey.slice('network:search:'.length).replaceAll('|', ', ') || firstTarget,
    };
  }
  if (grantKey.startsWith('network:')) {
    return { resourceType: 'domain', resourceValue: firstTarget || grantKey.slice('network:'.length) };
  }
  if (grantKey.startsWith('file:')) {
    return { resourceType: 'path', resourceValue: firstTarget || grantKey };
  }
  if (grantKey.startsWith('db:')) {
    return { resourceType: 'database', resourceValue: firstTarget || grantKey.slice('db:'.length) };
  }
  return { resourceType: 'other', resourceValue: firstTarget || grantKey };
}

