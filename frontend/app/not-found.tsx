import { Cta } from "@/components/landing-cta";
import { LegalShell } from "@/components/legal-shell";
import styles from "@/components/initia-landing.module.css";

export default function NotFound() {
  return (
    <LegalShell>
      <div className={styles.notFound}>
        <span className={styles.notFoundCode} aria-hidden="true">404</span>
        <h1>This page doesn&rsquo;t exist</h1>
        <p>The page you asked for was moved, renamed, or never existed. The catalog is still where you left it.</p>
        <div className={styles.notFoundActions}>
          <Cta href="/">Home</Cta>
          <Cta href="/discover">Discover</Cta>
        </div>
      </div>
    </LegalShell>
  );
}
