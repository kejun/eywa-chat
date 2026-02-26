export function isMemoryRecapQuery(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }

  const asksForRecap = /总结|回顾|列出|告诉我|复述|盘点|哪些|什么/.test(normalized);
  const mentionsRememberedInfo = /记住了|记得|已记住|偏好|长期信息|长期记忆/.test(normalized);
  return asksForRecap && mentionsRememberedInfo;
}

export function hasMemoryWriteIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || isMemoryRecapQuery(normalized)) {
    return false;
  }

  const explicitRememberCommand = /(请|麻烦)?(帮我)?记住(?:一下|下来)?[:：]?\s*\S+/.test(normalized);
  const userPreferenceOrProfileStatement =
    /我(喜欢|偏好|不喜欢|习惯|通常|一般|叫|是|的名字是)/.test(normalized);
  const taskReminderStatement = /提醒我|待办|任务|todo|下次/.test(normalized);

  return explicitRememberCommand || userPreferenceOrProfileStatement || taskReminderStatement;
}

export function extractRememberCommandContent(message: string): string {
  const normalized = message.trim();
  const rememberCommand = normalized.match(/(?:请|麻烦)?(?:帮我)?记住(?:一下|下来)?[:：]?\s*(.+)$/);
  if (rememberCommand?.[1]) {
    return rememberCommand[1].trim();
  }
  return normalized;
}
