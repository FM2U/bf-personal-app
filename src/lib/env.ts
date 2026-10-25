/** Server-side settings read from environment variables. See .env.example for what each one means. */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ownerEmail: (process.env.OWNER_EMAIL ?? "").trim().toLowerCase(),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  aiMonthlyCapUsd: Number(process.env.AI_MONTHLY_CAP_USD || 25),
  aiInputPricePerMTok: Number(process.env.AI_INPUT_PRICE_PER_MTOK || 3),
  aiOutputPricePerMTok: Number(process.env.AI_OUTPUT_PRICE_PER_MTOK || 15),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  plaidClientId: process.env.PLAID_CLIENT_ID ?? "",
  plaidSecret: process.env.PLAID_SECRET ?? "",
  plaidEnv: (process.env.PLAID_ENV || "sandbox") as "sandbox" | "production",
  cronSecret: process.env.CRON_SECRET ?? "",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
};

export const isGoogleConfigured = () => !!(env.googleClientId && env.googleClientSecret && env.tokenEncryptionKey);
export const isPlaidConfigured = () => !!(env.plaidClientId && env.plaidSecret && env.tokenEncryptionKey);
export const isAIConfigured = () => !!env.anthropicKey;
