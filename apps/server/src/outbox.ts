import type { Bindings } from "./env.js";
import { callServiceRpc } from "./supabase.js";

interface OutboxMessage {
  id: string;
  message_type: string;
  recipient_phone_e164: string | null;
  payload: { include_financial_details?: boolean } | null;
}

function isConfigured(env: Bindings) {
  return Boolean(
    env.SUPABASE_SECRET_KEY
    && env.TWILIO_ACCOUNT_SID
    && env.TWILIO_AUTH_TOKEN
    && env.TWILIO_WHATSAPP_FROM,
  );
}

function renderMessage(message: OutboxMessage) {
  const labels: Record<string, string> = {
    debt_receipt: "Un achat à crédit a été enregistré",
    payment_receipt: "Un remboursement a été enregistré",
    correction_notice: "Une correction a été ajoutée",
    dispute_notice: "Une contestation a été mise à jour",
    share_link: "Un relevé privé est disponible",
    verification_result: "Votre vérification Boutikier a été mise à jour",
  };
  const event = labels[message.message_type] ?? "Une activité a été enregistrée";

  // Financial amounts never travel to an unverified phone. The secure app owns details.
  return `${event} dans Boutikier. Ouvrez votre espace sécurisé pour consulter les détails.`;
}

async function sendWhatsApp(env: Bindings, message: OutboxMessage) {
  if (!message.recipient_phone_e164) throw new Error("missing recipient phone");

  const body = new URLSearchParams({
    From: env.TWILIO_WHATSAPP_FROM!,
    To: `whatsapp:${message.recipient_phone_e164}`,
    Body: renderMessage(message),
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const result = await response.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!response.ok || !result.sid) {
    throw new Error(result.message ?? `Twilio returned ${response.status}`);
  }
  return result.sid;
}

export async function processOutbox(env: Bindings) {
  if (!isConfigured(env)) return { processed: 0, skipped: true };

  const workerId = `cloudflare-${crypto.randomUUID()}`;
  const messages = await callServiceRpc<OutboxMessage[]>(
    env,
    "claim_outbox_messages",
    { p_worker_id: workerId, p_limit: 20, p_lease_seconds: 120 },
  );

  let processed = 0;
  for (const message of messages) {
    try {
      const providerMessageId = await sendWhatsApp(env, message);
      await callServiceRpc(env, "mark_outbox_sent", {
        p_message_id: message.id,
        p_worker_id: workerId,
        p_provider_message_id: providerMessageId,
      });
      processed += 1;
    } catch (error) {
      await callServiceRpc(env, "mark_outbox_failed", {
        p_message_id: message.id,
        p_worker_id: workerId,
        p_error: error instanceof Error ? error.message : "unknown provider error",
      });
    }
  }

  return { processed, skipped: false };
}

