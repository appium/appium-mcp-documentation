import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {appiumSkillsTool} from '../appium-skills.js';

async function runTool(args: any): Promise<string> {
  const result = await (appiumSkillsTool.execute as any)(args, {});
  return result.content[0].text as string;
}

void describe('appium_skills tool contract', () => {
  void test('returns Android UiAutomator2 setup skills', async () => {
    const text = await runTool({
      platform: 'android',
      driver: 'uiautomator2',
      mode: 'setup',
    });

    assert.match(text, /Appium skills for android\/uiautomator2/);
    assert.match(text, /Recommended skill order:/);
    assert.match(text, /skills\/environment-setup-android\/SKILL\.md/);
  });

  void test('rejects unsupported troubleshooting driver path', async () => {
    await assert.rejects(
      (appiumSkillsTool.execute as any)(
        {
          platform: 'android',
          driver: 'espresso',
          mode: 'troubleshoot',
        },
        {},
      ),
      /Troubleshooting guidance is currently scoped/,
    );
  });
});
