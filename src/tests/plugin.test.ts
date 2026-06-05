import { describe, expect, test } from '@jest/globals';
import {
  AppiumDocumentation,
  appiumDocumentationQueryTool,
  appiumSkillsTool,
} from '../index.js';

type ToolDef = {
  name: string;
  annotations?: unknown;
};

describe('AppiumDocumentation plugin', () => {
  test('registers documentation tools', () => {
    const tools: ToolDef[] = [];
    const registry = {
      addTool(toolDef: ToolDef) {
        tools.push(toolDef);
      },
    };

    const plugin = new AppiumDocumentation();
    plugin.register(registry);

    expect(plugin.name).toBe('appium-documentation');
    expect(plugin.version).toBe('1.0.0');
    expect(tools).toEqual([appiumDocumentationQueryTool, appiumSkillsTool]);
  });
});
