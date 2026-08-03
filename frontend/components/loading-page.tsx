import { AppShell, PageContainer } from "@/components/explorer-shell";
import { Card, Skeleton } from "@/components/ui";

export function LoadingPage({ title }: { title: string }) {
  return (
    <AppShell>
      <PageContainer className="data-page" >
        <section aria-label={`Loading ${title}`} className="page-header"><div><h1>{title}</h1><p>Loading live facilitator data…</p></div></section>
        <section className="section-block section-block--compact" aria-busy="true">
          <div className="metric-grid">{Array.from({ length: 4 }, (_, index) => <Card className="metric-card loading-card" key={index}><Skeleton className="loading-card__label" /><Skeleton className="loading-card__value" /></Card>)}</div>
        </section>
        <Card className="state-panel"><Skeleton className="loading-panel__line" /><Skeleton className="loading-panel__line loading-panel__line--short" /></Card>
      </PageContainer>
    </AppShell>
  );
}
