# @appium/mcp-documentation

Appium MCP documentation query tools and indexed documentation assets.

This package provides an Appium documentation plugin for MCP servers. It exposes
tools that can answer Appium documentation questions and return ordered setup or
troubleshooting guidance from the vendored Appium skills content.

## Tools

- `appium_documentation_query`: queries indexed Appium documentation with RAG.
- `appium_skills`: returns ordered Appium setup or troubleshooting skills for
  Android and iOS local environments.

## Use With appium-mcp

Install this package alongside `appium-mcp` in the server project that starts
your MCP server.

```bash
npm install appium-mcp
npm install @appium/mcp-documentation
```

When developing against a local checkout, build this package first and install
it by path from the appium-mcp server project:

```bash
cd /path/to/appium-mcp-documentation
npm install
npm run build

cd /path/to/your-appium-mcp-server
npm install /path/to/appium-mcp-documentation
```

Register the documentation plugin when creating the Appium MCP server:

```ts
import { createAppiumMcpServer } from 'appium-mcp/core';
import { AppiumDocumentation } from '@appium/mcp-documentation';

const server = createAppiumMcpServer({
  plugins: [new AppiumDocumentation()],
});

await server.start({
  transportType: 'stdio',
});
```

For HTTP stream transport:

```ts
await server.start({
  transportType: 'httpStream',
  httpStream: {
    endpoint: '/sse',
    port: 8080,
  },
});
```

Once registered, the Appium MCP server exposes the normal Appium automation
tools plus `appium_documentation_query` and `appium_skills`.

Note that the default appium-mcp server enables the documentation plugin if available, so you may not need to explicitly register it.

## Direct API

You can also use the documentation query API directly:

```ts
import {
  answerAppiumQuery,
  initializeAppiumDocumentation,
} from '@appium/mcp-documentation';

await initializeAppiumDocumentation();

const result = await answerAppiumQuery({
  query: 'How do I configure UiAutomator2 capabilities?',
});

console.log(result.answer);
```

## Development

Install dependencies:

```bash
npm install
```

Build the package:

```bash
npm run build
```

Run tests and lint:

```bash
npm test
npm run lint
```

Rebuild the documentation index:

```bash
npm run build
npm run index-docs
```

Query the built index from the command line:

```bash
npm run query-docs -- "How do I start an Appium session?"
```

## Dependency Notes

The runtime dependencies are the packages used by the shipped tools and RAG
implementation. `fastmcp` is a development dependency here because this package
only imports its types.
