import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  BackpackIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  CopyIcon,
  ExclamationTriangleIcon,
  HamburgerMenuIcon,
  LockClosedIcon,
  MobileIcon,
  Pencil2Icon,
  PlusCircledIcon,
  ReaderIcon,
  ReloadIcon,
  Share2Icon,
} from "@radix-ui/react-icons";
import {
  BottomSheet,
  KeyboardInput,
  KeyboardTextarea,
  MobileScroll,
  useKeyboard,
} from "./mobile";

type View = "ledger" | "add" | "repay" | "client" | "otp" | "receipt";
type EntryKind = "debt" | "payment" | "correction";

type LedgerEntry = {
  id: number;
  kind: EntryKind;
  title: string;
  detail: string;
  amount: number;
  date: string;
  time: string;
  disputed?: boolean;
  correctionOf?: number;
};

const initialEntries: LedgerEntry[] = [
  { id: 1, kind: "debt", title: "Riz 25 kg, huile 2 L", detail: "1 sac de riz, 2 bouteilles d’huile", amount: 15000, date: "Aujourd’hui", time: "10:15" },
  { id: 2, kind: "debt", title: "Sucre 5 kg, lait 1 boîte", detail: "1 sac de sucre, 1 boîte de lait", amount: 4250, date: "Aujourd’hui", time: "09:02" },
  { id: 3, kind: "payment", title: "Remboursement en espèces", detail: "Paiement partiel", amount: -10000, date: "Hier", time: "17:45" },
  { id: 4, kind: "debt", title: "Savon 3, pâte 2", detail: "3 savons, 2 pâtes dentifrice", amount: 2750, date: "Hier", time: "16:30" },
  { id: 5, kind: "debt", title: "Thé 1, sucre 2 kg", detail: "Le client affirme avoir déjà payé", amount: 5000, date: "29 août", time: "11:20", disputed: true },
  { id: 6, kind: "correction", title: "Correction de l’entrée du 29 août", detail: "Motif : quantité de sucre erronée", amount: -2000, date: "29 août", time: "12:05", correctionOf: 5 },
  { id: 7, kind: "debt", title: "Riz 10 kg", detail: "1 sac de riz 10 kg", amount: 13750, date: "28 août", time: "10:05" },
];

const money = (amount: number) => `${Math.abs(amount).toLocaleString("fr-FR")} FCFA`;

