/**
 * Slack Block Kit formatter for Guardian alerts.
 * Webhook URL is passed as a parameter — no secret resolution.
 */

export interface GuardianAlertOptions {
  severity: "warning" | "critical";
  flagKey: string;
  flagName: string;
  decision: "regression_detected" | "auto_disabled";
  enforced: boolean;
  reason: string;
  metrics: {
    treatmentErrorRate?: number | null;
    controlErrorRate?: number | null;
    treatmentPublishSuccessRate?: number | null;
    controlPublishSuccessRate?: number | null;
  };
  posthogFlagUrl: string;
  inngestRunUrl?: string;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

/**
 * Post a Guardian alert to Slack via Incoming Webhook.
 * No-op if `webhookUrl` is falsy. Swallows errors.
 */
export async function postGuardianAlert(
  webhookUrl: string | null | undefined,
  opts: GuardianAlertOptions,
): Promise<void> {
  try {
    if (!webhookUrl) return;

    const color = opts.severity === "critical" ? "#DC2626" : "#EAB308";
    const prefix = opts.enforced
      ? ":rotating_light: *FLAG AUTO-DISABLED*"
      : ":warning: *Regression detected (dry-run)*";
    const mention = opts.enforced ? "<!channel> " : "";

    const blocks: unknown[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${mention}${prefix}\n*Flag*: \`${opts.flagKey}\` — ${opts.flagName}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Reason*\n${opts.reason}` },
          { type: "mrkdwn", text: `*Decision*\n${opts.decision}` },
          {
            type: "mrkdwn",
            text: `*Error rate*\nTreatment: ${fmtPct(opts.metrics.treatmentErrorRate)}\nControl: ${fmtPct(opts.metrics.controlErrorRate)}`,
          },
          {
            type: "mrkdwn",
            text: `*Publish success*\nTreatment: ${fmtPct(opts.metrics.treatmentPublishSuccessRate)}\nControl: ${fmtPct(opts.metrics.controlPublishSuccessRate)}`,
          },
        ],
      },
    ];

    const actionElements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Open in PostHog" },
        url: opts.posthogFlagUrl,
      },
    ];
    if (opts.inngestRunUrl) {
      actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "Inngest run" },
        url: opts.inngestRunUrl,
      });
    }
    blocks.push({ type: "actions", elements: actionElements });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [{ color, blocks }] }),
    });

    if (!res.ok) {
      console.warn(`Slack webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.warn("Slack alert dispatch failed:", err instanceof Error ? err.message : String(err));
  }
}
