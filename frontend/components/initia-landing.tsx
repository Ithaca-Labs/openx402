import Link from "next/link";

import { Cta } from "./landing-cta";
import styles from "./initia-landing.module.css";

const ASSET = "https://initia.xyz";
function PixelGlyph({className=""}:{className?:string}){return <svg aria-hidden="true" className={className} viewBox="0 0 48 48" fill="currentColor"><path d="M20 2h8v4h-8zM16 6h16v4H16zM12 10h8v4h-8zM28 10h8v4h-8zM8 14h8v4H8zM32 14h8v4h-8zM4 18h8v12H4zM36 18h8v12h-8zM8 30h8v4H8zM32 30h8v4h-8zM12 34h8v4h-8zM28 34h8v4h-8zM16 38h16v4H16zM20 42h8v4h-8zM18 18h12v12H18z"/></svg>}
function Arrow(){return <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><path d="M12 7 0 .072v13.856L12 7Z"/></svg>}
function FeatureCard({title,image,href,tone}:{title:string;image:string;href:string;tone:"discover"|"economy"}){return <a className={`${styles.featureCard} ${styles[`featureCard--${tone}`]}`} href={href}><span className={styles.featureFront}><img src={`${ASSET}/images/decoration/${image}`} alt=""/><span className={styles.featureShade}/><PixelGlyph className={styles.featureGlyph}/><span className={styles.featureTitle}><em>openx402</em><strong>{title}</strong></span></span></a>}
function Socials(){return <nav className={styles.socials} aria-label="openx402 social links"><a aria-label="Follow openx402 on X" href="https://x.com/openx402stellar" target="_blank" rel="noreferrer"><b>𝕏</b><span>@openx402stellar</span></a></nav>}

export default function InitiaLanding(){return <div className={styles.page}>
  <header className={styles.header}><Link className={styles.logo} href="/" aria-label="openx402 home"><img src="/brand/logo/lockup-primary-dark.svg" alt="openx402"/></Link></header>
  <main className={styles.shell}><div className={styles.inner}><div className={styles.contentGrid}>
    <section className={styles.hero}><img className={styles.heroArt} src={`${ASSET}/images/decoration/KV.png`} alt=""/><div className={styles.heroContent}><h1>The x402 suite for everyone</h1><p>openx402 makes x402 on Stellar yours to run, yours to discover through, and yours to build on.</p><div className={styles.actions}><Cta href="https://docs.stellarx402.xyz/">Build</Cta><Cta href="/discover">Start</Cta></div></div><a className={styles.diamond} href="/discover" aria-label="Discover openx402 services"><img src="/brand/logo/mark-yellow.svg" alt=""/></a></section>
    <a className={styles.mobileEcosystem} href="/discover"><img src="/brand/logo/mark-yellow.svg" alt=""/><strong>openx402</strong><Arrow/></a><Socials/>
    <aside className={styles.rail} aria-label="Explore openx402"><div className={styles.cards}><FeatureCard title="Discover" image="card-bg-stack.png" href="/discover" tone="discover"/><FeatureCard title="Economy" image="card-bg-economy.png" href="/ecosystem" tone="economy"/></div><div className={styles.railBottom}><Socials/><div className={styles.motionMark}><img src={`${ASSET}/images/decoration/line-bg.svg`} alt=""/><img src="/brand/logo/mark-yellow.svg" alt="openx402 mark"/></div></div></aside>
  </div><footer className={styles.footer}><div className={styles.brandLine}><img src="/brand/logo/lockup-primary-dark.svg" alt="openx402"/><span>open source</span><span>Stellar</span><span>x402</span></div><div className={styles.legal}><a href="/privacy-policy">Privacy Policy</a><a href="/terms-of-use">Terms of Use</a></div></footer></div></main>
</div>}