export default function Prototype() {
  const keyboard = useKeyboard();
  const [view, setView] = useState<View>("ledger");
  const [entries, setEntries] = useState(initialEntries);
  const [menuOpen, setMenuOpen] = useState(false);
  const [entrySheet, setEntrySheet] = useState<LedgerEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [debtDraft, setDebtDraft] = useState({ articles: "", amount: "" });
  const [repayment, setRepayment] = useState({ amount: "", method: "Espèces" });
  const [otp, setOtp] = useState("");
  const [verified, setVerified] = useState(false);
  const [clientDisputeId, setClientDisputeId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const recorded = entries.reduce((sum, entry) => sum + entry.amount, 0);
    const disputed = entries.filter((entry) => entry.disputed).reduce((sum, entry) => sum + entry.amount, 0);
    return { recorded, disputed, undisputed: recorded - disputed };
  }, [entries]);

  function navigate(next: View) {
    keyboard.hide();
    setView(next);
    setToast(null);
  }

  function addDebt(event: FormEvent) {
    event.preventDefault();
    const amount = Number(debtDraft.amount.replace(/\s/g, ""));
    if (!debtDraft.articles.trim() || !amount) return;
    setEntries((current) => [{
      id: Date.now(), kind: "debt", title: debtDraft.articles.trim(), detail: "Dette confirmée par le serveur",
      amount, date: "Aujourd’hui", time: "11:32",
    }, ...current]);
    setDebtDraft({ articles: "", amount: "" });
    setToast("Dette ajoutée au journal");
    keyboard.hide();
    setView("ledger");
  }

  function addRepayment(event: FormEvent) {
    event.preventDefault();
    const amount = Number(repayment.amount.replace(/\s/g, ""));
    if (!amount) return;
    setEntries((current) => [{
      id: Date.now(), kind: "payment", title: `Remboursement par ${repayment.method.toLowerCase()}`,
      detail: "Reçu prêt à envoyer au client", amount: -amount, date: "Aujourd’hui", time: "11:34",
    }, ...current]);
    setRepayment({ amount: "", method: "Espèces" });
    keyboard.hide();
    setView("receipt");
  }

  function contestEntry() {
    if (!clientDisputeId) return;
    setEntries((current) => current.map((entry) => entry.id === clientDisputeId ? { ...entry, disputed: true } : entry));
    setClientDisputeId(null);
    setToast("Contestation transmise à Boutique Diallo");
  }

  function correctEntry(entry: LedgerEntry) {
    setEntries((current) => [{
      id: Date.now(), kind: "correction", title: `Annulation : ${entry.title}`,
      detail: `Corrige l’entrée #${entry.id} · Motif : erreur de saisie`, amount: -entry.amount,
      date: "Aujourd’hui", time: "11:36", correctionOf: entry.id,
    }, ...current]);
    setEntrySheet(null);
    setToast("Correction ajoutée sans modifier l’original");
  }

  return (
    <div className="prototype-app">
      <MobileScroll className="app-screen">
        {view === "ledger" && <LedgerScreen entries={entries} totals={totals} toast={toast} verified={verified} onMenu={() => setMenuOpen(true)} onAdd={() => navigate("add")} onRepay={() => navigate("repay")} onShare={() => navigate("client")} onEntry={setEntrySheet} />}

        {view === "add" && (
          <FormScreen title="Ajouter une dette" onBack={() => navigate("ledger")}>
            <form className="entry-form" onSubmit={addDebt}>
              <ClientMini />
              <label className="field-label" htmlFor="articles">Articles pris</label>
              <KeyboardTextarea id="articles" value={debtDraft.articles} onChange={(event) => setDebtDraft({ ...debtDraft, articles: event.target.value })} placeholder="Ex. Riz 10 kg, huile 1 L" rows={3} />
              <label className="field-label" htmlFor="debt-amount">Montant total</label>
              <div className="amount-field"><KeyboardInput id="debt-amount" inputMode="numeric" value={debtDraft.amount} onChange={(event) => setDebtDraft({ ...debtDraft, amount: event.target.value.replace(/\D/g, "") })} placeholder="0" /><span>FCFA</span></div>
              <div className="quick-amounts" aria-label="Montants rapides">{[1000, 2500, 5000, 10000].map((value) => <button type="button" key={value} onClick={() => setDebtDraft({ ...debtDraft, amount: String(value) })}>{value.toLocaleString("fr-FR")}</button>)}</div>
              {debtDraft.articles || debtDraft.amount ? <p className="draft-note"><MobileIcon /> Brouillon conservé sur ce téléphone jusqu’à validation.</p> : null}
              <div className="form-assurance"><LockClosedIcon /> L’entrée deviendra immuable après confirmation.</div>
              <button className="primary-button" type="submit" disabled={!debtDraft.articles.trim() || !debtDraft.amount}><CheckCircledIcon /> Enregistrer la dette</button>
            </form>
          </FormScreen>
        )}

        {view === "repay" && (
          <FormScreen title="Noter un remboursement" onBack={() => navigate("ledger")}>
            <form className="entry-form" onSubmit={addRepayment}>
              <ClientMini />
              <label className="field-label" htmlFor="repay-amount">Montant reçu</label>
              <div className="amount-field"><KeyboardInput id="repay-amount" inputMode="numeric" value={repayment.amount} onChange={(event) => setRepayment({ ...repayment, amount: event.target.value.replace(/\D/g, "") })} placeholder="0" /><span>FCFA</span></div>
              <fieldset className="method-picker"><legend>Mode de remboursement</legend>{["Espèces", "Wave", "Orange Money"].map((method) => <button type="button" className={repayment.method === method ? "selected" : ""} key={method} onClick={() => setRepayment({ ...repayment, method })}>{method}</button>)}</fieldset>
              <div className="receipt-preview"><ReaderIcon /><div><strong>Un reçu sera préparé</strong><span>Le client pourra le recevoir par WhatsApp.</span></div></div>
              <button className="primary-button" type="submit" disabled={!repayment.amount}><CheckCircledIcon /> Confirmer le remboursement</button>
            </form>
          </FormScreen>
        )}

        {view === "client" && <ClientView entries={entries} totals={totals} verified={verified} toast={toast} onBack={() => navigate("ledger")} onClaim={() => navigate("otp")} onDispute={(id) => setClientDisputeId(id)} />}

        {view === "otp" && (
          <FormScreen title="Vérifier mon numéro" onBack={() => navigate("client")}>
            <div className="otp-screen">
              <div className="otp-icon"><MobileIcon /></div><h2>Code envoyé sur WhatsApp</h2>
              <p>Nous avons envoyé un code à 6 chiffres au <strong>77 123 45 67</strong>.</p>
              <label className="field-label" htmlFor="otp">Code de vérification</label>
              <KeyboardInput id="otp" className="otp-input" inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} placeholder="000 000" />
              <p className="demo-hint">Pour la démo, utilisez 482931</p>
              <button className="primary-button" disabled={otp !== "482931"} onClick={() => { setVerified(true); setToast("Numéro vérifié"); keyboard.hide(); setView("client"); }}><CheckCircledIcon /> Vérifier le numéro</button>
              <button className="text-button" onClick={() => setOtp("482931")}><CopyIcon /> Copier le code reçu</button>
              <button className="text-button muted"><ReloadIcon /> Recevoir plutôt par SMS</button>
            </div>
          </FormScreen>
        )}

        {view === "receipt" && (
          <FormScreen title="Remboursement enregistré" onBack={() => navigate("ledger")}>
            <div className="success-screen"><CheckCircledIcon className="success-icon" /><h2>Le journal est à jour</h2><p>Le remboursement apparaît comme une nouvelle entrée. Aucune ancienne dette n’a été modifiée.</p><div className="receipt-card"><span>Reçu Boutique Diallo</span><strong>{entries[0]?.kind === "payment" ? money(entries[0].amount) : "Remboursement"}</strong><small>Dimanche 30 août 2026 · 11:34</small></div><button className="primary-button" onClick={() => navigate("client")}><Share2Icon /> Voir le reçu côté client</button><button className="secondary-button" onClick={() => navigate("ledger")}>Retour au carnet</button></div>
          </FormScreen>
        )}
      </MobileScroll>

      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} title="Boutique Diallo" description="Carnet de dettes partagé avec vos clients"><div className="menu-list"><button onClick={() => { setMenuOpen(false); navigate("ledger"); }}><ReaderIcon /> Carnet clients <ChevronRightIcon /></button><button onClick={() => { setMenuOpen(false); navigate("client"); }}><Share2Icon /> Aperçu du lien client <ChevronRightIcon /></button><p><LockClosedIcon /> Aucun profil employé : ce carnet appartient à la boutique.</p></div></BottomSheet>

      <BottomSheet open={Boolean(entrySheet)} onOpenChange={(open) => !open && setEntrySheet(null)} title="Détail de l’écriture" description="Le journal original reste toujours visible.">{entrySheet && <div className="entry-sheet"><strong>{entrySheet.title}</strong><span>{money(entrySheet.amount)} · {entrySheet.date} à {entrySheet.time}</span>{entrySheet.kind === "debt" && !entrySheet.correctionOf ? <button className="danger-outline" onClick={() => correctEntry(entrySheet)}><Pencil2Icon /> Corriger par une écriture inverse</button> : null}</div>}</BottomSheet>

      <BottomSheet open={Boolean(clientDisputeId)} onOpenChange={(open) => !open && setClientDisputeId(null)} title="Contester cette opération" description="La dette restera visible et Boutique Diallo recevra votre signalement."><div className="dispute-sheet"><p><ExclamationTriangleIcon /> Cette action ne supprime rien du journal.</p><button className="danger-button" onClick={contestEntry}>Je ne reconnais pas cette opération</button></div></BottomSheet>
    </div>
  );
}

