import { openDB, type DBSchema } from "idb";

interface DraftRecord {
  id: string;
  shopClientId: string;
  type: "debt" | "repayment";
  title: string;
  amountXof: number;
  updatedAt: string;
}

interface DraftDatabase extends DBSchema {
  operations: {
    key: string;
    value: DraftRecord;
    indexes: { "by-updated": string };
  };
}

const database = openDB<DraftDatabase>("boutikier", 1, {
  upgrade(db) {
    const store = db.createObjectStore("operations", { keyPath: "id" });
    store.createIndex("by-updated", "updatedAt");
  },
});

export async function saveOperationDraft(draft: DraftRecord) {
  if (typeof indexedDB === "undefined") return;
  const db = await database;
  await db.put("operations", draft);
}

export async function removeOperationDraft(id: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await database;
  await db.delete("operations", id);
}
