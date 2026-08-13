import { AppShell, PageContainer, PageHeader } from "@/components/explorer-shell";
import { Skeleton } from "@/components/ui";

type LoadingVariant = "all" | "marketplace" | "transactions" | "ecosystem";

export function LoadingPage({ title, variant = "all" }: { title: string; variant?: LoadingVariant }) {
  return (
    <AppShell>
      <PageContainer className={`data-page directory-page directory-page--${variant} directory-loading-page`}>
        <PageHeader description="Loading live facilitator data…" pixelTitle title={title} />
        {variant === "all" ? <AllLoading /> : variant === "marketplace" ? <MarketplaceLoading /> : variant === "transactions" ? <TransactionsLoading /> : <EcosystemLoading />}
      </PageContainer>
    </AppShell>
  );
}

function AllLoading() {
  return <div className="all-activity-directory" aria-busy="true">
    <section className="all-activity-main">
      <div className="all-activity-summary"><div className="all-activity-summary__metrics">{Array.from({ length: 4 }, (_, index) => <div className="loading-summary-cell" key={index}><Skeleton /><Skeleton /><Skeleton /></div>)}</div></div>
      <div className="all-activity-ledger loading-ledger"><LoadingLedgerRows /></div>
    </section>
    <aside className="all-activity-aside loading-aside"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></aside>
  </div>;
}

function MarketplaceLoading() {
  return <section className="marketplace-catalog marketplace-loading-directory" aria-busy="true">
    <div className="marketplace-catalog__heading loading-section-heading"><Skeleton /><Skeleton /></div>
    <div className="loading-toolbar"><Skeleton /><Skeleton /><Skeleton /></div>
    <div className="directory-grid">{Array.from({ length: 5 }, (_, index) => <div className="marketplace-card loading-marketplace-card" key={index}><Skeleton /><Skeleton /><Skeleton /></div>)}</div>
  </section>;
}

function TransactionsLoading() {
  return <>
    <section className="transaction-desk" aria-busy="true"><div className="transaction-desk__bar loading-transaction"><Skeleton /><span><Skeleton /><Skeleton /></span><Skeleton /></div><div className="transaction-desk__stats">{Array.from({ length: 3 }, (_, index) => <span className="loading-stat" key={index}><Skeleton /><Skeleton /><Skeleton /></span>)}</div></section>
    <section className="transaction-ledger loading-ledger" aria-busy="true"><div className="transaction-ledger__heading loading-section-heading"><Skeleton /><Skeleton /></div><LoadingLedgerRows /></section>
  </>;
}

function EcosystemLoading() {
  return <>
    <section className="ecosystem-atlas" aria-busy="true"><div className="ecosystem-atlas__heading loading-section-heading"><Skeleton /><Skeleton /></div><div className="ecosystem-groups">{Array.from({ length: 3 }, (_, index) => <div className="ecosystem-group loading-ecosystem-group" key={index}><Skeleton /><Skeleton /><Skeleton /></div>)}</div></section>
    <section className="ecosystem-directory-section loading-ledger" aria-busy="true"><div className="ecosystem-directory-section__heading loading-section-heading"><Skeleton /><Skeleton /></div><LoadingLedgerRows /></section>
  </>;
}

function LoadingLedgerRows() {
  return <div className="loading-ledger__rows">{Array.from({ length: 6 }, (_, index) => <div className="loading-ledger__row" key={index}><Skeleton /><Skeleton /><Skeleton /></div>)}</div>;
}
