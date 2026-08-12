import { AppShell, PageContainer } from "@/components/explorer-shell";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <AppShell>
      <PageContainer className="discover-page">
        <section aria-label="Loading Discover" className="discover-hero discover-loading-hero">
          <Skeleton className="discover-loading-hero__title" />
          <Skeleton className="discover-loading-hero__subtitle" />
        </section>
        <div aria-busy="true" className="discover-directory discover-loading-directory">
          <section className="discover-services">
            <div className="discover-toolbar discover-loading-toolbar"><Skeleton /><Skeleton /><span /><span /><Skeleton /></div>
            <div className="services-list-heading"><span>Provider</span><span>Description</span><span>Service URL</span></div>
            <div className="discover-loading-list">
              {Array.from({ length: 7 }, (_, index) => <div className="discover-loading-row" key={index}><Skeleton className="discover-loading-row__provider" /><Skeleton className="discover-loading-row__description" /><Skeleton className="discover-loading-row__url" /></div>)}
            </div>
          </section>
          <aside className="discovery-aside">
            <div className="discover-loading-aside"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
            <div className="discover-loading-aside discover-loading-aside--short"><Skeleton /><Skeleton /></div>
          </aside>
        </div>
      </PageContainer>
    </AppShell>
  );
}