function LedgerScreen({ entries, totals, toast, verified, onMenu, onAdd, onRepay, onShare, onEntry }: { entries: LedgerEntry[]; totals: { recorded: number; disputed: number; undisputed: number }; toast: string | null; verified: boolean; onMenu: () => void; onAdd: () => void; onRepay: () => void; onShare: () => void; onEntry: (entry: LedgerEntry) => void; }) {
  return <main className="ledger-screen" data-testid="ledger-screen"><header className="green-header"><button className="icon-button inverse" aria-label="Ouvrir le menu" onClick={onMenu}><HamburgerMenuIcon /></button><h1>Carnet client</h1><span className={`verification-pill ${verified ? "verified" : ""}`}>{verified ? <CheckCircledIcon /> : <MobileIcon />}{verified ? "Numéro vérifié" : "Non vérifié"}</span></header>{toast ? <div className="toast"><CheckCircledIcon /> {toast}</div> : null}<section className="client-hero"><img src="/assets/app/mamadou-diop.png" alt="Portrait de Mamadou Diop" /><div><h2>Mamadou Diop</h2><p>77 123 45 67</p><span>Mamadou doit à <strong>Boutique Diallo</strong></span></div></section><BalanceSummary totals={totals} /><section className="primary-actions"><button className="primary-button" onClick={onAdd}><PlusCircledIcon /> Ajouter une dette</button><button className="secondary-button" onClick={onRepay}><ReaderIcon /> Noter un remboursement</button><button className="share-button" onClick={onShare}><Share2Icon /> Partager le relevé <small>lien privé</small></button></section><section className="journal-section"><div className="section-heading"><h3>Journal</h3><span>30 août 2026</span></div><div className="journal-list">{entries.map((entry) => <JournalRow key={entry.id} entry={entry} onClick={() => onEntry(entry)} />)}</div></section><div className="draft-banner"><MobileIcon /><div><strong>Brouillons protégés</strong><span>Une saisie non confirmée reste seulement sur ce téléphone.</span></div></div></main>;
}

