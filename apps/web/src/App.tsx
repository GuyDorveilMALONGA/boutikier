import {
  ArrowLeft, BadgeCheck, Banknote, BookOpen, Check, ChevronRight, CircleAlert,
  Copy, Eye, EyeOff, History, Home, LogOut, MessageCircle, PackagePlus, PencilLine,
  Plus, QrCode, ReceiptText, RotateCcw, Search, Send, Settings, ShieldCheck, Smartphone,
  Store, UserPlus, WifiOff, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { IScannerControls } from "@zxing/browser";
import {
  type ActorContext, type Balance, type ClientHome, type LedgerEntry,
  type Relationship, type ShopClientSummary,
} from "@boutikier/contracts";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "./lib/api";
import { removeOperationDraft, saveOperationDraft } from "./lib/drafts";
import { supabase, supabaseConfig, type AuthSession } from "./lib/supabase";
import { useAuth } from "./lib/use-auth";
import { useOnlineStatus, useRefreshOnResume, visibleLiveQuery } from "./lib/live-query";
import { ShopQrCard } from "./components/ShopQrCard";

const money = new Intl.NumberFormat("fr-FR");
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

function formatMoney(value: number) {
  return `${money.format(Math.round(value))} FCFA`;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function signedAmount(entry: LedgerEntry) {
  return entry.type === "debt" ? entry.amountXof : -entry.amountXof;
}

function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
  return date.toLocaleDateString("fr-SN", { day: "numeric", month: "short" });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("fr-SN", { hour: "2-digit", minute: "2-digit" });
}

function trustLabel(status: "new" | "reliable" | "regular" | "watch") {
  return status === "reliable" ? "Fiable" : status === "regular" ? "Régulier" : status === "watch" ? "À surveiller" : "Nouveau";
}

function phoneE164(value: string) {
  const raw = value.trim();
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("221") && digits.length === 12) return `+${digits}`;
  if (digits.length === 9) return `+221${digits}`;
  return undefined;
}

function safeReturnTo(value: string | null, fallback = "/") {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function errorText(error: unknown) {
  if (error instanceof ApiError && error.code === "authentication_required") return "Votre session a expiré. Reconnectez-vous.";
  if (error instanceof ApiError && error.status === 409) return "Cette opération ressemble à une saisie déjà enregistrée.";
  if (error instanceof Error) return error.message;
  return "Une erreur est survenue. Réessayez.";
}

function Loading({ label = "Chargement…" }: { label?: string }) {
  return <div className="app-state"><span className="loading-dot" /><p>{label}</p></div>;
}

function ConfigRequired() {
  return <div className="app-state"><ShieldCheck size={28} /><h1>Connexion à Supabase requise</h1><p>Configurez la clé publique Supabase pour ouvrir Boutikier.</p></div>;
}

function BrandLogo() {
  return <img className="brand-logo" src="/assets/brand-mark.png" alt="" aria-hidden="true" />;
}

type SignupAudience = "shop" | "client";
type PendingSignup = { audience: SignupAudience; name: string };
const pendingSignupKey = "boutikier:pending-signup";
const localDemoPhones = new Set(["+221777629953", "+221703549365"]);

function demoPinEnabled() {
  return import.meta.env.DEV || import.meta.env.VITE_DEMO_PIN_ENABLED === "true";
}

function usesLocalDemoPin(phone: string) {
  return demoPinEnabled() && localDemoPhones.has(phone);
}

function readPendingSignup(): PendingSignup | null {
  try {
    const value = sessionStorage.getItem(pendingSignupKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PendingSignup>;
    if ((parsed.audience === "shop" || parsed.audience === "client") && typeof parsed.name === "string" && parsed.name.trim()) {
      return { audience: parsed.audience, name: parsed.name.trim() };
    }
  } catch {
    sessionStorage.removeItem(pendingSignupKey);
  }
  return null;
}

function savePendingSignup(value: PendingSignup | null) {
  if (value) sessionStorage.setItem(pendingSignupKey, JSON.stringify(value));
  else sessionStorage.removeItem(pendingSignupKey);
}

function AuthFrame({ children, footnote = "Un carnet partagé, des comptes séparés." }: { children: ReactNode; footnote?: string }) {
  return <div className="auth-page">
    <section className="auth-brand-panel" aria-label="Boutikier, le carnet de crédit partagé">
      <div className="auth-brand"><span className="brand-mark"><BrandLogo /></span><strong>Boutikier</strong></div>
      <div className="auth-brand-copy"><p>Le carnet partagé</p><h1>Le crédit du quartier, enfin clair.</h1></div>
      <small>{footnote}</small>
    </section>
    <main className="auth-form-panel"><div className="auth-form-content">{children}</div></main>
  </div>;
}

function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [audience, setAudience] = useState<SignupAudience>("client");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnTo(new URLSearchParams(location.search).get("returnTo"));
  const isQrReturn = returnTo.startsWith("/q/s/");
  const productionDemo = import.meta.env.VITE_DEMO_PIN_ENABLED === "true";
  const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

  async function sendOtp(event?: FormEvent, requestedChannel = channel) {
    event?.preventDefault();
    setError(null);
    if (!isQrReturn && mode === "signup" && name.trim().length < 2) {
      setError(audience === "shop" ? "Entrez le nom de votre boutique." : "Entrez votre nom complet.");
      return;
    }
    const normalized = phoneE164(phone);
    if (!normalized || !supabase) {
      setError("Entrez un numéro valide, par exemple 77 000 00 00.");
      return;
    }
    if (import.meta.env.VITE_DEMO_PIN_ENABLED === "true" && !localDemoPhones.has(normalized)) {
      setError("Ce test est réservé aux deux numéros de démonstration autorisés.");
      return;
    }
    setPending(true);
    const effectiveChannel = productionDemo ? "sms" : requestedChannel;
    const result = await supabase.auth.signInWithOtp({
      phone: normalized,
      options: { channel: effectiveChannel, shouldCreateUser: true },
    });
    setPending(false);
    if (result.error) {
      setError(effectiveChannel === "whatsapp" ? "WhatsApp n'est pas disponible pour ce numéro. Essayez par SMS." : result.error.message);
      return;
    }
    setChannel(effectiveChannel);
    setPhone(normalized);
    savePendingSignup(!isQrReturn && mode === "signup" ? { audience, name: name.trim() } : null);
    setSent(true);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!supabase) return;
    setPending(true);
    const demoPin = usesLocalDemoPin(phone);
    const token = demoPin && code.trim() === "1234" ? "123456" : code.trim();
    const result = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (result.error) {
      setPending(false);
      setError("Le code est invalide ou expiré.");
      return;
    }
    try {
      const current = await api.me();
      let next = current;
      const signup = !isQrReturn && mode === "signup" ? readPendingSignup() : null;
      if (signup && current.needsOnboarding) {
        next = signup.audience === "shop" ? await api.onboardShop(signup.name) : await api.onboardClient(signup.name);
      }
      savePendingSignup(null);
      if (result.data.user) queryClient.setQueryData(["me", result.data.user.id], next);
      if (next.shop) {
        await queryClient.invalidateQueries({ queryKey: ["shop-qr"] });
        await queryClient.prefetchQuery({ queryKey: ["shop-qr"], queryFn: api.shopQr });
      }
      if (isQrReturn && next.needsOnboarding) return;
      const destination = returnTo !== "/" ? returnTo : next.client && !next.shop ? "/client" : "/";
      navigate(destination, { replace: true });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPending(false);
    }
  }

  async function continueWithGoogle() {
    setError(null);
    if (!supabase) return;
    if (mode === "signup" && name.trim().length < 2) {
      setError(audience === "shop" ? "Entrez le nom de votre boutique." : "Entrez votre nom complet.");
      return;
    }
    savePendingSignup(mode === "signup" ? { audience, name: name.trim() } : null);
    const redirectTo = `${window.location.origin}${returnTo}`;
    const result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (result.error) setError("La connexion Google n'est pas disponible pour le moment.");
  }

  function changeMode(next: "signup" | "login") {
    setMode(next); setSent(false); setCode(""); setError(null); savePendingSignup(null);
  }

  const otpLength = usesLocalDemoPin(phone) ? 4 : 6;

  return <AuthFrame footnote={isQrReturn ? "Aucune application à installer." : "Aucun mot de passe à retenir."}>
      <p className="panel-heading-kicker">{sent ? "Vérification" : isQrReturn ? "QR boutique" : mode === "signup" ? "Nouveau sur Boutikier" : "Bon retour"}</p>
      <h1>{sent ? "Vérifiez votre numéro" : isQrReturn ? "Continuer avec votre téléphone" : mode === "signup" ? "Créer votre compte" : "Ouvrir votre espace"}</h1>
      <p>{sent ? productionDemo ? `Saisissez le PIN de test pour ${phone}. Aucun message n'est envoyé.` : `Saisissez le code envoyé au ${phone}.` : isQrReturn ? "Votre numéro vérifié crée ou retrouve votre compte client léger, puis vous ramène à la boutique scannée." : mode === "signup" ? "Choisissez votre espace, indiquez votre nom, puis vérifiez votre téléphone." : "Retrouvez votre espace avec votre numéro vérifié."}</p>
      {error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}</div>}
      {!sent ? <form onSubmit={sendOtp}>
        {!isQrReturn && mode === "signup" && <>
          <fieldset className="signup-audience"><legend>Je crée un espace</legend>
            <button className={audience === "client" ? "active" : ""} type="button" onClick={() => setAudience("client")}><UserPlus size={18} /><span>Client</span></button>
            <button className={audience === "shop" ? "active" : ""} type="button" onClick={() => setAudience("shop")}><Store size={18} /><span>Boutiquier</span></button>
          </fieldset>
          <Field label={audience === "shop" ? "Nom de la boutique" : "Votre nom complet"} value={name} onChange={setName} placeholder={audience === "shop" ? "Ex. Boutique Diallo" : "Ex. Mamadou Diop"} autoFocus />
        </>}
        <Field label="Numéro de téléphone" value={phone} onChange={setPhone} placeholder="77 000 00 00" inputMode="tel" autoFocus={mode === "login"} />
        <button className="primary-action submit auth-primary" type="submit" disabled={pending}><MessageCircle size={18} /> {pending ? "Préparation…" : productionDemo ? mode === "signup" && !isQrReturn ? "Créer mon espace de test" : "Continuer avec mon PIN" : isQrReturn ? "Continuer avec WhatsApp" : mode === "signup" ? "Créer avec WhatsApp" : "Continuer avec WhatsApp"} <ChevronRight size={18} /></button>
        {!productionDemo && <button className="text-action auth-fallback" type="button" onClick={() => { void sendOtp(undefined, "sms"); }}>Recevoir plutôt le code par SMS</button>}
        {googleEnabled && !isQrReturn && <><div className="auth-divider"><span>ou</span></div><button className="google-auth" type="button" onClick={() => { void continueWithGoogle(); }}><span className="google-mark">G</span> Continuer avec Google</button></>}
        <small className="auth-legal">En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité.</small>
        {!isQrReturn && <div className="auth-mode-switch"><span>{mode === "signup" ? "Vous avez déjà un compte ?" : "Pas encore de compte ?"}</span><button type="button" onClick={() => changeMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Se connecter" : "Créer un compte"}</button></div>}
      </form> : <form onSubmit={verify}>
        {!isQrReturn && mode === "signup" && <div className="signup-summary"><span>{audience === "shop" ? <Store size={18} /> : <UserPlus size={18} />}</span><div><strong>{name}</strong><small>Espace {audience === "shop" ? "boutique" : "client"}</small></div></div>}
        <label className="field otp-field"><span>Code à {otpLength} chiffres</span><input className="otp-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, otpLength))} placeholder={"*".repeat(otpLength)} inputMode="numeric" autoComplete="one-time-code" autoFocus /></label>
        <button className="primary-action submit auth-primary" type="submit" disabled={pending || code.trim().length !== otpLength}>{pending ? "Vérification…" : "Vérifier et continuer"} <ChevronRight size={18} /></button>
        <button className="text-action auth-fallback" type="button" onClick={() => { void sendOtp(undefined, channel); }}>Renvoyer le code</button>
        <button className="text-action auth-fallback" type="button" onClick={() => { setSent(false); setCode(""); }}>Changer de numéro</button>
      </form>}
  </AuthFrame>;
}

function PhoneClaimPage() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    const normalized = phoneE164(phone);
    if (!normalized || !supabase) { setError("Entrez un numéro valide."); return; }
    setPending(true); setError(null);
    const result = await supabase.auth.updateUser({ phone: normalized });
    setPending(false);
    if (result.error) { setError("Impossible d'envoyer le code à ce numéro."); return; }
    setPhone(normalized); setSent(true);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true); setError(null);
    const result = await supabase.auth.verifyOtp({ phone, token: code, type: "phone_change" });
    setPending(false);
    if (result.error) { setError("Le code est invalide ou expiré."); return; }
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return <AuthFrame footnote="Une seule vérification est nécessaire."><p className="panel-heading-kicker">Après Google</p><h1>{sent ? "Vérifiez votre numéro" : "Ajoutez votre téléphone"}</h1><p>{sent ? `Code envoyé au ${phone}.` : "Le téléphone relie votre identité à vos carnets sans créer de doublon."}</p>{error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}</div>}{sent ? <form onSubmit={verify}><label className="field otp-field"><span>Code à 6 chiffres</span><input className="otp-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="******" inputMode="numeric" autoComplete="one-time-code" autoFocus /></label><button className="primary-action submit auth-primary" disabled={pending || code.length !== 6}>Vérifier mon numéro</button><button className="text-action auth-fallback" type="button" onClick={() => { setSent(false); setCode(""); }}>Changer de numéro</button></form> : <form onSubmit={send}><Field label="Numéro de téléphone" value={phone} onChange={setPhone} placeholder="77 000 00 00" inputMode="tel" autoFocus /><button className="primary-action submit auth-primary" disabled={pending}>{pending ? "Envoi…" : "Recevoir le code"}</button></form>}</AuthFrame>;
}

