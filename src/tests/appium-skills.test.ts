import {describe, expect, test} from '@jest/globals';

import {appiumSkillsTool} from '../appium-skills.js';

async function runTool(args: any): Promise<string> {
  const result = await (appiumSkillsTool.execute as any)(args, {});
  return result.content[0].text as string;
}

describe('appium_skills tool contract', () => {
  test('returns Android UiAutomator2 setup skills', async () => {
    const text = await runTool({
      platform: 'android',
      driver: 'uiautomator2',
      mode: 'setup',
    });

    expect(text).toContain('Appium skills for android/uiautomator2');
    expect(text).toContain('Recommended skill order:');
    expect(text).toContain('skills/environment-setup-android/SKILL.md');
  });

  test('rejects unsupported troubleshooting driver path', async () => {
    await expect(
      (appiumSkillsTool.execute as any)(
        {
          platform: 'android',
          driver: 'espresso',
          mode: 'troubleshoot',
        },
        {},
      ),
    ).rejects.toThrow('Troubleshooting guidance is currently scoped');
  });
});
