export interface BroadcastJournal {
  pendingBroadcast?: string;
  transactions: Array<{ action?: string }>;
}

export function reserveBroadcast(journal: BroadcastJournal, action: string) {
  if (journal.pendingBroadcast)
    throw new Error("Unresolved wallet broadcast; inspect burner nonce before any retry");
  if (
    (action === "deposit" || action === "requestPayout") &&
    journal.transactions.some((transaction) => transaction.action === action)
  )
    throw new Error("Fund operation already broadcast; refusing duplicate");
  journal.pendingBroadcast = action;
}