function OnboardingPage({ context }: { context: ActorContext }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = safeReturnTo(new URLSearchParams(location.search).get("returnTo"), "/client");
  const isQrOnboarding = returnTo.startsWith("/q/s/");
  const pendingSignup = readPendingSignup();
  const [audience, setAudience] = useState<SignupAudience | null>(isQrOnboarding ? "client" : pendingSignup?.audience ?? null);
  const [name, setName] = useState(pendingSignup?.name ?? "");
  const mutation = useMutation({
    mutationFn: () => audience === "shop" ? api.onboardShop(name) : api.onboardClient(name),
    onSuccess: async (next) => {
      savePendingSignup(null);
      queryClient.setQueryData(["me"], next);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      if (next.shop) {
        await queryClient.invalidateQueries({ queryKey: ["shop-qr"] });
        await queryClient.prefetchQuery({ queryKey: ["shop-qr"], queryFn: api.shopQr });
      }
      navigate(isQrOnboarding && next.client ? returnTo : next.shop ? "/" : "/client", { replace: true });
    },
  });
  void context;
  return <AuthFrame footnote={isQrOnboarding ? "Votre téléphone est déjà vérifié." : "Les espaces boutique et client restent séparés."}>
      <p className="panel-heading-kicker">Première connexion</p>
      <h1>{isQrOnboarding ? "Comment vous appelez-vous ?" : "Quel espace voulez-vous créer ?"}</h1>
      <p>{isQrOnboarding ? "Ce nom sera présenté au boutiquier avec les opérations que vous enregistrez." : "Votre numéro est vérifié. Chaque espace reste séparé et adapté à son usage."}</p>
      {!audience ? <div className="audience-choices">
        <button onClick={() => setAudience("shop")}><Store size={22} /><span><strong>Créer mon espace boutique</strong><small>Tenir le carnet de mes clients</small></span><ChevronRight size={18} /></button>
        <button onClick={() => setAudience("client")}><BookOpen size={22} /><span><strong>Créer mon espace client</strong><small>Retrouver mes boutiques et mes relevés</small></span><ChevronRight size={18} /></button>
      </div> : <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
        <Field label={audience === "shop" ? "Nom de la boutique" : "Votre nom"} value={name} onChange={setName} placeholder={audience === "shop" ? "Ex. Boutique Diallo" : "Ex. Mamadou Diop"} autoFocus />
        {mutation.error && <div className="inline-error" role="alert"><CircleAlert size={17} />{errorText(mutation.error)}</div>}
        <button className="primary-action submit" type="submit" disabled={!name.trim() || mutation.isPending}>{mutation.isPending ? "Enregistrement…" : "Continuer"}<ChevronRight size={18} /></button>
        {!isQrOnboarding && <button className="text-action auth-fallback" type="button" onClick={() => setAudience(null)}>Retour</button>}
      </form>}
  </AuthFrame>;
}

function AppRoutes() {
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  const location = useLocation();
  const isClientPath = location.pathname === "/client" || location.pathname.startsWith("/client/");
  const authReturnTo = location.pathname === "/connexion" ? safeReturnTo(new URLSearchParams(location.search).get("returnTo")) : "/";
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      queryClient.clear();
    }
    previousUserId.current = userId;
  }, [queryClient, userId]);
  const contextQuery = useQuery({ queryKey: ["me", userId], queryFn: api.me, enabled: Boolean(session) && !location.pathname.startsWith("/s/") && !location.pathname.startsWith("/q/s/") });

  if (location.pathname.startsWith("/s/")) return <PublicStatement />;
  if (!supabaseConfig.configured) return <ConfigRequired />;
  if (location.pathname.startsWith("/q/s/")) return loading ? <Loading label="Ouverture du QR…" /> : <QrLanding session={session} />;
  if (loading) return <Loading label="Ouverture de votre espace…" />;
  if (!session) return <AuthPage />;
  if (contextQuery.isLoading) return <Loading />;
  if (contextQuery.error) return <ErrorState error={contextQuery.error} />;
  if (!contextQuery.data?.phoneE164) return <PhoneClaimPage />;
  if (contextQuery.data?.needsOnboarding) return <OnboardingPage context={contextQuery.data} />;
  if (authReturnTo !== "/") return <NavigateTo to={authReturnTo} />;
  if (isClientPath) {
    if (!contextQuery.data?.client) return <AccessDenied label="Cet espace est réservé à un client vérifié." />;
    return <ClientApp context={contextQuery.data} />;
  }
  if (!contextQuery.data?.shop) {
    if (contextQuery.data?.client) return <NavigateTo to="/client" />;
    return <OnboardingPage context={contextQuery.data!} />;
  }
  return <ShopApp context={contextQuery.data} />;
}

