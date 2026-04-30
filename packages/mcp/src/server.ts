import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Store } from './store/index.js';
import { TOOL_DEFS, runTool } from './tools.js';

/**
 * Telemetry hook fired on every tool dispatch — once per call, regardless
 * of whether the tool threw. Used by the `spine-mcp dogfood` command to
 * record latency + outcomes to a local SQLite for self-audit (see
 * docs/DOGFOOD_PROTOCOL.md). The hook is best-effort — exceptions inside
 * it are swallowed so a broken telemetry sink can never block a real
 * tool call.
 */
export type ToolCallTelemetry = {
  name: string;
  args: Record<string, unknown>;
  startedAt: number; // epoch ms
  latencyMs: number;
  outcome: 'ok' | 'error';
  // Truncated text result for size — first 4KB. The full payload would be
  // unbounded (a recall could return 50KB) so we trim before logging.
  resultPreview: string | null;
  errorMessage: string | null;
};

export type StartServerOptions = {
  onToolCall?: (event: ToolCallTelemetry) => void | Promise<void>;
};

const RESULT_PREVIEW_BYTES = 4096;

export async function startServer(
  store: Store,
  opts: StartServerOptions = {}
): Promise<void> {
  const server = new Server(
    { name: 'spine', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const cleanArgs = (args ?? {}) as Record<string, unknown>;
    const startedAt = Date.now();
    let outcome: 'ok' | 'error' = 'ok';
    let resultText: string | null = null;
    let errorMessage: string | null = null;

    try {
      const text = await runTool(store, name, cleanArgs);
      resultText = text;
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      outcome = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `spine_error: ${errorMessage}` }],
        isError: true,
      };
    } finally {
      // Telemetry: best-effort, never blocks the tool response. Wraps in
      // try/catch so a broken sink can't poison the request handler.
      if (opts.onToolCall) {
        try {
          const event: ToolCallTelemetry = {
            name,
            args: cleanArgs,
            startedAt,
            latencyMs: Date.now() - startedAt,
            outcome,
            resultPreview:
              resultText !== null
                ? resultText.slice(0, RESULT_PREVIEW_BYTES)
                : null,
            errorMessage,
          };
          // Don't await — if the sink is slow, we let it fall behind. Errors
          // get swallowed by the inner catch (Promise.resolve().catch).
          Promise.resolve(opts.onToolCall(event)).catch(() => {
            /* swallow */
          });
        } catch {
          /* swallow */
        }
      }
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[spine] MCP server connected via stdio');
}