function ClientView({ entries, totals, verified, toast, onBack, onClaim, onDispute }: { entries: LedgerEntry[]; totals: { recorded: number; disputed: number; undisputed: number }; verified: boolean; toast: string | null; onBack: () => void; onClaim: () => void; onDispute: (id: number) => void; }) {
  return <main className="client-view"><header className="simple-header"><button className="icon-button" onClick={onBack}><ArrowLeftIcon /></button><div><span>Relevé privé</span><strong>Boutique Diallo</strong></div><LockClosedIcon /></header>{toast ? <div className="toast"><CheckCircledIcon /> {toast}</div> : null}<section className="client-welcome"><span>Bonjour Mamadou</span><h1>Votre carnet chez Boutique Diallo</h1><p>Ce relevé est en lecture seule.</p></section><BalanceSummary totals={totals} compact />{!verified ? <button className="claim-card" onClick={onClaim}><MobileIcon /><div><strong>Vérifier mon numéro</strong><span>Regrouper plus tard mes différentes boutiques</span></div><ChevronRightIcon /></button> : <div className="verified-card"><CheckCircledIcon /> Numéro WhatsApp vérifié</div>}<section className="journal-section client-journal"><div className="section-heading"><h3>Historique complet</h3><span>Lecture seule</span></div>{entries.map((entry) => <div className="client-entry" key={entry.id}><JournalRow entry={entry} />{entry.kind === "debt" && !entry.disputed ? <button className="dispute-link" onClick={() => onDispute(entry.id)}>Je ne reconnais pas cette opération</button> : null}</div>)}</section></main>;
}

function BalanceSummary({ totals, compact = false }: { totals: { recorded: number; disputed: number; undisputed: number }; compact?: boolean }) {
  return <section className={`balance-summary ${compact ? "compact" : ""}`}><div className="recorded"><span>Solde enregistré</span><strong>{money(totals.recorded)}</strong><small>Dimanche 30 août 2026</small></div><div className="balance-split"><div className="contested"><span>dont contestés</span><strong>{money(totals.disputed)}</strong></div><div><span>non contesté</span><strong>{money(totals.undisputed)}</strong></div></div></section>;
}

function JournalRow({ entry, onClick }: { entry: LedgerEntry; onClick?: () => void }) {
  const Icon = entry.kind === "payment" ? ReaderIcon : entry.kind === "correction" ? ReloadIcon : BackpackIcon;
  return <button className={`journal-row ${entry.kind} ${entry.disputed ? "disputed" : ""}`} onClick={onClick} disabled={!onClick}><span className="entry-icon"><Icon /></span><span className="entry-copy"><strong>{entry.title}</strong><small>{entry.detail}</small>{entry.disputed ? <em>Contestée par le client</em> : null}</span><span className="entry-meta"><small>{entry.date}<br />{entry.time}</small><strong>{entry.amount < 0 ? "− " : ""}{money(entry.amount)}</strong></span>{onClick ? <ChevronRightIcon className="row-chevron" /> : null}</button>;
}

function FormScreen({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return <main className="form-screen"><header className="simple-header"><button className="icon-button" onClick={onBack}><ArrowLeftIcon /></button><h1>{title}</h1><span /></header>{children}</main>;
}

function ClientMini() {
  return <div className="client-mini"><img src="/assets/app/mamadou-diop.png" alt="" /><div><span>Client</span><strong>Mamadou Diop</strong><small>77 123 45 67 · numéro non vérifié</small></div><CheckCircledIcon /></div>;
}
