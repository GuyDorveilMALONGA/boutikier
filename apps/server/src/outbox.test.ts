import assert from "node:assert/strict";
import test from "node:test";
import { processOutbox } from "./outbox.js";

test("scheduled outbox work is inert until privileged provider secrets exist", async () => {
  const result = await processOutbox({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  });

  assert.deepEqual(result, { processed: 0, skipped: true });
});
