export interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY?: string;
  APP_HMAC_SECRET?: string;
  APP_ORIGIN?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  ASSETS?: AssetBinding;
}
