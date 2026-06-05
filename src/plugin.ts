import { appiumDocumentationQueryTool, appiumSkillsTool } from './tools.js';
import pkg from '../package.json' with { type: 'json' };

type ToolDef = typeof appiumDocumentationQueryTool;

type McpRegistry = {
  addTool(toolDef: ToolDef): void;
};

/**
 * Appium documentation plugin.
 *
 * This class is intentionally structural: it exposes the same shape expected by
 * appium-mcp without importing appium-mcp types and creating a circular package
 * dependency.
 */
export class AppiumDocumentation {
  readonly name = 'appium-documentation';
  readonly version = pkg.version;

  register(registry: McpRegistry): void {
    registry.addTool(appiumDocumentationQueryTool);
    registry.addTool(appiumSkillsTool);
  }
}
