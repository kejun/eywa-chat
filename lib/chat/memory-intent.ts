const REMEMBER_COMMAND_PATTERN = /(?:请|麻烦)?(?:帮我)?(?:记住|记得|记录(?:下来)?)(?:一下|下来)?[:：]?\s*(.+)$/;
const RECAP_ASK_PATTERN = /总结|回顾|列出|告诉我|复述|盘点|哪些|什么/;
const REMEMBERED_INFO_PATTERN = /记住了|记得|已记住|偏好|长期信息|长期记忆/;
const USER_PREFERENCE_OR_PROFILE_PATTERN = /我(喜欢|偏好|不喜欢|习惯|通常|一般|叫|是|的名字是)/;
const TASK_REMINDER_PATTERN = /提醒我|待办|任务|todo|下次/;

function matchRememberCommandContent(message: string): string | null {
  const matched = message.match(REMEMBER_COMMAND_PATTERN);
  if (!matched?.[1]) {
    return null;
  }
  const content = matched[1].trim();
  return content || null;
}

export function isMemoryRecapQuery(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }

  const asksForRecap = RECAP_ASK_PATTERN.test(normalized);
  const mentionsRememberedInfo = REMEMBERED_INFO_PATTERN.test(normalized);
  return asksForRecap && mentionsRememberedInfo;
}

export function hasMemoryWriteIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || isMemoryRecapQuery(normalized)) {
    return false;
  }

  const explicitRememberCommand = Boolean(matchRememberCommandContent(normalized));
  const userPreferenceOrProfileStatement = USER_PREFERENCE_OR_PROFILE_PATTERN.test(normalized);
  const taskReminderStatement = TASK_REMINDER_PATTERN.test(normalized);

  return explicitRememberCommand || userPreferenceOrProfileStatement || taskReminderStatement;
}

export function extractRememberCommandContent(message: string): string {
  const normalized = message.trim();
  const rememberCommandContent = matchRememberCommandContent(normalized);
  if (rememberCommandContent) {
    return rememberCommandContent;
  }
  return normalized;
}
