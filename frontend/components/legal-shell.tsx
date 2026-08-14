import Link from "next/link";

import styles from "./initia-landing.module.css";

function LegalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.brandLine}>
        <img src="/brand/logo/lockup-primary-dark.svg" alt="openx402" />
        <span>open source</span>
        <span>Stellar</span>
        <span>x402</span>
      </div>
      <div className={styles.legal}>
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-of-use">Terms of Use</a>
      </div>
    </footer>
  );
}

/** Dark landing-theme chrome (fixed header + legal footer) shared by the legal pages and the 404. */
export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="openx402 home">
          <img src="/brand/logo/lockup-primary-dark.svg" alt="openx402" />
        </Link>
      </header>
      <main className={styles.legalShell}>
        <div className={styles.legalInner}>
          {children}
          <LegalFooter />
        </div>
      </main>
    </div>
  );
}

/** Title block + prose wrapper for a legal document. */
export function LegalDocument({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <div className={styles.legalHead}>
        <h1>{title}</h1>
        <span className={styles.legalUpdated}>Last updated {updated}</span>
      </div>
      <div className={styles.legalBody}>{children}</div>
    </>
  );
}