function NavigateTo({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => { void navigate(to, { replace: true }); }, [navigate, to]);
  return <Loading />;
}

function ErrorState({ error }: { error: unknown }) {
  const queryClient = useQueryClient();
  return <div className="app-state"><CircleAlert size={28} /><h1>Impossible de charger cet espace</h1><p>{errorText(error)}</p><button className="secondary-action" onClick={() => { void queryClient.refetchQueries({ type: "active" }); }}>Réessayer</button></div>;
}

function AccessDenied({ label }: { label: string }) {
  return <div className="app-state"><ShieldCheck size={28} /><h1>Accès non disponible</h1><p>{label}</p><Link className="secondary-action" to="/">Retour</Link></div>;
}

function ShopApp({ context }: { context: ActorContext }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const creatingClient = pathParts[0] === "clients" && pathParts[1] === "nouveau";
  const selectedId = pathParts[0] === "clients" && pathParts[1] !== "nouveau" ? pathParts[1] : null;
  const subScreen = selectedId ? pathParts[2] || "ledger" : null;
  const targetEntryId = subScreen === "correction" ? pathParts[3] : null;
  const tab = location.pathname.startsWith("/activite") ? "activity" : location.pathname.startsWith("/compte") ? "account" : "carnet";
  const clientsQuery = useQuery({ queryKey: ["shop-clients", query], queryFn: () => api.shopClients(query), ...visibleLiveQuery });
  const summaryQuery = useQuery({ queryKey: ["shop-summary", "all"], queryFn: () => api.shopSummary("all"), ...visibleLiveQuery });
  const relationQuery = useQuery({ queryKey: ["shop-relationship", selectedId], queryFn: () => api.shopRelationship(selectedId!), enabled: Boolean(selectedId), ...visibleLiveQuery });
  const refreshKeys = useMemo(() => [["shop-clients"], ["shop-summary"], ["shop-activity"], ["shop-qr"]], []);
  useRefreshOnResume(refreshKeys);
  const online = useOnlineStatus();

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }
  function invalidate() {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shop-clients"] }),
      queryClient.invalidateQueries({ queryKey: ["shop-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["shop-activity"] }),
      queryClient.invalidateQueries({ queryKey: ["shop-relationship", selectedId] }),
    ]);
  }
  const nested = Boolean(selectedId || creatingClient);
  const client = clientsQuery.data?.items.find((item) => item.id === selectedId) ?? relationQuery.data?.shopClient;

  return <div className={`app-shell shop-shell ${nested ? "shop-focus-mode" : ""}`}>
    <header className={`app-header ${nested ? "is-nested" : ""}`}>
      {nested ? <><button className="shop-header-back" onClick={() => navigate("/")} aria-label="Retour"><ArrowLeft size={23} /></button><strong className="nested-header-title">{creatingClient ? "Nouvelle fiche" : client?.name || "Client"}</strong><span className="header-balance" /></> : <div className="brand-lockup"><span className="brand-mark"><BrandLogo /></span><div><strong>{context.shop?.name}</strong><span>Espace boutique</span></div></div>}
      {!nested && <strong className="shop-mobile-title">{tab === "activity" ? "Activité" : tab === "account" ? "Compte" : "Carnet"}</strong>}
      <nav className="shop-desktop-nav" aria-label="Navigation boutique">
        <ShopNavButton active={tab === "carnet"} icon={<BookOpen size={17} />} label="Carnet" onClick={() => navigate("/")} />
        <ShopNavButton active={tab === "activity"} icon={<History size={17} />} label="Activité" onClick={() => navigate("/activite")} />
        <ShopNavButton active={tab === "account"} icon={<Store size={17} />} label="Compte" onClick={() => navigate("/compte")} />
      </nav>
    </header>

    {!online && <div className="offline-banner" role="status"><WifiOff size={15} /> Hors ligne · les données se resynchroniseront automatiquement</div>}
    {tab === "activity" ? <ShopActivity /> : tab === "account" ? <ShopAccount context={context} notify={notify} /> : <div className={`workspace ${nested ? "has-selection" : ""}`}>
      <aside className="client-panel" aria-label="Clients">
        <div className="carnet-intro"><p>Votre carnet</p><h1>{context.shop?.name}</h1></div>
        <section className="carnet-balance-card" aria-label="Montant global à recevoir"><span>À recevoir</span><strong>{summaryQuery.data ? formatMoney(Math.max(summaryQuery.data.balanceTotalXof, 0)) : "…"}</strong><small>{summaryQuery.data?.activeClients ?? 0} client{(summaryQuery.data?.activeClients ?? 0) > 1 ? "s" : ""} actif{(summaryQuery.data?.activeClients ?? 0) > 1 ? "s" : ""}{summaryQuery.data?.balanceDisputedXof ? ` · ${formatMoney(summaryQuery.data.balanceDisputedXof)} contestés` : ""}</small></section>
        <ShopQrCard shopName={context.shop?.name ?? "Votre boutique"} />
        <div className="panel-heading carnet-list-heading"><div><p>Journal</p><h2>Clients qui doivent</h2></div><button className="icon-command" aria-label="Nouveau client" onClick={() => navigate("/clients/nouveau")}><UserPlus size={19} /></button></div>
        <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un client" />{query && <button aria-label="Effacer la recherche" onClick={() => setQuery("")}><X size={15} /></button>}</label>
        {clientsQuery.isLoading ? <Loading label="Chargement des clients…" /> : clientsQuery.error ? <ErrorState error={clientsQuery.error} /> : <div className="client-list">{clientsQuery.data?.items.map((item) => <ClientRow key={item.id} client={item} selected={item.id === selectedId} onSelect={() => navigate(`/clients/${item.id}`)} />)}{clientsQuery.data?.items.length === 0 && <div className="list-empty">Aucun client ne correspond.</div>}</div>}
        <button className="primary-action new-client-wide" onClick={() => navigate("/clients/nouveau")}><Plus size={18} /> Nouveau client</button>
      </aside>
      <main className="detail-panel">
        {creatingClient ? <NewClientForm onCancel={() => navigate("/")} onCreated={(created) => { invalidate(); navigate(`/clients/${created.id}`); notify("Fiche client créée"); }} /> : selectedId && relationQuery.isLoading ? <Loading /> : selectedId && relationQuery.error ? <ErrorState error={relationQuery.error} /> : relationQuery.data ? <ShopRelationship relation={relationQuery.data} screen={subScreen!} targetEntryId={targetEntryId} onNavigate={(to) => navigate(`/clients/${selectedId}${to ? `/${to}` : ""}`)} onDone={(message) => { invalidate(); notify(message); navigate(`/clients/${selectedId}`); }} /> : <Welcome hasClients={(clientsQuery.data?.items.length ?? 0) > 0} />}
      </main>
    </div>}
    {!nested && <nav className="shop-bottom-nav" aria-label="Navigation boutique mobile"><ShopNavButton active={tab === "carnet"} icon={<BookOpen size={19} />} label="Carnet" onClick={() => navigate("/")} /><ShopNavButton active={tab === "activity"} icon={<History size={19} />} label="Activité" onClick={() => navigate("/activite")} /><ShopNavButton active={tab === "account"} icon={<Store size={19} />} label="Compte" onClick={() => navigate("/compte")} /></nav>}
    {toast && <div className="toast" role="status"><Check size={17} /> {toast}</div>}
  </div>;
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return <div><span>{label}</span><strong className={tone === "green" ? "metric-green" : ""}>{value}</strong></div>;
}

function ShopNavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ShopRelationship({ relation, screen, targetEntryId, onNavigate, onDone }: { relation: Relationship; screen: string; targetEntryId: string | null; onNavigate: (to: string) => void; onDone: (message: string) => void }) {
  if (screen === "debt" || screen === "repayment") return <OperationForm relation={relation} mode={screen} onCancel={() => onNavigate("")} onDone={onDone} />;
  if (screen === "correction" && targetEntryId) return <CorrectionForm relation={relation} entryId={targetEntryId} onCancel={() => onNavigate("")} onDone={onDone} />;
  if (screen === "share") return <ShareForm relation={relation} onBack={() => onNavigate("")} onDone={onDone} />;
  return <Ledger relation={relation} audience="shop" onDebt={() => onNavigate("debt")} onRepayment={() => onNavigate("repayment")} onShare={() => onNavigate("share")} onEntryAction={(entry) => onNavigate(`correction/${entry.id}`)} />;
}

