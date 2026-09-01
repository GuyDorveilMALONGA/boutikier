import { z } from "zod";

export const currencyCodeSchema = z.literal("XOF");

export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9][0-9]{7,14}$/, "Numero de telephone E.164 invalide");

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("boutikier-server"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const uuidSchema = z.string().uuid();

const nullableText = z.string().nullable().optional();
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const isoDateSchema = z.iso.date();

export const operationTypeSchema = z.enum(["debt", "repayment"]);
export const sourceChannelSchema = z.enum([
  "app",
  "shop_qr",
  "whatsapp_assisted",
  "shared_link",
]);

export const recordOperationRequestSchema = z.object({
  shopClientId: uuidSchema,
  type: operationTypeSchema,
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).nullish(),
  amountXof: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  dueOn: z.iso.date().nullish(),
  occurredAt: z.iso.datetime({ offset: true }).nullish(),
  sourceChannel: sourceChannelSchema.default("app"),
  clientReference: z.string().trim().max(80).nullish(),
  idempotencyKey: uuidSchema,
  duplicateOverride: z.boolean().default(false),
});

export const recordOperationResponseSchema = z.object({
  entryId: uuidSchema.nullish(),
  recorded: z.boolean(),
  idempotentReplay: z.boolean().default(false),
  possibleDuplicateOf: uuidSchema.nullish(),
  reason: z.literal("probable_duplicate").optional(),
  entry: z.record(z.string(), z.unknown()).optional(),
  balance: z.record(z.string(), z.unknown()).optional(),
});

export const shopSummaryPeriodSchema = z.enum(["today", "7d", "month", "all"]);
export const shopSummarySchema = z.object({
  period: shopSummaryPeriodSchema,
  balanceTotalXof: z.number().int(),
  balanceDisputedXof: z.number().int(),
  balanceClearXof: z.number().int(),
  creditGrantedXof: z.number().int(),
  repaidXof: z.number().int(),
  activeClients: z.number().int().nonnegative(),
});

export const connectShopRequestSchema = z.object({
  code: z.string().min(32).max(256),
});

export const connectShopResponseSchema = z.object({
  shopClientId: uuidSchema,
  shopId: uuidSchema,
  shopName: z.string().min(1),
  connected: z.literal(true),
});
export const resolveShopRequestSchema = z.object({
  code: z.string().min(32).max(256),
});
export const resolveShopResponseSchema = z.object({
  shopId: uuidSchema,
  shopName: z.string().min(1),
});

export const shopQrResponseSchema = z.object({
  codeId: uuidSchema,
  code: z.string().min(32),
  path: z.string().startsWith("/q/s/"),
});

export type RecordOperationRequest = z.infer<typeof recordOperationRequestSchema>;
export type RecordOperationResponse = z.infer<typeof recordOperationResponseSchema>;
export type ShopSummary = z.infer<typeof shopSummarySchema>;
export type ConnectShopResponse = z.infer<typeof connectShopResponseSchema>;
export type ShopQrResponse = z.infer<typeof shopQrResponseSchema>;

export const actorRoleSchema = z.enum(["shop", "client"]);

export const shopIdentitySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  phoneE164: phoneE164Schema.nullable(),
  currencyCode: currencyCodeSchema,
});

export const clientIdentitySummarySchema = z.object({
  authUserId: uuidSchema,
  displayName: z.string().min(1),
  phoneE164: phoneE164Schema,
});

export const actorContextSchema = z.object({
  authUserId: uuidSchema,
  phoneE164: phoneE164Schema.nullable(),
  shop: shopIdentitySchema.nullable(),
  client: clientIdentitySummarySchema.nullable(),
  defaultAudience: actorRoleSchema.nullable(),
  needsOnboarding: z.boolean(),
});
export type ActorContext = z.infer<typeof actorContextSchema>;

export const onboardingShopRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export const onboardingClientRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});
export const createShopClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phoneRaw: z.string().trim().max(40).nullish(),
  phoneE164: phoneE164Schema.nullish(),
});
export const updateShopAccountRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const entryTypeSchema = z.enum(["debt", "repayment", "correction"]);
export const recordedByRoleSchema = actorRoleSchema;

