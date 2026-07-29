import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {AppiumDocumentation, appiumDocumentationQueryTool, appiumSkillsTool} from '../index.js';

type ToolDef = {
  name: string;
  annotations?: unknown;
};

void describe('AppiumDocumentation plugin', () => {
  void test('registers documentation tools', () => {
    const tools: ToolDef[] = [];
    const registry = {
      addTool(toolDef: ToolDef) {
        tools.push(toolDef);
      },
    };

    const plugin = new AppiumDocumentation();
    plugin.register(registry);

    assert.equal(plugin.name, 'appium-documentation');
    assert.ok(plugin.version);
    assert.deepEqual(tools, [appiumDocumentationQueryTool, appiumSkillsTool]);
  });
});
