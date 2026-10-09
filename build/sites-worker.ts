import { handleAutomation } from "../lib/automation/api";
import { runAutomation } from "../lib/automation/runner";
import type { AutomationEnv } from "../lib/automation/types";
import { handleAnalysis, type AnalysisEnv } from "../lib/analyze";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async scheduled(controller: ScheduledController, env: AutomationEnv) {
    await runAutomation(env, "scheduled", controller.scheduledTime);
  },
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/automation" || pathname.startsWith("/api/automation/")) return handleAutomation(request, env as AutomationEnv);
    if (pathname === "/api/analyze" || pathname === "/api/status") return handleAnalysis(request, env as AnalysisEnv);
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