export const ledgerEntrySchema = z.object({
  id: uuidSchema,
  type: entryTypeSchema,
  title: z.string().min(1),
  detail: nullableText,
  amountXof: z.number().int(),
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  dueOn: isoDateSchema.nullable().optional(),
  sourceChannel: sourceChannelSchema,
  clientReference: nullableText,
  possibleDuplicateOf: uuidSchema.nullable().optional(),
  recordedByRole: recordedByRoleSchema,
  disputeState: z.enum(["none", "opened", "withdrawn", "resolved"]).default("none"),
  disputeNote: nullableText,
  corrected: z.boolean().default(false),
  reversesEntryId: uuidSchema.nullable().optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const balanceSchema = z.object({
  balanceTotalXof: z.number().int(),
  balanceDisputedXof: z.number().int(),
  balanceClearXof: z.number().int(),
});
export type Balance = z.infer<typeof balanceSchema>;

export const shopClientSummarySchema = z.object({
  id: uuidSchema,
  shopId: uuidSchema,
  name: z.string().min(1),
  phoneE164: phoneE164Schema.nullable(),
  verified: z.boolean(),
  createdAt: isoDateTimeSchema,
  ...balanceSchema.shape,
});
export type ShopClientSummary = z.infer<typeof shopClientSummarySchema>;

export const relationshipTrustSchema = z.object({
  trustScore: z.number().int().min(0).max(100).nullable(),
  trustStatus: z.enum(["new", "reliable", "regular", "watch"]),
  eligibleDebtCount: z.number().int().nonnegative(),
  settledDebtCount: z.number().int().nonnegative(),
  onTimeSettledCount: z.number().int().nonnegative(),
  averageDaysToSettle: z.number().nullable(),
});
export type RelationshipTrust = z.infer<typeof relationshipTrustSchema>;

export const paginatedShopClientsSchema = z.object({
  items: z.array(shopClientSummarySchema),
  nextCursor: z.string().nullable(),
});

export const relationshipSchema = z.object({
  shopClient: shopClientSummarySchema,
  shop: shopIdentitySchema,
  client: z.object({
    name: z.string().min(1),
    phoneE164: phoneE164Schema.nullable(),
    verified: z.boolean(),
  }),
  balance: balanceSchema,
  entries: z.array(ledgerEntrySchema),
  trust: relationshipTrustSchema.nullable(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const shopActivityItemSchema = z.object({
  entry: ledgerEntrySchema,
  client: shopClientSummarySchema,
  trust: relationshipTrustSchema.nullable(),
});
export const shopActivitySchema = z.object({
  items: z.array(shopActivityItemSchema),
  nextCursor: z.string().nullable(),
});

export const clientHomeSchema = z.object({
  profile: clientIdentitySummarySchema,
  relationships: z.array(relationshipSchema),
});
export type ClientHome = z.infer<typeof clientHomeSchema>;

export const operationPreviewRequestSchema = recordOperationRequestSchema;
export const operationPreviewSchema = z.object({
  shopClientId: uuidSchema,
  currentBalance: balanceSchema,
  projectedBalance: balanceSchema,
  probableDuplicates: z.array(ledgerEntrySchema),
  recipientRole: actorRoleSchema,
  recipientPhoneE164: phoneE164Schema.nullable(),
});

export const correctionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: uuidSchema,
  replacementTitle: z.string().trim().min(1).max(200).optional(),
  replacementAmountXof: z.number().int().positive().optional(),
  replacementDetail: z.string().trim().max(2000).nullish(),
  replacementDueOn: isoDateSchema.nullish(),
});

export const disputeRequestSchema = z.object({
  eventType: z.enum(["opened", "withdrawn"]),
  note: z.string().trim().max(2000).nullish(),
  idempotencyKey: uuidSchema,
});

export const commandResponseSchema = z.object({
  id: uuidSchema,
  idempotentReplay: z.boolean().default(false),
});
export const correctionResponseSchema = z.object({
  correctionEntryId: uuidSchema,
  replacement: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const shareLinkResponseSchema = z.object({
  shareLinkId: uuidSchema,
  validUntil: isoDateTimeSchema,
  token: z.string().min(32),
  url: z.string().url(),
});
export const shareLinkRequestSchema = z.object({
  ttlDays: z.number().int().min(1).max(90).default(30),
});

export const publicStatementSchema = z.object({
  shop: z.object({ name: z.string().min(1), phoneE164: phoneE164Schema.nullable() }),
  client: z.object({ name: z.string().min(1) }),
  balance: balanceSchema,
  timeline: z.array(z.object({
    eventId: uuidSchema,
    source: z.enum(["ledger", "dispute"]),
    kind: z.string().min(1),
    amountXof: z.number().int().nullable(),
    targetEntryId: uuidSchema.nullable().optional(),
    title: z.string().nullable().optional(),
    detail: z.string().nullable().optional(),
    eventAt: isoDateTimeSchema,
  })),
  validUntil: isoDateTimeSchema,
});

export const activeShopQrSchema = z.object({
  codeId: uuidSchema,
  code: z.string().min(32),
  path: z.string().startsWith("/q/s/"),
  createdAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type ShopIdentity = z.infer<typeof shopIdentitySchema>;
export type ShopClient = z.infer<typeof shopClientSummarySchema>;
export type ActiveShopQr = z.infer<typeof activeShopQrSchema>;
export type PublicStatement = z.infer<typeof publicStatementSchema>;
