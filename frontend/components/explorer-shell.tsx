"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  ActivityIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CommandIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
  XIcon,
} from "@/components/icons";
import { Bar, BarBaseline, BarChart } from "@/components/charts";
import { navItems, type Metric } from "@/components/data";
import { SiteAnalyticsTracker } from "@/components/site-analytics-tracker";
import { Badge, Card, cn } from "@/components/ui";

type Theme = "dark" | "light";

const ENTITY_AVATAR_API = "https://api.dicebear.com/10.x/identicon/svg";

const themeListeners = new Set<() => void>();
const themeStore = {
  getSnapshot: (): Theme =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark",
  getServerSnapshot: (): Theme => "dark",
  subscribe: (listener: () => void) => {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  },
  set: (theme: Theme) => {
    document.documentElement.dataset.theme = theme;
    themeListeners.forEach((listener) => listener());

    try {
      window.localStorage.setItem("openx402-theme", theme);
    } catch {
      // Keep the current theme for this session when storage is unavailable.
    }
  },
};

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-frame">
      <SiteAnalyticsTracker />
      <SiteHeader />
      <main className="site-main" data-site-analytics-impression>{children}</main>
      <SiteFooter />
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);

  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem("openx402-theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        themeStore.set(storedTheme);
      }
    } catch {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    themeStore.set(nextTheme);
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand-lockup" href="/discover" onClick={() => setMenuOpen(false)}>
          <Image
            alt="openx402"
            className="brand-lockup__image brand-lockup__image--light"
            height={26}
            priority
            src="/brand/logo/lockup-primary-light.svg"
            width={130}
          />
          <Image
            alt=""
            aria-hidden="true"
            className="brand-lockup__image brand-lockup__image--dark"
            height={26}
            priority
            src="/brand/logo/lockup-primary-dark.svg"
            width={130}
          />
        </Link>

        <nav
          aria-label="Primary navigation"
          className={cn("primary-navigation", menuOpen && "primary-navigation--open")}
          id="primary-navigation"
        >
          {navItems.map((item) => {
            const active = !item.external && (pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn("nav-link", active && "nav-link--active")}
                href={item.href}
                key={item.href}
                onClick={() => setMenuOpen(false)}
                rel={item.external ? "noreferrer noopener" : undefined}
                target={item.external ? "_blank" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-tools">
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            type="button"
          >
            {theme === "dark" ? <SunIcon aria-hidden="true" size={16} /> : <MoonIcon aria-hidden="true" size={16} />}
          </button>
        </div>

        <button
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          className="menu-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? <XIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>
    </header>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("page-container", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="page-header" aria-labelledby="page-title">
      <div>
        <h1 id="page-title">{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </section>
  );
}

export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("section-heading", className)}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  );
}

export function MetricCard({ metric, featured = false }: { metric: Metric; featured?: boolean }) {
  return (
    <Card className={cn("metric-card", featured && "metric-card--featured")}>
      <div className="metric-card__header">
        <span className="metric-card__label">
          <span aria-hidden="true" className="metric-card__signal" />
          {metric.label}
        </span>
        <span
          aria-label={`${metric.delta} over ${metric.context}`}
          className={cn("metric-delta", metric.trend === "flat" && "metric-delta--flat")}
        >
          {metric.delta}
        </span>
      </div>
      <div className="metric-card__value-row">
        <div className="metric-card__value">{metric.value}</div>
        <span className="metric-card__context">{metric.context}</span>
      </div>
      {metric.bars.length
        ? <MetricChart bars={metric.bars} label={metric.label} range={metric.context} />
        : <div className="metric-chart-empty">Current snapshot</div>}
      <div className="metric-card__footer" aria-hidden="true">
        <span className="metric-card__footer-label"><ActivityIcon size={13} /> {metric.bars.length ? "Trend" : "Snapshot"}</span>
        {metric.bars.length ? <span className="metric-card__range"><span>30d ago</span><span>Now</span></span> : null}
      </div>
    </Card>
  );
}

export function MetricChart({ bars, label, range }: { bars: number[]; label: string; range: string }) {
  const data = bars.map((value, index) => ({ label: String(index), value }));

  return (
    <BarChart
      ariaLabel={`${label} trend over ${range}`}
      className="metric-bar-chart"
      data={data}
      xDataKey="label"
    >
      <BarBaseline />
      <Bar
        dataKey="value"
        fill="var(--color-accent)"
        fillOpacity={0.4}
        lineCap="butt"
        stroke="var(--color-chart-bar-stroke)"
        strokeWidth={1.3}
      />
    </BarChart>
  );
}

export function Sparkline({
  points,
  className,
}: {
  points: number[];
  className?: string;
}) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 26 - ((point - min) / range) * 21;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className={cn("sparkline", className)}
      preserveAspectRatio="none"
      viewBox="0 0 100 28"
    >
      <path className="sparkline__fill" d={`${path} L100 28 L0 28 Z`} />
      <path className="sparkline__line" d={path} />
    </svg>
  );
}

export function EntityLogo({
  name,
  accent = "yellow",
  size = "md",
}: {
  name: string;
  accent?: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const imageSize = size === "sm" ? 27 : size === "lg" ? 46 : 34;
  const imageSrc = `${ENTITY_AVATAR_API}?backgroundColor=ffd21c&backgroundType=solid&radius=18&seed=${encodeURIComponent(name)}`;

  return (
    <span aria-hidden="true" className={cn("entity-logo", `entity-logo--${accent}`, `entity-logo--${size}`)}>
      {imageFailed ? (
        <span className="entity-logo__fallback">{initials}</span>
      ) : (
        <Image
          alt=""
          aria-hidden="true"
          className="entity-logo__image"
          height={imageSize}
          onError={() => setImageFailed(true)}
          src={imageSrc}
          unoptimized
          width={imageSize}
        />
      )}
    </span>
  );
}

export function StatusBadge({ state }: { state: "settled" | "pending" | "failed" | "online" | "limited" | "preview" }) {
  const label = state === "settled" ? "Settled" : state === "pending" ? "Pending" : state;
  const tone = state === "settled" || state === "online" ? "success" : state === "pending" ? "signal" : state === "failed" ? "danger" : "neutral";

  return (
    <Badge className="status-badge" tone={tone}>
      <span aria-hidden="true" className="status-badge__dot" />
      {label}
    </Badge>
  );
}

export function TimeControl({ label = "Last 30 days" }: { label?: string }) {
  return (
    <button className="control-button" type="button">
      <span>{label}</span>
      <ChevronDownIcon size={15} />
    </button>
  );
}

export function CommandHint() {
  return (
    <span className="command-hint" aria-hidden="true">
      <CommandIcon size={13} /> K
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Image alt="" height={22} src="/brand/logo/mark-yellow.svg" width={22} />
          <span>openx402</span>
        </div>
        <div className="footer-note">Ecosystem explorer for open payment infrastructure.</div>
        <div className="footer-links">
          <a href="https://github.com" rel="noreferrer noopener" target="_blank">Repository <ArrowRightIcon size={14} /></a>
          <a href="https://stellar.org" rel="noreferrer noopener" target="_blank">Stellar <ArrowRightIcon size={14} /></a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 openx402</span>
        <span className="mono">BUILD 0.1 / OBSERVER MODE</span>
      </div>
    </footer>
  );
}
