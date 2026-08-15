"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";

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

const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  A: ["01110", "10001", "11111", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "11110", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "11100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "11110", "10000", "10000"],
  R: ["11110", "10001", "11110", "10010", "10001"],
  S: ["01111", "10000", "01110", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "01010", "00100"],
  Y: ["10001", "01010", "00100", "00100", "00100"],
};

export function PixelTitle({ title, className }: { title: string; className?: string }) {
  const letters = Array.from(title.toUpperCase());
  const width = letters.length * 6 - 1;

  return (
    <svg aria-hidden="true" className={cn("pixel-title", className)} preserveAspectRatio="none" viewBox={`0 0 ${width} 5`} xmlns="http://www.w3.org/2000/svg">
      {letters.flatMap((letter, letterIndex) => {
        const glyph = PIXEL_GLYPHS[letter];
        if (!glyph) return [];
        return glyph.flatMap((row, rowIndex) => Array.from(row).flatMap((pixel, pixelIndex) => (
          pixel === "1" ? <rect fill="currentColor" height="0.78" key={`${letterIndex}-${rowIndex}-${pixelIndex}`} width="0.94" x={letterIndex * 6 + pixelIndex} y={rowIndex + 0.11} /> : []
        )));
      })}
    </svg>
  );
}

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
        <Link className="brand-lockup" href="/" onClick={() => setMenuOpen(false)}>
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
  pixelTitle = false,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  pixelTitle?: boolean;
}) {
  return (
    <section className="page-header" aria-labelledby="page-title">
      <div>
        {pixelTitle ? <PixelTitle title={title} /> : null}
        <h1 className={pixelTitle ? "sr-only" : undefined} id="page-title">{title}</h1>
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

/**
 * Values sit at band centres rather than spanning edge to edge, so each bar has
 * room either side and the curve passes through the middle of its own bar.
 *
 * Heights are measured from zero, not from the smallest value in the series.
 * Normalising to the range would put the lowest reading flat on the baseline —
 * a bar of no height, reading as "nothing happened" when it may be most of the
 * largest bar.
 */
function metricPoints(values: number[], width: number, height: number, padTop: number, padBottom: number) {
  const max = Math.max(...values, 0);
  const plot = height - padTop - padBottom;
  const band = width / values.length;
  return {
    band,
    baseline: height - padBottom,
    points: values.map((value, index) => ({
      x: (index + 0.5) * band,
      y: max > 0 ? padTop + (1 - value / max) * plot : height - padBottom,
    })),
  };
}

/**
 * Monotone cubic interpolation: tangents are clamped so the curve never
 * overshoots a data point. A plain Catmull-Rom spline would invent peaks the
 * underlying series does not contain, which on a metric chart reads as data.
 */
function smoothPath(points: Array<{ x: number; y: number }>, width: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M0 ${points[0]!.y.toFixed(2)} L${width} ${points[0]!.y.toFixed(2)}`;
  if (points.length === 2) return `M${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)} L${points[1]!.x.toFixed(2)} ${points[1]!.y.toFixed(2)}`;

  const slopes = points.map((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
    if (!previous || !next) {
      const neighbour = next ?? previous!;
      return (neighbour.y - point.y) / (neighbour.x - point.x);
    }
    const left = (point.y - previous.y) / (point.x - previous.x);
    const right = (next.y - point.y) / (next.x - point.x);
    // A local extremum gets a flat tangent, which is what prevents overshoot.
    return left * right <= 0 ? 0 : (left + right) / 2;
  });

  let path = `M${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const third = (end.x - start.x) / 3;
    const c1x = start.x + third;
    const c1y = start.y + slopes[index - 1]! * third;
    const c2x = end.x - third;
    const c2y = end.y - slopes[index]! * third;
    path += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }
  return path;
}

/**
 * Smooth trend line for a metric box. A metric with no series still reserves the
 * slot, so numbers stay on one baseline across the row instead of drifting in
 * whichever box happens to lack a chart.
 */
export function MetricSparkline({ points, label, unit }: { points: number[]; label: string; unit?: string }) {
  const gradientId = `metric-${useId().replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div aria-label={`${label} is a current snapshot without a time series`} className="metric-sparkline metric-sparkline--empty" role="img">
        <span /><span /><span /><span /><span /><span />
        <em>Snapshot</em>
      </div>
    );
  }

  const width = 320;
  const height = 112;
  const { baseline, band, points: plotted } = metricPoints(points, width, height, 10, 1);
  const line = smoothPath(plotted, width);
  const first = plotted[0]!;
  const last = plotted.at(-1)!;
  const area = `${line} L${last.x.toFixed(2)} ${baseline} L${first.x.toFixed(2)} ${baseline} Z`;
  const max = Math.max(...points, 0);
  const latest = points.at(-1) ?? 0;
  const selected = activeIndex === null ? null : plotted[activeIndex];
  const selectedValue = activeIndex === null ? null : points[activeIndex];
  const selectedLabel = activeIndex === null ? "" : activeIndex === points.length - 1 ? "Now" : `${points.length - activeIndex - 1}d ago`;

  function moveSelection(clientX: number, bounds: DOMRect) {
    const fraction = Math.min(0.999, Math.max(0, (clientX - bounds.left) / bounds.width));
    setActiveIndex(Math.min(points.length - 1, Math.floor(fraction * points.length)));
  }

  function formatValue(value: number) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: unit ? 7 : 2,
      notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    }).format(value);
  }

  function formatPointValue(value: number) {
    return `${formatValue(value)}${unit ? ` ${unit}` : ""}`;
  }

  return (
    <div
      aria-label={`${label}, 30-day trend. Peak ${formatPointValue(max)}; latest ${formatPointValue(latest)}. Use left and right arrow keys to inspect.`}
      className="metric-sparkline"
      onBlur={() => setActiveIndex(null)}
      onFocus={() => setActiveIndex(points.length - 1)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = activeIndex ?? points.length - 1;
        setActiveIndex(Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1))));
      }}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerMove={(event) => moveSelection(event.clientX, event.currentTarget.getBoundingClientRect())}
      role="img"
      tabIndex={0}
    >
      <svg
        aria-hidden="true"
        className="metric-sparkline__curve"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.34" />
            <stop offset="72%" stopColor="var(--color-accent)" stopOpacity="0.07" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(fraction => (
          <line className="metric-sparkline__grid" key={fraction} x1="0" x2={width} y1={(height - 1) * fraction} y2={(height - 1) * fraction} />
        ))}
        <path className="metric-sparkline__area" d={area} fill={`url(#${gradientId})`} />
        <path className="metric-sparkline__line" d={line} />
        {selected ? (
          <>
            <rect className="metric-sparkline__selection" height={height} width={band} x={selected.x - band / 2} y="0" />
            <line className="metric-sparkline__crosshair" x1={selected.x} x2={selected.x} y1="0" y2={height} />
          </>
        ) : null}
      </svg>
      <div aria-hidden="true" className="metric-sparkline__bars">
        {points.map((value, index) => (
          <span
            className={cn("metric-sparkline__bar", index === activeIndex && "metric-sparkline__bar--active")}
            key={index}
            style={{
              height: max > 0 ? `${Math.max(2, (value / max) * 100)}%` : "2%",
              animationDelay: `${index * Math.min(55, 180 / points.length)}ms`,
            }}
          />
        ))}
      </div>
      <span
        aria-hidden="true"
        className="metric-sparkline__latest"
        style={{ left: `${(last.x / width) * 100}%`, top: `${(last.y / height) * 100}%` }}
      />
      {selected ? (
        <span
          aria-hidden="true"
          className="metric-sparkline__active-dot"
          style={{ left: `${(selected.x / width) * 100}%`, top: `${(selected.y / height) * 100}%` }}
        />
      ) : null}
      {selected && selectedValue !== null ? (
        <span
          aria-live="polite"
          className={cn(
            "metric-sparkline__tooltip",
            activeIndex === 0 && "metric-sparkline__tooltip--start",
            activeIndex === points.length - 1 && "metric-sparkline__tooltip--end",
          )}
          style={{ left: `${(selected.x / width) * 100}%` }}
        >
          <small>{selectedLabel}</small>
          <strong>{formatPointValue(selectedValue)}</strong>
        </span>
      ) : null}
    </div>
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
        <Link className="footer-brand" href="/">
          <Image alt="" height={22} src="/brand/logo/mark-yellow.svg" width={22} />
          <span>openx402</span>
        </Link>
        <div className="footer-note">Ecosystem explorer for open payment infrastructure.</div>
        <div className="footer-links">
          <a href="https://github.com" rel="noreferrer noopener" target="_blank">Repository <ArrowRightIcon size={14} /></a>
          <a href="https://stellar.org" rel="noreferrer noopener" target="_blank">Stellar <ArrowRightIcon size={14} /></a>
          <Link href="/privacy-policy">Privacy</Link>
          <Link href="/terms-of-use">Terms</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 openx402</span>
        <span className="mono">BUILD 0.1 / OBSERVER MODE</span>
      </div>
    </footer>
  );
}