function ShopActivity() {
  const [period, setPeriod] = useState<"today" | "7d" | "month" | "all">("today");
  const query = useQuery({ queryKey: ["shop-activity"], queryFn: api.shopActivity, ...visibleLiveQuery });
  const summary = useQuery({ queryKey: ["shop-summary", period], queryFn: () => api.shopSummary(period), ...visibleLiveQuery });
  const navigate = useNavigate();
  return <main className="shop-root-page shop-activity-page">
    <div className="shop-page-heading"><p>Pilotage</p><h1>Activité</h1><span>Votre petite comptabilité et toutes les écritures confirmées.</span></div>
    <div className="summary-period activity-period" role="group" aria-label="Période du résumé">{([['today', "Aujourd'hui"], ['7d', "7 jours"], ['month', "Mois"], ['all', "Tout"]] as const).map(([value, label]) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{label}</button>)}</div>
    <section className="activity-summary" aria-label="Petite comptabilité">
      <SummaryMetric label="À recevoir" value={summary.data ? formatMoney(Math.max(summary.data.balanceTotalXof, 0)) : "…"} />
      <SummaryMetric label="Remboursé" value={summary.data ? formatMoney(summary.data.repaidXof) : "…"} tone="green" />
      <SummaryMetric label="Crédit accordé" value={summary.data ? formatMoney(summary.data.creditGrantedXof) : "…"} />
      <SummaryMetric label="Contesté" value={summary.data ? formatMoney(summary.data.balanceDisputedXof) : "…"} />
    </section>
    {query.isLoading ? <Loading /> : query.error ? <ErrorState error={query.error} /> : <section className="shop-activity-list" aria-label="Opérations récentes"><div className="section-heading"><div><p>Journal global</p><h3>Opérations récentes</h3></div><span>{query.data?.items.length ?? 0}</span></div>{query.data?.items.map(({ entry, client, trust }) => <button className="shop-activity-row" key={`${client.id}-${entry.id}`} onClick={() => navigate(`/clients/${client.id}`)}><span className={`entry-icon ${signedAmount(entry) > 0 ? "debt" : "credit"}`}>{entry.type === "repayment" ? <Banknote size={17} /> : <PackagePlus size={17} />}</span><span><strong>{entry.title}</strong><small>{client.name} · {entry.recordedByRole === "client" ? entry.sourceChannel === "shop_qr" ? "Client via QR" : "Enregistré par le client" : "Enregistré par vous"} · {dateLabel(entry.recordedAt)}, {timeLabel(entry.recordedAt)}</small><em className={`trust-pill ${trust?.trustStatus ?? "new"}`}>{trust?.trustScore === null || !trust ? "Nouveau" : `${trustLabel(trust.trustStatus)} · ${trust.trustScore}/100`}</em></span><b className={signedAmount(entry) > 0 ? "debt" : "credit"}>{signedAmount(entry) > 0 ? "+" : "−"}{money.format(Math.abs(signedAmount(entry)))}</b><ChevronRight size={17} /></button>)}</section>}
  </main>;
}

function ShopAccount({ context, notify }: { context: ActorContext; notify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const rotate = useMutation({ mutationFn: api.rotateShopQr, onSuccess: (next) => { queryClient.setQueryData(["shop-qr"], next); notify("QR de la boutique renouvelé"); } });
  const update = useMutation({ mutationFn: api.updateShopAccount, onSuccess: async (next) => { queryClient.setQueriesData({ queryKey: ["me"] }, next); await queryClient.invalidateQueries({ queryKey: ["me"] }); } });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(context.shop?.name ?? "");
  return <main className="shop-root-page shop-account-page"><div className="shop-page-heading"><p>Paramètres</p><h1>Compte</h1><span>Votre identité, la sécurité de l'espace et la gestion du QR permanent.</span></div><section className="shop-account-identity"><span><Store size={24} /></span><div><strong>{context.shop?.name}</strong><p>{context.shop?.phoneE164 || "Téléphone non renseigné"}</p><small><BadgeCheck size={14} /> Numéro vérifié par Supabase Auth</small></div></section><section className="account-setting-list" aria-label="Paramètres du compte">{editing ? <form onSubmit={(event) => { event.preventDefault(); update.mutate(name, { onSuccess: () => { setEditing(false); notify("Informations mises à jour"); } }); }}><Field label="Nom de la boutique" value={name} onChange={setName} autoFocus /><button className="primary-action" type="submit" disabled={!name.trim() || update.isPending}>Enregistrer</button></form> : <button onClick={() => setEditing(true)}><span><strong>Informations de la boutique</strong><small>{context.shop?.name}</small></span><ChevronRight size={18} /></button>}<button onClick={() => { if (window.confirm("L'ancien QR cessera immédiatement de fonctionner. Renouveler le QR ?")) rotate.mutate(); }} disabled={rotate.isPending}><span><strong>Renouveler le QR permanent</strong><small>Uniquement si l'ancien code doit être révoqué</small></span><RotateCcw size={18} /></button><button onClick={async () => { await supabase?.auth.signOut(); }}><span><strong>Se déconnecter</strong><small>Fermer la session sur cet appareil</small></span><LogOut size={18} /></button></section></main>;
}

function ClientApp({ context }: { context: ActorContext }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const homeQuery = useQuery({ queryKey: ["client-home"], queryFn: api.clientHome, ...visibleLiveQuery });
  const params = new URLSearchParams(location.search);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const routeRelationshipId = pathParts[1] === "boutiques" ? pathParts[2] : null;
  const relationshipId = routeRelationshipId || params.get("shopClientId");
  const operationSource: "app" | "shop_qr" = params.get("source") === "shop_qr" ? "shop_qr" : "app";
  const operationMode: "debt" | "repayment" = location.pathname === "/client/rembourser" ? "repayment" : "debt";
  const [amountsVisible, setAmountsVisible] = useState(() => localStorage.getItem("boutikier:amounts") !== "hidden");
  const [toast, setToast] = useState<string | null>(null);
  const relationQuery = useQuery({ queryKey: ["client-relationship", relationshipId], queryFn: () => api.clientRelationship(relationshipId!), enabled: Boolean(relationshipId), ...visibleLiveQuery });
  const refreshKeys = useMemo(() => [["client-home"], ["client-relationship"]], []);
  useRefreshOnResume(refreshKeys);
  const online = useOnlineStatus();
  useEffect(() => { localStorage.setItem("boutikier:amounts", amountsVisible ? "visible" : "hidden"); }, [amountsVisible]);
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(null), 2600); }
  function invalidate() { void Promise.all([queryClient.invalidateQueries({ queryKey: ["client-home"] }), queryClient.invalidateQueries({ queryKey: ["client-relationship", relationshipId] })]); }
  function backToHome() {
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (historyIndex > 0) navigate(-1);
    else navigate("/client", { replace: true });
  }
  const home = homeQuery.data;
  const activeRelation = relationQuery.data || home?.relationships.find((item) => item.shopClient.id === relationshipId) || (home?.relationships.length === 1 ? home.relationships[0] : undefined);
  const totalBalance = home?.relationships.reduce((sum, item) => sum + item.balance.balanceTotalXof, 0) ?? 0;
  const relationships = home?.relationships ?? [];
  const isOperation = location.pathname === "/client/acheter" || location.pathname === "/client/rembourser";
  const isStatements = location.pathname === "/client/releves" || Boolean(routeRelationshipId);
  const disputeEntryId = pathParts[3] === "contester" ? pathParts[4] : null;
  const disputeEntry = disputeEntryId ? activeRelation?.entries.find((entry) => entry.id === disputeEntryId) : undefined;
  const selectForOperation = (id: string) => navigate(`${location.pathname}?shopClientId=${encodeURIComponent(id)}${operationSource === "shop_qr" ? "&source=shop_qr" : ""}`, { replace: true });
  return <div className="client-account-app">
    {!online && <div className="offline-banner" role="status"><WifiOff size={15} /> Hors ligne · resynchronisation automatique au retour du réseau</div>}
    <main className="client-account-content">{homeQuery.isLoading ? <Loading /> : homeQuery.error ? <ErrorState error={homeQuery.error} /> : location.pathname === "/client" ? <ClientHome relationships={relationships} totalBalance={totalBalance} amountsVisible={amountsVisible} onToggleAmounts={() => setAmountsVisible((value) => !value)} onSettings={() => navigate("/client/parametres")} onScan={() => navigate("/client/scanner")} onOpenLedger={(id) => navigate(`/client/boutiques/${id}`)} onViewAll={() => navigate("/client/releves")} onDebt={() => navigate(`/client/acheter${relationships.length === 1 ? `?shopClientId=${relationships[0].shopClient.id}` : ""}`)} onRepayment={() => navigate(`/client/rembourser${relationships.length === 1 ? `?shopClientId=${relationships[0].shopClient.id}` : ""}`)} /> : location.pathname === "/client/parametres" ? <ClientProfile context={context} amountsVisible={amountsVisible} onToggleAmounts={() => setAmountsVisible((value) => !value)} onBack={backToHome} /> : disputeEntry && activeRelation ? <DisputeForm relation={activeRelation} entry={disputeEntry} onCancel={backToHome} onDone={(message) => { invalidate(); notify(message); navigate(`/client/boutiques/${activeRelation.shopClient.id}`, { replace: true }); }} /> : isStatements ? <ClientLedger relationships={relationships} active={activeRelation || relationships[0]} amountsVisible={amountsVisible} onToggleAmounts={() => setAmountsVisible((value) => !value)} onBack={backToHome} onSelect={(id) => navigate(`/client/boutiques/${id}`)} onDispute={(entry) => activeRelation && navigate(`/client/boutiques/${activeRelation.shopClient.id}/contester/${entry.id}`)} /> : isOperation ? activeRelation ? <OperationForm relation={activeRelation} mode={operationMode} clientMode sourceChannel={operationSource} onCancel={backToHome} onDone={(message) => { invalidate(); notify(message); navigate("/client", { replace: operationSource === "shop_qr" }); }} /> : relationships.length > 1 ? <RelationshipPicker mode={operationMode} relationships={relationships} onBack={backToHome} onSelect={selectForOperation} /> : <NoRelationship onScan={() => navigate("/client/scanner")} onBack={backToHome} /> : <NavigateTo to="/client" />}</main>
    {toast && <div className="toast" role="status"><Check size={17} /> {toast}</div>}
  </div>;
}

