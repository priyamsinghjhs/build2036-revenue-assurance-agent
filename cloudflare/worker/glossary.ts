import type { AuthCtx } from "./auth";

/** Short plain-language terms for the UI glossary. */
const TERMS: { term: string; definition: string }[] = [
  { term: "APM", definition: "Alternative payment method (wallets, BNPL, and similar rails that settle outside card networks)." },
  { term: "Authorization", definition: "The issuer or scheme approval to hold funds, recorded before capture and settlement." },
  { term: "Capture", definition: "The request to take the authorized funds so they can settle into the merchant's payout." },
  { term: "Exception", definition: "A recon or control break that this app has raised for review, such as a missing settlement or a fee mismatch." },
  { term: "GL", definition: "The general ledger: the accounting books that should match settlement, fee, and payout amounts." },
  { term: "Invoicing", definition: "Billing of scheme, acquirer, or other fees that should match the contracted rate and the settled volume." },
  { term: "Leakage", definition: "Money the acquirer should have received or retained but that is missing, delayed, or under-paid." },
  { term: "Maker-checker", definition: "A two-person control: one user proposes an action and a second user must approve it before it takes effect." },
  { term: "PAN", definition: "Primary account number (the card number). This app stores and shows only a masked form." },
  { term: "Recon", definition: "Reconciliation: matching transactions, authorizations, settlements, and the ledger so every rupee is accounted for." },
  { term: "Scheme", definition: "The card network (for example Visa or Mastercard) whose fees and settlement reports are reconciled here." },
  { term: "Settlement", definition: "The transfer of captured funds from the scheme or partner into the acquirer's or merchant's account." },
];

export function handleGlossary(c: AuthCtx) {
  return c.json({ terms: TERMS });
}
