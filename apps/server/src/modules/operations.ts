import {
  commandResponseSchema,
  correctionRequestSchema,
  correctionResponseSchema,
  disputeRequestSchema,
  operationPreviewRequestSchema,
  operationPreviewSchema,
  recordOperationRequestSchema,
  recordOperationResponseSchema,
} from "@boutikier/contracts";
import type { Hono } from "hono";
import type { Bindings } from "../env.js";
import { camelize, readJson } from "../http.js";
import { callUserRpc, requireBearerToken } from "../supabase.js";

type ApiApp = Hono<{ Bindings: Bindings }>;

export function registerOperationRoutes(app: ApiApp) {
  app.post("/api/operations/preview", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = operationPreviewRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "preview_operation",
      {
        p_shop_client_id: request.shopClientId,
        p_entry_type: request.type,
        p_title: request.title,
        p_amount_xof: request.amountXof,
      },
    );
    return context.json(operationPreviewSchema.parse(camelize(result)));
  });

  app.post("/api/operations", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = recordOperationRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "record_operation",
      {
        p_shop_client_id: request.shopClientId,
        p_entry_type: request.type,
        p_title: request.title,
        p_detail: request.detail ?? null,
        p_amount_xof: request.amountXof,
        p_due_on: request.dueOn ?? null,
        p_occurred_at: request.occurredAt ?? null,
        p_source_channel: request.sourceChannel,
        p_client_reference: request.clientReference ?? null,
        p_idempotency_key: request.idempotencyKey,
        p_duplicate_override: request.duplicateOverride,
      },
    );
    const response = recordOperationResponseSchema.parse(camelize(result));
    return context.json(response, response.recorded ? 201 : 409);
  });

  app.post("/api/entries/:id/correction", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = correctionRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<Record<string, unknown>>(
      context.env,
      token,
      "correct_and_replace_operation",
      {
        p_original_entry_id: context.req.param("id"),
        p_reason: request.reason,
        p_idempotency_key: request.idempotencyKey,
        p_replacement_title: request.replacementTitle ?? null,
        p_replacement_amount_xof: request.replacementAmountXof ?? null,
        p_replacement_detail: request.replacementDetail ?? null,
        p_replacement_due_on: request.replacementDueOn ?? null,
      },
    );
    return context.json(correctionResponseSchema.parse(camelize(result)));
  });

  app.post("/api/entries/:id/disputes", async (context) => {
    const token = requireBearerToken(context.req.header("authorization"));
    const request = disputeRequestSchema.parse(await readJson(context));
    const result = await callUserRpc<string>(
      context.env,
      token,
      "change_dispute_state",
      {
        p_ledger_entry_id: context.req.param("id"),
        p_event_type: request.eventType,
        p_note: request.note ?? null,
        p_idempotency_key: request.idempotencyKey,
      },
    );
    return context.json(commandResponseSchema.parse({ id: result, idempotentReplay: false }));
  });
}