function ClientHome({ relationships, totalBalance, amountsVisible, onToggleAmounts, onSettings, onScan, onOpenLedger, onViewAll, onDebt, onRepayment }: { relationships: Relationship[]; totalBalance: number; amountsVisible: boolean; onToggleAmounts: () => void; onSettings: () => void; onScan: () => void; onOpenLedger: (id: string) => void; onViewAll: () => void; onDebt: () => void; onRepayment: () => void }) {
  const recent = relationships.flatMap((relation) => relation.entries.map((entry) => ({ relation, entry }))).sort((left, right) => new Date(right.entry.recordedAt).getTime() - new Date(left.entry.recordedAt).getTime()).slice(0, 3);
  return <div className="client-dashboard client-home-page"><h1 className="sr-only">Votre situation</h1><div className="client-home-top"><button onClick={onSettings} aria-label="Paramètres"><Settings size={22} /></button></div><section className="client-summary single"><div className="client-debt-total"><span>Dette totale</span><strong>{amountsVisible ? formatMoney(totalBalance) : "******"}</strong><small>{relationships.length} boutique{relationships.length > 1 ? "s" : ""} connectée{relationships.length > 1 ? "s" : ""}</small><button className="balance-visibility" onClick={onToggleAmounts} aria-label={amountsVisible ? "Masquer les montants" : "Afficher les montants"}>{amountsVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></section><div className="client-quick-actions" aria-label="Actions principales"><button onClick={onDebt}><span><PackagePlus size={21} /></span><strong>Acheter</strong></button><button className="scan" onClick={onScan}><span><QrCode size={23} /></span><strong>Scanner</strong></button><button onClick={onRepayment}><span><Banknote size={21} /></span><strong>Rembourser</strong></button></div><section className={`client-relationships ${relationships.length === 0 ? "is-empty" : ""}`}><div className="section-heading"><div><p>Mes boutiques</p><h3>Relations actives</h3></div><span>{relationships.length}</span></div>{relationships.map((relation) => <button className="relationship-card" key={relation.shopClient.id} onClick={() => onOpenLedger(relation.shopClient.id)}><span className="avatar shop-avatar">{initials(relation.shop.name)}</span><span><strong>{relation.shop.name}</strong><p>Ouvrir le relevé</p></span><b>{amountsVisible ? formatMoney(relation.balance.balanceTotalXof) : "******"}</b><ChevronRight size={17} /></button>)}{relationships.length === 0 && <NoRelationship />}</section>{recent.length > 0 && <section className="recent-activity"><div className="section-heading"><div><p>Activité récente</p><h3>Dernières opérations</h3></div><button onClick={onViewAll}>Voir tout</button></div>{recent.map(({ relation, entry }) => { const amount = signedAmount(entry); return <button className="recent-activity-row" key={entry.id} onClick={() => onOpenLedger(relation.shopClient.id)}><span className={`entry-icon ${amount > 0 ? "debt" : "credit"}`}>{entry.type === "repayment" ? <Banknote size={16} /> : <PackagePlus size={16} />}</span><span><strong>{entry.title}</strong><small>{relation.shop.name} · {entry.recordedByRole === "client" && entry.sourceChannel === "shop_qr" ? "via QR boutique · " : ""}{dateLabel(entry.recordedAt)}</small></span><b className={amount > 0 ? "debt" : "credit"}>{amountsVisible ? `${amount > 0 ? "+" : "−"}${money.format(Math.abs(amount))}` : "******"}</b></button>; })}</section>}</div>;
}

function RelationshipPicker({ mode, relationships, onBack, onSelect }: { mode: "debt" | "repayment"; relationships: Relationship[]; onBack: () => void; onSelect: (id: string) => void }) {
  return <div className="client-dashboard focused-client-page"><ViewHeader title={mode === "debt" ? "Acheter à crédit" : "Noter un remboursement"} onBack={onBack} /><p className="route-intro">Choisissez la boutique concernée.</p><div className="relationship-picker">{relationships.map((relation) => <button key={relation.shopClient.id} onClick={() => onSelect(relation.shopClient.id)}><span className="avatar shop-avatar">{initials(relation.shop.name)}</span><span><strong>{relation.shop.name}</strong><small>{formatMoney(relation.balance.balanceTotalXof)}</small></span><ChevronRight size={18} /></button>)}</div></div>;
}

function ClientLedger({ relationships, active, amountsVisible, onToggleAmounts, onBack, onSelect, onDispute }: { relationships: Relationship[]; active?: Relationship; amountsVisible: boolean; onToggleAmounts: () => void; onBack: () => void; onSelect: (id: string) => void; onDispute: (entry: LedgerEntry) => void }) {
  return <div className="client-dashboard focused-client-page"><ViewHeader title="Mes relevés" onBack={onBack} />{relationships.length > 1 && <label className="relationship-switcher"><span>Boutique consultée</span><select value={active?.shopClient.id ?? ""} onChange={(event) => onSelect(event.target.value)}>{relationships.map((relation) => <option key={relation.shopClient.id} value={relation.shopClient.id}>{relation.shop.name}</option>)}</select></label>}{active ? <Ledger relation={active} audience="client" amountsVisible={amountsVisible} onToggleAmounts={onToggleAmounts} onDispute={onDispute} /> : <NoRelationship />}</div>;
}

function ClientProfile({ context, amountsVisible, onToggleAmounts, onBack }: { context: ActorContext; amountsVisible: boolean; onToggleAmounts: () => void; onBack: () => void }) { return <div className="profile-page focused-client-page"><ViewHeader title="Paramètres" onBack={onBack} /><section className="profile-card"><span className="avatar large">{initials(context.client?.displayName || "")}</span><div><h2>{context.client?.displayName}</h2><p>{context.client?.phoneE164}</p><span><BadgeCheck size={15} /> Numéro vérifié par OTP</span></div></section><section className="account-setting-list client-settings-list"><button onClick={onToggleAmounts}><span><strong>Montants sur l'écran</strong><small>{amountsVisible ? "Visibles sur cet appareil" : "Masqués sur cet appareil"}</small></span>{amountsVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button></section><section className="security-card"><ShieldCheck size={22} /><div><strong>Compte protégé</strong><p>Les boutiques ne voient que les relations commerciales qui les concernent.</p></div></section><button className="secondary-action profile-signout" onClick={() => { void supabase?.auth.signOut(); }}><LogOut size={17} /> Se déconnecter</button></div>; }

function NoRelationship({ onScan, onBack }: { onScan?: () => void; onBack?: () => void } = {}) { return <div className="empty-journal client-empty-state">{onBack && <ViewHeader title="Boutique requise" onBack={onBack} />}<QrCode size={26} /><strong>Aucune boutique connectée</strong><p>Scannez le QR affiché par votre boutiquier pour commencer.</p>{onScan && <button className="primary-action" onClick={onScan}><QrCode size={17} /> Scanner une boutique</button>}</div>; }

function Ledger({ relation, audience, amountsVisible = true, onToggleAmounts, onDebt, onRepayment, onShare, onEntryAction, onDispute }: { relation: Relationship; audience: "shop" | "client"; amountsVisible?: boolean; onToggleAmounts?: () => void; onDebt?: () => void; onRepayment?: () => void; onShare?: () => void; onEntryAction?: (entry: LedgerEntry) => void; onDispute?: (entry: LedgerEntry) => void }) {
  const balance = relation.balance;
  const disputedPct = Math.min(100, Math.max(0, Math.abs(balance.balanceDisputedXof) / Math.max(Math.abs(balance.balanceTotalXof), 1) * 100));
  const displayAmount = (value: number) => amountsVisible ? money.format(value) : "******";
  return <div className="ledger-view"><section className={`identity-block ${audience === "client" ? "client-identity-block" : ""}`}><span className="avatar large">{audience === "shop" ? initials(relation.client.name) : initials(relation.shop.name)}</span><div className="identity-copy"><h2>{audience === "shop" ? relation.client.name : relation.shop.name}</h2><p>{audience === "shop" ? relation.client.phoneE164 || "Aucun numéro renseigné" : "Relation active"}</p>{audience === "shop" && <span>{relation.client.name} doit à {relation.shop.name}</span>}</div>{audience === "client" && <span className="verification verified"><BadgeCheck size={15} /> Vérifié</span>}</section><section className="balance-card private-balance"><div className="balance-heading"><span>{audience === "shop" ? "Solde enregistré" : `Solde chez ${relation.shop.name}`}</span><span>Mis à jour maintenant</span></div><div className="balance-total">{displayAmount(balance.balanceTotalXof)}{amountsVisible && <small>FCFA</small>}</div>{audience === "client" && <button className="balance-visibility ledger-visibility" onClick={onToggleAmounts} aria-label={amountsVisible ? "Masquer les montants" : "Afficher les montants"}>{amountsVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button>}<div className="balance-track"><span className="clear" style={{ width: `${100 - disputedPct}%` }} /><span className="disputed" style={{ width: `${disputedPct}%` }} /></div><div className="balance-breakdown"><span><i className="dot clear" />Non contesté <strong>{displayAmount(balance.balanceClearXof)}</strong></span>{balance.balanceDisputedXof !== 0 && <span><i className="dot disputed" />Montant contesté <strong>{displayAmount(balance.balanceDisputedXof)}</strong></span>}</div></section>{audience === "shop" && <div className="ledger-actions"><button className="primary-action" onClick={onDebt}><PackagePlus size={18} /> Ajouter une dette</button><button className="secondary-action" onClick={onRepayment}><Banknote size={18} /> Noter un remboursement</button><button className="text-action" onClick={onShare}><Send size={17} /> Partager le relevé</button></div>}{relation.trust && <div className="trust-card"><ShieldCheck size={19} /><div><strong>{relation.trust.trustScore === null ? "Nouveau" : `${relation.trust.trustScore}/100`}</strong><span>{relation.trust.trustScore === null ? "Historique insuffisant" : trustLabel(relation.trust.trustStatus)}</span></div><small>{relation.trust.settledDebtCount} dette{relation.trust.settledDebtCount > 1 ? "s" : ""} réglée{relation.trust.settledDebtCount > 1 ? "s" : ""}</small></div>}<section className="journal-section"><div className="section-heading"><div><p>Historique immuable</p><h3>Journal</h3></div><span>{relation.entries.length} écriture{relation.entries.length > 1 ? "s" : ""}</span></div>{relation.entries.length === 0 ? <div className="empty-journal"><ReceiptText size={26} /><strong>Aucune écriture</strong><p>Les dettes et remboursements confirmés apparaîtront ici.</p></div> : <ol className="journal-list">{relation.entries.map((entry) => <EntryRow key={entry.id} entry={entry} audience={audience} amountsVisible={amountsVisible} onAction={() => audience === "shop" ? onEntryAction?.(entry) : onDispute?.(entry)} />)}</ol>}</section></div>;
}

function EntryRow({ entry, audience, amountsVisible = true, onAction }: { entry: LedgerEntry; audience: "shop" | "client"; amountsVisible?: boolean; onAction: () => void }) {
  const amount = signedAmount(entry);
  const actionable = entry.type !== "correction" && (audience === "shop" ? !entry.corrected : entry.disputeState === "none" || entry.disputeState === "opened");
  const provenance = entry.recordedByRole === "shop" ? "Boutique" : entry.sourceChannel === "shop_qr" ? "Client · via QR boutique" : "Client";
  return <li className={`entry-row ${entry.disputeState === "opened" ? "is-disputed" : ""}`}><span className={`entry-icon ${entry.disputeState === "opened" ? "flag" : amount > 0 ? "debt" : "credit"}`}>{entry.type === "correction" ? <RotateCcw size={17} /> : entry.disputeState === "opened" ? <CircleAlert size={17} /> : entry.type === "repayment" ? <Banknote size={17} /> : <PackagePlus size={17} />}</span><div className="entry-content"><div className="entry-topline"><strong>{entry.title}</strong><b className={amount > 0 ? "debt" : "credit"}>{amountsVisible ? `${amount > 0 ? "+" : "−"}${money.format(Math.abs(amount))}` : "******"}</b></div>{entry.detail && <p>{entry.detail}</p>}<time>{dateLabel(entry.occurredAt)}, {timeLabel(entry.occurredAt)} · {provenance}</time>{entry.disputeState === "opened" && <><span className="status-tag dispute">Contestée</span>{entry.disputeNote && <p className="entry-note">{entry.disputeNote}</p>}</>}{entry.corrected && <span className="status-tag correction">Corrigée</span>}{actionable && <button className="entry-action" onClick={onAction}>{audience === "shop" ? <><PencilLine size={14} /> Corriger</> : entry.disputeState === "opened" ? "Voir la contestation" : "Contester"}</button>}</div></li>;
}

function OperationForm({ relation, mode, clientMode, sourceChannel = "app", onCancel, onDone }: { relation: Relationship; mode: "debt" | "repayment" | string; clientMode?: boolean; sourceChannel?: "app" | "shop_qr"; onCancel: () => void; onDone: (message: string) => void }) {
  const [actualMode, setActualMode] = useState<"debt" | "repayment">(mode === "repayment" ? "repayment" : "debt");
  const [title, setTitle] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [method, setMethod] = useState("Espèces");
  const [duplicate, setDuplicate] = useState(false);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewOperation>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const draftId = useRef(crypto.randomUUID());
  const queryClient = useQueryClient();
  const amount = actualMode === "debt" ? debtAmount : repaymentAmount;
  const setAmount = actualMode === "debt" ? setDebtAmount : setRepaymentAmount;
  function operationInput(override = duplicateOverride) {
    return { shopClientId: relation.shopClient.id, type: actualMode, title: actualMode === "debt" ? title.trim() : `Remboursement en ${method.toLocaleLowerCase("fr")}`, amountXof: Number(amount), dueOn: actualMode === "debt" && dueOn ? dueOn : null, sourceChannel, idempotencyKey: draftId.current, duplicateOverride: override } as const;
  }
  const mutation = useMutation({ mutationFn: async (action: "prepare" | "confirm" | "force") => {
    if (action === "prepare") {
      const nextPreview = await api.previewOperation(operationInput(false));
      setPreview(nextPreview);
      if (nextPreview.probableDuplicates.length > 0) { setDuplicate(true); return null; }
      if (clientMode) return null;
    }
    return api.recordOperation(operationInput(action === "force" || duplicateOverride));
  }, onSuccess: async (result) => {
    if (!result) return;
    const completedDraftId = draftId.current;
    await removeOperationDraft(completedDraftId);
    draftId.current = crypto.randomUUID();
    if (actualMode === "debt") { setTitle(""); setDebtAmount(""); setDueOn(""); } else { setRepaymentAmount(""); }
    setDuplicate(false);
    setDuplicateOverride(false);
    setPreview(null);
    setSaved(actualMode === "debt" ? "Achat ajouté au journal" : "Remboursement ajouté au journal");
    await queryClient.invalidateQueries({ queryKey: ["client-home"] });
    await queryClient.invalidateQueries({ queryKey: ["shop-clients"] });
    onDone(actualMode === "debt" ? "Dette enregistrée dans le journal" : "Remboursement enregistré");
  }});
  const valid = Number(amount) > 0 && (actualMode === "repayment" || title.trim().length > 0);
  useEffect(() => { if (!valid) return; void saveOperationDraft({ id: draftId.current, shopClientId: relation.shopClient.id, type: actualMode, title: actualMode === "debt" ? title : `Remboursement en ${method.toLocaleLowerCase("fr")}`, amountXof: Number(amount), updatedAt: new Date().toISOString() }); }, [actualMode, amount, method, relation.shopClient.id, title, valid]);
  function resetReview() { setPreview(null); setDuplicate(false); setDuplicateOverride(false); setError(null); }
  async function submit(event: FormEvent) { event.preventDefault(); setError(null); if (!valid) return; try { await mutation.mutateAsync(clientMode && preview ? "confirm" : "prepare"); } catch (reason) { setError(errorText(reason)); } }
  function changeField(change: () => void) { change(); setSaved(null); resetReview(); }
  function switchMode(nextMode: "debt" | "repayment") { setActualMode(nextMode); setSaved(null); resetReview(); }
  const reviewVisible = Boolean(clientMode && preview && !duplicate);
  return <div className="form-surface operation-surface"><ViewHeader title={reviewVisible ? "Confirmer l'opération" : "Nouvelle opération"} onBack={reviewVisible ? resetReview : onCancel} /><section className="connected-shop"><span className="avatar shop-avatar">{initials(relation.shop.name)}</span><div><small>Boutique sélectionnée</small><strong>{relation.shop.name}</strong></div><span className="verification verified"><BadgeCheck size={14} /> Vérifié</span></section>{reviewVisible && preview ? <form className="operation-review" onSubmit={submit}><div className="operation-review-main"><span>{actualMode === "debt" ? "Achat à crédit" : "Remboursement"}</span><strong>{actualMode === "debt" ? title.trim() : `Remboursement en ${method.toLocaleLowerCase("fr")}`}</strong><b>{formatMoney(Number(amount))}</b>{actualMode === "debt" && dueOn && <small>Prévu pour le {new Date(`${dueOn}T00:00:00`).toLocaleDateString("fr-SN")}</small>}</div><div className="operation-balance-preview"><span><small>Solde actuel</small><strong>{formatMoney(preview.currentBalance.balanceTotalXof)}</strong></span><ChevronRight size={19} /><span><small>Après l'opération</small><strong>{formatMoney(preview.projectedBalance.balanceTotalXof)}</strong></span></div><div className="operation-provenance"><ShieldCheck size={18} /><span><strong>{sourceChannel === "shop_qr" ? "Enregistré par vous via le QR de la boutique" : "Enregistré par vous dans Boutikier"}</strong><small>La boutique verra immédiatement cette provenance et pourra contester l'écriture sans effacer le journal.</small></span></div>{error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}</div>}<SubmitBar label={mutation.isPending ? "Enregistrement…" : actualMode === "debt" ? "Confirmer l'achat" : "Confirmer le remboursement"} disabled={mutation.isPending} /><button className="text-action review-edit" type="button" onClick={resetReview}>Modifier les informations</button></form> : <><div className="operation-mode" role="tablist" aria-label="Type d'opération"><button type="button" role="tab" aria-selected={actualMode === "debt"} className={actualMode === "debt" ? "active" : ""} onClick={() => switchMode("debt")}><PackagePlus size={17} /> Achat à crédit</button><button type="button" role="tab" aria-selected={actualMode === "repayment"} className={actualMode === "repayment" ? "active" : ""} onClick={() => switchMode("repayment")}><Banknote size={17} /> Remboursement</button></div>{saved && <div className="operation-saved" role="status"><Check size={18} /><span><strong>{saved}</strong><small>Vous pouvez enregistrer une autre opération.</small></span></div>}<form className="credit-request-form" onSubmit={submit}>{actualMode === "debt" && <Field label="Nom de l'article ou service" value={title} onChange={(value) => changeField(() => setTitle(value))} placeholder="Ex. 2 sachets de lait, 1 pain" autoFocus />}<Field label={actualMode === "debt" ? "Prix total" : "Montant remboursé"} value={amount} onChange={(value) => changeField(() => setAmount(value))} placeholder="0" inputMode="numeric" suffix="FCFA" autoFocus={actualMode === "repayment"} />{actualMode === "debt" ? <Field label="Date prévue (optionnel)" value={dueOn} onChange={(value) => changeField(() => setDueOn(value))} type="date" /> : <label className="field"><span>Méthode</span><select value={method} onChange={(event) => changeField(() => setMethod(event.target.value))}><option>Espèces</option><option>Wave</option><option>Orange Money</option><option>Autre</option></select></label>}<DraftNotice />{duplicate && <div className="inline-warning" role="alert"><CircleAlert size={17} /><span>Une opération proche existe déjà. <button type="button" onClick={() => { setDuplicate(false); setDuplicateOverride(true); if (!clientMode) void mutation.mutate("force"); }}>Continuer malgré le doublon</button></span></div>}{error && <div className="inline-error" role="alert"><CircleAlert size={17} />{error}</div>}<SubmitBar label={mutation.isPending ? "Vérification…" : clientMode ? "Voir le récapitulatif" : actualMode === "debt" ? "Enregistrer la dette" : "Enregistrer le remboursement"} disabled={!valid || mutation.isPending} /></form></>}</div>;
}

function CorrectionForm({ relation, entryId, onCancel, onDone }: { relation: Relationship; entryId: string; onCancel: () => void; onDone: (message: string) => void }) {
  const entry = relation.entries.find((item) => item.id === entryId);
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => api.correctEntry(entryId, { reason, idempotencyKey: crypto.randomUUID() }), onSuccess: () => onDone("Correction ajoutée sans effacer l'original") });
  if (!entry) return <ErrorState error={new Error("Écriture introuvable")} />;
  return <div className="form-surface"><ViewHeader eyebrow={relation.client.name} title="Corriger une écriture" onBack={onCancel} /><EntryPreview entry={entry} /><form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><label className="field"><span>Motif obligatoire</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. Le sucre n'a pas été livré" autoFocus /></label><p className="form-hint">L'original reste visible. Une compensation inverse sera ajoutée dans le journal.</p>{mutation.error && <div className="inline-error"><CircleAlert size={17} />{errorText(mutation.error)}</div>}<SubmitBar label="Ajouter la correction" disabled={!reason.trim() || mutation.isPending} /></form></div>;
}

function DisputeForm({ relation, entry, onCancel, onDone }: { relation: Relationship; entry: LedgerEntry; onCancel: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState(entry.disputeNote || "");
  const opened = entry.disputeState === "opened";
  const mutation = useMutation({ mutationFn: (eventType: "opened" | "withdrawn") => api.disputeEntry(entry.id, { eventType, note, idempotencyKey: crypto.randomUUID() }), onSuccess: () => onDone(opened ? "Contestation retirée" : "Contestation envoyée") });
  return <div className="form-surface"><ViewHeader eyebrow={relation.shop.name} title={opened ? "Ma contestation" : "Contester l'opération"} onBack={onCancel} /><EntryPreview entry={entry} />{opened ? <><div className="dispute-current"><CircleAlert size={19} /><div><strong>Opération contestée</strong><p>{entry.disputeNote || "Votre contestation est visible par la boutique."}</p></div></div><button className="secondary-action danger" onClick={() => mutation.mutate("withdrawn")} disabled={mutation.isPending}>Retirer ma contestation</button></> : <form onSubmit={(event) => { event.preventDefault(); mutation.mutate("opened"); }}><label className="field"><span>Expliquez pourquoi (optionnel)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. J'ai déjà payé en espèces" autoFocus /></label><SubmitBar label="Envoyer la contestation" disabled={mutation.isPending} /></form>}</div>;
}

function ShareForm({ relation, onBack, onDone }: { relation: Relationship; onBack: () => void; onDone: (message: string) => void }) {
  const [created, setCreated] = useState<{ url: string; validUntil: string } | null>(null);
  const mutation = useMutation({ mutationFn: () => api.createShareLink(relation.shopClient.id), onSuccess: (value) => setCreated(value) });
  async function copy() { if (!created) return; await navigator.clipboard?.writeText(created.url); onDone("Lien privé copié"); }
  return <div className="form-surface"><ViewHeader eyebrow={relation.client.name} title="Partager le relevé" onBack={onBack} /><div className="whatsapp-card"><div className="wa-header"><span className="avatar shop-avatar">{initials(relation.shop.name)}</span><div><strong>{relation.shop.name}</strong><span>Relevé privé</span></div></div><div className="wa-message"><p>Ce lien permet de consulter le relevé en lecture seule.</p><small>Il expirera dans 30 jours et sera révocable.</small></div></div>{created ? <><div className="share-link"><span>{created.url}</span><button onClick={copy} aria-label="Copier le lien"><Copy size={17} /></button></div><button className="primary-action" onClick={copy}><MessageCircle size={18} /> Copier le message WhatsApp</button></> : <button className="primary-action" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Send size={18} /> {mutation.isPending ? "Création…" : "Créer le lien privé"}</button>}{mutation.error && <div className="inline-error"><CircleAlert size={17} />{errorText(mutation.error)}</div>}</div>;
}

function PublicStatement() {
  const location = useLocation();
  const token = decodeURIComponent(location.pathname.slice("/s/".length));
  const query = useQuery({ queryKey: ["public-statement", token], queryFn: () => api.publicStatement(token), retry: false });
  if (query.isLoading) return <Loading label="Ouverture du relevé…" />;
  if (query.error || !query.data) return <div className="statement-unavailable"><ShieldCheck size={30} /><h1>Lien indisponible</h1><p>Ce relevé privé est invalide, expiré ou a été révoqué.</p></div>;
  const statement = query.data;
  return <div className="client-statement-app"><header className="client-portal-header"><div className="brand-lockup"><span className="brand-mark"><BrandLogo /></span><div><strong>Boutikier</strong><span>Relevé client</span></div></div><span className="private-link-badge"><ShieldCheck size={15} /> Lien privé</span></header><main className="client-statement-shell"><div className="ledger-view"><section className="identity-block"><span className="avatar large">{initials(statement.client.name)}</span><div className="identity-copy"><h2>{statement.client.name}</h2><p>{statement.shop.name}</p><span>Lecture seule</span></div><span className="verification"><ShieldCheck size={15} /> Lecture seule</span></section><section className="balance-card"><div className="balance-heading"><span>Solde enregistré</span><span>Valable jusqu'au {new Date(statement.validUntil).toLocaleDateString("fr-SN")}</span></div><div className="balance-total">{formatMoney(statement.balance.balanceTotalXof)} <small>FCFA</small></div><div className="balance-breakdown"><span><i className="dot clear" />Non contesté <strong>{money.format(statement.balance.balanceClearXof)}</strong></span>{statement.balance.balanceDisputedXof !== 0 && <span><i className="dot disputed" />Contesté <strong>{money.format(statement.balance.balanceDisputedXof)}</strong></span>}</div></section><section className="journal-section"><div className="section-heading"><div><p>Historique</p><h3>Journal</h3></div><span>{statement.timeline.length} événement{statement.timeline.length > 1 ? "s" : ""}</span></div><ol className="journal-list">{statement.timeline.map((event) => <li className="entry-row" key={event.eventId}><span className={`entry-icon ${event.amountXof && event.amountXof > 0 ? "debt" : "credit"}`}><ReceiptText size={17} /></span><div className="entry-content"><div className="entry-topline"><strong>{event.title || event.kind}</strong>{event.amountXof !== null && <b className={event.amountXof > 0 ? "debt" : "credit"}>{event.amountXof > 0 ? "+" : "−"}{money.format(Math.abs(event.amountXof))}</b>}</div>{event.detail && <p>{event.detail}</p>}<time>{dateLabel(event.eventAt)}, {timeLabel(event.eventAt)}</time></div></li>)}</ol></section></div><div className="shared-account-cta"><div><strong>Vous avez déjà un compte ?</strong><p>Retrouvez toutes vos boutiques dans votre espace personnel.</p></div><Link to="/client">Ouvrir mon espace</Link></div></main></div>;
}

function QrLanding({ session }: { session: AuthSession | null }) {
  const location = useLocation();
  const code = decodeURIComponent(location.pathname.slice("/q/s/".length));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resolve = useQuery({ queryKey: ["resolve-qr", code], queryFn: () => api.resolveShopQr(code), retry: false });
  const context = useQuery({ queryKey: ["me", session?.user.id ?? null], queryFn: api.me, enabled: Boolean(session) });
  const connect = useMutation({ mutationFn: () => api.connectShop(code), onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["client-home"] }); navigate(`/client/acheter?shopClientId=${result.shopClientId}&source=shop_qr`, { replace: true }); } });
  if (resolve.isLoading) return <Loading label="Vérification de la boutique…" />;
  if (resolve.error || !resolve.data) return <div className="statement-unavailable"><QrCode size={30} /><h1>QR indisponible</h1><p>Ce code est invalide ou a été révoqué par la boutique.</p></div>;
  if (!session) return <div className="qr-confirm-page"><QrCode size={35} /><p className="panel-heading-kicker">Boutique trouvée</p><h1>{resolve.data.shopName}</h1><p>Aucune application n'est nécessaire. Vérifiez votre téléphone pour créer ou retrouver votre compte client léger et enregistrer votre achat.</p><Link className="primary-action" to={`/connexion?returnTo=${encodeURIComponent(location.pathname)}`}>Continuer avec mon numéro</Link></div>;
  if (context.isLoading) return <Loading />;
  if (context.data?.needsOnboarding) return <NavigateTo to={`/connexion?returnTo=${encodeURIComponent(location.pathname)}`} />;
  if (!context.data?.client) return <AccessDenied label="Seul un client vérifié peut se connecter à une boutique par QR." />;
  return <div className="qr-confirm-page"><QrCode size={35} /><p className="panel-heading-kicker">Confirmer la boutique</p><h1>{resolve.data.shopName}</h1><p>Vous êtes sur le point d'ajouter cette boutique à vos relations.</p>{connect.error && <div className="inline-error"><CircleAlert size={17} />{errorText(connect.error)}</div>}<button className="primary-action" onClick={() => connect.mutate()} disabled={connect.isPending}>{connect.isPending ? "Connexion…" : "Confirmer et continuer"}<ChevronRight size={18} /></button><Link className="text-action" to="/client">Annuler</Link></div>;
}

function ScannerPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  useEffect(() => {
    let active = true;
    void import("@zxing/browser").then(({ BrowserQRCodeReader }) => {
      if (!active) return;
      const reader = new BrowserQRCodeReader();
      return reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current!, (result, failure, controls) => {
        controlsRef.current = controls;
        if (!active || !result) { if (failure && failure.name === "NotAllowedError") setError("Autorisez la caméra pour scanner le QR."); return; }
        const text = result.getText();
        const match = text.match(/\/q\/s\/([^/?#]+)/) || text.match(/^([^/?#]+)$/);
        if (match?.[1]) { controls.stop(); navigate(`/q/s/${match[1]}`); }
      });
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "La caméra n'est pas disponible."));
    return () => { active = false; controlsRef.current?.stop(); };
  }, [navigate]);
  function openManual(event: FormEvent) {
    event.preventDefault();
    const match = manualCode.trim().match(/\/q\/s\/([^/?#]+)/) || manualCode.trim().match(/^([^/?#]+)$/);
    if (!match?.[1]) { setError("Collez un lien ou un code QR Boutikier valide."); return; }
    navigate(`/q/s/${match[1]}`);
  }
  return <div className="scanner-page"><div className="scanner-header"><button className="icon-command" onClick={() => navigate("/client")} aria-label="Retour"><ArrowLeft size={22} /></button><h1>Scanner une boutique</h1><span /></div><div className="scanner-frame"><video ref={videoRef} autoPlay muted playsInline /><span className="scanner-corner" /></div>{error && <div className="inline-error"><CircleAlert size={17} />{error}</div>}<p>Placez le QR de la boutique dans le cadre. La caméra n'est active que sur cet écran.</p><form className="manual-qr-form" onSubmit={openManual}><label className="field"><span>Lien ou code de secours</span><div className="input-wrap"><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Coller le lien du QR" autoCapitalize="off" autoCorrect="off" /></div></label><button className="secondary-action" type="submit" disabled={!manualCode.trim()}>Ouvrir la boutique</button></form></div>;
}

function ClientScannerRoute() {
  const { session, loading } = useAuth();
  const context = useQuery({
    queryKey: ["me", session?.user.id ?? null],
    queryFn: api.me,
    enabled: Boolean(session),
  });
  if (loading) return <Loading />;
  if (!session) return <AuthPage />;
  if (context.isLoading) return <Loading />;
  if (context.error) return <ErrorState error={context.error} />;
  if (!context.data?.client) return <AccessDenied label="Seul un client vérifié peut scanner une boutique." />;
  return <ScannerPage />;
}

function Welcome({ hasClients }: { hasClients: boolean }) { return <div className="welcome"><span><ReceiptText size={30} /></span><p>Boutique</p><h2>{hasClients ? "Sélectionnez un client." : "Votre carnet est vide."}</h2><p>{hasClients ? "Sa fiche affichera son solde et son journal." : "Ajoutez votre premier client depuis la liste."}</p></div>; }

function ClientRow({ client, selected, onSelect }: { client: ShopClientSummary; selected: boolean; onSelect: () => void }) { return <button className={`client-row ${selected ? "selected" : ""}`} onClick={onSelect}><span className="avatar">{initials(client.name)}</span><span className="client-copy"><strong>{client.name}</strong><span>{client.phoneE164 || "Sans numéro"}</span></span><span className="client-balance"><strong className={client.balanceTotalXof > 0 ? "owed" : "settled"}>{formatMoney(client.balanceTotalXof)}</strong>{client.balanceDisputedXof !== 0 && <small>Contesté</small>}</span><ChevronRight className="row-chevron" size={17} /></button>; }

function NewClientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (client: ShopClientSummary) => void }) { const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const mutation = useMutation({ mutationFn: () => api.createShopClient({ name, phoneRaw: phone, phoneE164: phoneE164(phone) }), onSuccess: onCreated }); return <div className="form-surface"><ViewHeader eyebrow="Clients" title="Nouvelle fiche" onBack={onCancel} /><form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><Field label="Nom du client" value={name} onChange={setName} placeholder="Ex. Fatou Sarr" autoFocus /><Field label="Téléphone (optionnel)" value={phone} onChange={setPhone} placeholder="Ex. 77 000 00 00" inputMode="tel" /><p className="form-hint">Sans numéro vérifié, la fiche reste locale à cette boutique.</p>{mutation.error && <div className="inline-error"><CircleAlert size={17} />{errorText(mutation.error)}</div>}<SubmitBar label={mutation.isPending ? "Création…" : "Créer la fiche"} disabled={!name.trim() || mutation.isPending} /></form></div>; }

function ViewHeader({ eyebrow, title, onBack }: { eyebrow?: string; title: string; onBack: () => void }) { return <div className="view-header"><button className="icon-command" onClick={onBack} aria-label="Retour"><ArrowLeft size={20} /></button><div>{eyebrow && <p>{eyebrow}</p>}<h2>{title}</h2></div></div>; }
function Field({ label, value, onChange, placeholder, inputMode, suffix, autoFocus, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; inputMode?: "text" | "tel" | "numeric"; suffix?: string; autoFocus?: boolean; type?: "text" | "date" }) { return <label className="field"><span>{label}</span><div className="input-wrap"><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} autoFocus={autoFocus} />{suffix && <b>{suffix}</b>}</div></label>; }
function SubmitBar({ label, disabled }: { label: string; disabled?: boolean }) { return <button className="primary-action submit" type="submit" disabled={disabled}>{label}<ChevronRight size={18} /></button>; }
function EntryPreview({ entry }: { entry: LedgerEntry }) { return <div className="entry-preview"><span><ReceiptText size={18} /></span><div><strong>{entry.title}</strong><p>{dateLabel(entry.occurredAt)}, {timeLabel(entry.occurredAt)}</p></div><b>{signedAmount(entry) > 0 ? "+" : "−"}{formatMoney(Math.abs(signedAmount(entry)))}</b></div>; }
function DraftNotice() { return <div className="draft-notice"><Smartphone size={18} /><div><strong>Brouillon local</strong><p>L'écriture rejoint le journal après confirmation du serveur.</p></div></div>; }

function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><RouteSwitch /></BrowserRouter></QueryClientProvider>;
}

function RouteSwitch() {
  const location = useLocation();
  if (location.pathname === "/client/scanner") return <ClientScannerRoute />;
  return <AppRoutes />;
}

export default App;
