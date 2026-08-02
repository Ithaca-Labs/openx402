"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/components/ui";

export type ChartDatum = Record<string, string | number | Date | null | undefined>;

type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type Point = {
  x: number;
  y: number;
  value: number;
};

const AREA_WIDTH = 1000;
const AREA_HEIGHT = 340;
const AREA_MARGIN: Margin = { top: 24, right: 36, bottom: 48, left: 56 };
const BAR_WIDTH = 1000;
const BAR_HEIGHT = 220;
const BAR_MARGIN: Margin = { top: 18, right: 24, bottom: 36, left: 24 };

function getNumber(value: ChartDatum[string]) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function getLabel(value: ChartDatum[string]) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
  }

  return String(value ?? "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatKey(dataKey: string) {
  return dataKey
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function linePath(points: Point[]) {
  return points
    .map((point, index) => {
      if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;

      const previous = points[index - 1];
      const distance = (point.x - previous.x) * 0.42;

      return [
        `C ${(previous.x + distance).toFixed(2)} ${previous.y.toFixed(2)}`,
        `${(point.x - distance).toFixed(2)} ${point.y.toFixed(2)}`,
        `${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      ].join(" ");
    })
    .join(" ");
}

type AreaSeries = {
  dataKey: string;
  fill: string;
  stroke: string;
  fillOpacity: number;
  strokeWidth: number;
  showLine: boolean;
  label?: string;
};

type AreaChartContextValue = {
  data: ChartDatum[];
  xDataKey: string;
  margin: Margin;
  plotWidth: number;
  plotHeight: number;
  x: (index: number) => number;
  y: (value: number) => number;
  maxValue: number;
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
  series: AreaSeries[];
  chartId: string;
};

const AreaChartContext = createContext<AreaChartContextValue | null>(null);

function useAreaChart() {
  const context = useContext(AreaChartContext);
  if (!context) throw new Error("Area chart components must be rendered inside AreaChart.");
  return context;
}

function collectAreaSeries(children: ReactNode) {
  const series: AreaSeries[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement<AreaProps>(child) || child.type !== Area) return;
    series.push({
      dataKey: child.props.dataKey,
      fill: child.props.fill ?? "var(--color-accent)",
      stroke: child.props.stroke ?? child.props.fill ?? "var(--color-accent)",
      fillOpacity: child.props.fillOpacity ?? 0.3,
      strokeWidth: child.props.strokeWidth ?? 2,
      showLine: child.props.showLine ?? true,
      label: child.props.label,
    });
  });

  return series;
}

export function AreaChart({
  data,
  xDataKey = "date",
  margin,
  aspectRatio = "3.1 / 1",
  className,
  ariaLabel = "Area chart",
  children,
}: {
  data: ChartDatum[];
  xDataKey?: string;
  margin?: Partial<Margin>;
  aspectRatio?: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const id = cleanId(useId());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const marginTop = margin?.top ?? AREA_MARGIN.top;
  const marginRight = margin?.right ?? AREA_MARGIN.right;
  const marginBottom = margin?.bottom ?? AREA_MARGIN.bottom;
  const marginLeft = margin?.left ?? AREA_MARGIN.left;
  const resolvedMargin = useMemo(() => ({ top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft }), [marginBottom, marginLeft, marginRight, marginTop]);
  const plotWidth = AREA_WIDTH - resolvedMargin.left - resolvedMargin.right;
  const plotHeight = AREA_HEIGHT - resolvedMargin.top - resolvedMargin.bottom;
  const series = useMemo(() => collectAreaSeries(children), [children]);
  const maxValue = Math.max(1, ...series.flatMap((item) => data.map((datum) => getNumber(datum[item.dataKey]))));
  const x = useCallback((index: number) => resolvedMargin.left + (index / Math.max(data.length - 1, 1)) * plotWidth, [data.length, plotWidth, resolvedMargin.left]);
  const y = useCallback((value: number) => resolvedMargin.top + plotHeight - (value / maxValue) * plotHeight, [maxValue, plotHeight, resolvedMargin.top]);
  const context = useMemo<AreaChartContextValue>(
    () => ({
      data,
      xDataKey,
      margin: resolvedMargin,
      plotWidth,
      plotHeight,
      x,
      y,
      maxValue,
      activeIndex,
      setActiveIndex,
      series,
      chartId: `area-${id}`,
    }),
    [activeIndex, data, id, maxValue, plotHeight, plotWidth, resolvedMargin, series, x, xDataKey, y],
  );

  return (
    <div
      aria-label={ariaLabel}
      className={cn("chart-frame chart-frame--area", className)}
      role="img"
      style={{ "--chart-aspect-ratio": aspectRatio } as CSSProperties}
    >
      <svg aria-hidden="true" className="chart-svg" preserveAspectRatio="none" viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`}>
        <AreaChartContext.Provider value={context}>
          <g>{children}</g>
        </AreaChartContext.Provider>
      </svg>
    </div>
  );
}

export type AreaProps = {
  dataKey: string;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  showLine?: boolean;
  label?: string;
};

export function Area({
  dataKey,
  fill = "var(--color-accent)",
  fillOpacity = 0.3,
  stroke = fill,
  strokeWidth = 2,
  showLine = true,
}: AreaProps) {
  const context = useAreaChart();
  const points = context.data.map((datum, index) => ({
    x: context.x(index),
    y: context.y(getNumber(datum[dataKey])),
    value: getNumber(datum[dataKey]),
  }));
  const path = linePath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const baseline = context.y(0);
  const areaPath = points.length
    ? `${path} L ${lastPoint.x.toFixed(2)} ${baseline.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baseline.toFixed(2)} Z`
    : "";
  const gradientId = `${context.chartId}-${cleanId(dataKey)}-gradient`;

  if (!points.length) return null;

  return (
    <g className="area-series">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="area-series__fill" d={areaPath} fill={`url(#${gradientId})`} />
      {showLine ? (
        <path
          className="area-series__line"
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          style={{ "--area-stroke": stroke } as CSSProperties}
        />
      ) : null}
    </g>
  );
}

export function Grid({
  horizontal = true,
  vertical = false,
  numTicksRows = 4,
  numTicksColumns = 6,
}: {
  horizontal?: boolean;
  vertical?: boolean;
  numTicksRows?: number;
  numTicksColumns?: number;
}) {
  const areaContext = useContext(AreaChartContext);
  const barContext = useContext(BarChartContext);

  if (areaContext) {
    return <AreaGrid context={areaContext} horizontal={horizontal} vertical={vertical} numTicksRows={numTicksRows} numTicksColumns={numTicksColumns} />;
  }

  if (barContext) {
    return <BarGrid context={barContext} horizontal={horizontal} vertical={vertical} numTicksRows={numTicksRows} numTicksColumns={numTicksColumns} />;
  }

  return null;
}

function AreaGrid({
  context,
  horizontal,
  vertical,
  numTicksRows,
  numTicksColumns,
}: {
  context: AreaChartContextValue;
  horizontal: boolean;
  vertical: boolean;
  numTicksRows: number;
  numTicksColumns: number;
}) {
  const rowTicks = Array.from({ length: Math.max(2, numTicksRows) }, (_, index) => index / Math.max(numTicksRows - 1, 1));
  const columnTicks = Array.from({ length: Math.max(2, numTicksColumns) }, (_, index) => index / Math.max(numTicksColumns - 1, 1));

  return (
    <g className="chart-grid" pointerEvents="none">
      {horizontal
        ? rowTicks.map((fraction) => {
            const value = context.maxValue * (1 - fraction);
            const y = context.margin.top + context.plotHeight * fraction;
            return (
              <g key={`row-${fraction}`}>
                <line className="chart-grid__line" x1={context.margin.left} x2={AREA_WIDTH - context.margin.right} y1={y} y2={y} />
                <text className="chart-axis-label chart-axis-label--y" x={context.margin.left - 12} y={y + 4}>{formatNumber(value)}</text>
              </g>
            );
          })
        : null}
      {vertical
        ? columnTicks.map((fraction) => {
            const x = context.margin.left + context.plotWidth * fraction;
            return <line className="chart-grid__line chart-grid__line--vertical" key={`column-${fraction}`} x1={x} x2={x} y1={context.margin.top} y2={context.margin.top + context.plotHeight} />;
          })
        : null}
    </g>
  );
}

export function XAxis({ numTicks = 5 }: { numTicks?: number } = {}) {
  const context = useAreaChart();
  const tickCount = Math.min(Math.max(2, numTicks), context.data.length || 2);
  const indices = Array.from({ length: tickCount }, (_, index) => Math.round((index / Math.max(tickCount - 1, 1)) * Math.max(context.data.length - 1, 0)));

  return (
    <g className="chart-axis chart-axis--x" pointerEvents="none">
      {indices.map((index) => {
        const datum = context.data[index];
        const x = context.x(index);
        return <text className="chart-axis-label" key={`x-${index}`} textAnchor="middle" x={x} y={AREA_HEIGHT - 14}>{getLabel(datum?.[context.xDataKey])}</text>;
      })}
    </g>
  );
}

export function ChartTooltip({
  showCrosshair = true,
  showDots = true,
  showDatePill = true,
  valueFormatter = (_, value) => formatNumber(value),
  labelFormatter = (value) => getLabel(value),
}: {
  showCrosshair?: boolean;
  showDots?: boolean;
  showDatePill?: boolean;
  valueFormatter?: (dataKey: string, value: number) => string;
  labelFormatter?: (value: ChartDatum[string]) => string;
} = {}) {
  const context = useAreaChart();
  const activeIndex = context.activeIndex;
  const overlay = (
    <rect
      className="chart-interaction-zone"
      height={context.plotHeight}
      onPointerLeave={() => context.setActiveIndex(null)}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const localX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * context.plotWidth;
        const index = Math.round((localX / Math.max(context.plotWidth, 1)) * Math.max(context.data.length - 1, 0));
        context.setActiveIndex(Math.min(Math.max(index, 0), Math.max(context.data.length - 1, 0)));
      }}
      width={context.plotWidth}
      x={context.margin.left}
      y={context.margin.top}
    />
  );

  if (activeIndex === null || !context.data[activeIndex]) return overlay;

  const datum = context.data[activeIndex];
  const x = context.x(activeIndex);
  const tooltipWidth = 184;
  const tooltipHeight = 52 + context.series.length * 24;
  const tooltipX = x > AREA_WIDTH - tooltipWidth - 28 ? x - tooltipWidth - 18 : x + 18;
  const tooltipY = context.margin.top + 12;

  return (
    <g className="chart-tooltip">
      {showCrosshair ? <line className="chart-tooltip__crosshair" x1={x} x2={x} y1={context.margin.top} y2={context.margin.top + context.plotHeight} /> : null}
      {showDots
        ? context.series.map((series) => {
            const point = { x, y: context.y(getNumber(datum[series.dataKey])) };
            return <circle className="chart-tooltip__dot" cx={point.x} cy={point.y} fill={series.stroke} key={series.dataKey} r="5" />;
          })
        : null}
      {showDatePill ? (
        <g className="chart-tooltip__date-pill">
          <rect height="24" rx="12" width="88" x={x - 44} y={AREA_HEIGHT - 40} />
          <text textAnchor="middle" x={x} y={AREA_HEIGHT - 24}>{labelFormatter(datum[context.xDataKey])}</text>
        </g>
      ) : null}
      <foreignObject className="chart-tooltip__panel-wrap" height={tooltipHeight} pointerEvents="none" width={tooltipWidth} x={tooltipX} y={tooltipY}>
        <div className="chart-tooltip__panel">
          <span className="chart-tooltip__label">{labelFormatter(datum[context.xDataKey])}</span>
          {context.series.map((series) => (
            <div className="chart-tooltip__row" key={series.dataKey}>
              <span className="chart-tooltip__series"><i style={{ backgroundColor: series.stroke }} />{series.label ?? formatKey(series.dataKey)}</span>
              <strong>{valueFormatter(series.dataKey, getNumber(datum[series.dataKey]))}</strong>
            </div>
          ))}
        </div>
      </foreignObject>
      {overlay}
    </g>
  );
}

type BarSeries = {
  dataKey: string;
  fill: string;
  fillOpacity: number;
  stroke?: string;
  strokeWidth: number;
  lineCap: "round" | "butt" | number;
  fadedOpacity: number;
  label?: string;
};

type BarChartContextValue = {
  data: ChartDatum[];
  xDataKey: string;
  margin: Margin;
  plotWidth: number;
  plotHeight: number;
  x: (index: number) => number;
  y: (value: number) => number;
  bandWidth: number;
  maxValue: number;
  series: BarSeries[];
  activeIndex: number | null;
  setActiveIndex: (index: number | null) => void;
};

const BarChartContext = createContext<BarChartContextValue | null>(null);

function useBarChart() {
  const context = useContext(BarChartContext);
  if (!context) throw new Error("Bar chart components must be rendered inside BarChart.");
  return context;
}

function collectBarSeries(children: ReactNode) {
  const series: BarSeries[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement<BarProps>(child) || child.type !== Bar) return;
    series.push({
      dataKey: child.props.dataKey,
      fill: child.props.fill ?? "var(--color-accent)",
      fillOpacity: child.props.fillOpacity ?? 1,
      stroke: child.props.stroke,
      strokeWidth: child.props.strokeWidth ?? 0,
      lineCap: child.props.lineCap ?? "round",
      fadedOpacity: child.props.fadedOpacity ?? 0.32,
      label: child.props.label,
    });
  });

  return series;
}

export function BarChart({
  data,
  xDataKey = "name",
  margin,
  aspectRatio = "5.2 / 1",
  className,
  ariaLabel = "Bar chart",
  children,
}: {
  data: ChartDatum[];
  xDataKey?: string;
  margin?: Partial<Margin>;
  aspectRatio?: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const marginTop = margin?.top ?? BAR_MARGIN.top;
  const marginRight = margin?.right ?? BAR_MARGIN.right;
  const marginBottom = margin?.bottom ?? BAR_MARGIN.bottom;
  const marginLeft = margin?.left ?? BAR_MARGIN.left;
  const resolvedMargin = useMemo(() => ({ top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft }), [marginBottom, marginLeft, marginRight, marginTop]);
  const plotWidth = BAR_WIDTH - resolvedMargin.left - resolvedMargin.right;
  const plotHeight = BAR_HEIGHT - resolvedMargin.top - resolvedMargin.bottom;
  const series = useMemo(() => collectBarSeries(children), [children]);
  const maxValue = Math.max(1, ...series.flatMap((item) => data.map((datum) => getNumber(datum[item.dataKey]))));
  const bandWidth = plotWidth / Math.max(data.length, 1);
  const x = useCallback((index: number) => resolvedMargin.left + index * bandWidth + bandWidth / 2, [bandWidth, resolvedMargin.left]);
  const y = useCallback((value: number) => resolvedMargin.top + plotHeight - (value / maxValue) * plotHeight, [maxValue, plotHeight, resolvedMargin.top]);
  const context = useMemo<BarChartContextValue>(
    () => ({
      data,
      xDataKey,
      margin: resolvedMargin,
      plotWidth,
      plotHeight,
      x,
      y,
      bandWidth,
      maxValue,
      series,
      activeIndex,
      setActiveIndex,
    }),
    [activeIndex, bandWidth, data, maxValue, plotHeight, plotWidth, resolvedMargin, series, x, xDataKey, y],
  );

  return (
    <div
      aria-label={ariaLabel}
      className={cn("chart-frame chart-frame--bar", className)}
      role="img"
      style={{ "--chart-aspect-ratio": aspectRatio } as CSSProperties}
    >
      <svg aria-hidden="true" className="chart-svg" preserveAspectRatio="none" viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}>
        <BarChartContext.Provider value={context}>
          <g>{children}</g>
        </BarChartContext.Provider>
      </svg>
    </div>
  );
}

export type BarProps = {
  dataKey: string;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  lineCap?: "round" | "butt" | number;
  fadedOpacity?: number;
  label?: string;
};

export function Bar({
  dataKey,
  fill = "var(--color-accent)",
  fillOpacity = 1,
  stroke,
  strokeWidth = 0,
  lineCap = "round",
  fadedOpacity = 0.32,
}: BarProps) {
  const context = useBarChart();
  const seriesIndex = context.series.findIndex((series) => series.dataKey === dataKey);
  const seriesCount = Math.max(context.series.length, 1);
  const groupWidth = context.bandWidth * 0.72;
  const columnWidth = Math.max(3, (groupWidth - (seriesCount - 1) * 5) / seriesCount);
  const baseline = context.y(0);

  return (
    <g className="bar-series">
      {context.data.map((datum, index) => {
        const value = getNumber(datum[dataKey]);
        const top = context.y(value);
        const barHeight = Math.max(2, baseline - top);
        const x = context.x(index) - groupWidth / 2 + seriesIndex * (columnWidth + 5);
        const radius = lineCap === "round" ? columnWidth / 2 : lineCap === "butt" ? 0 : lineCap;
        const active = context.activeIndex === null || context.activeIndex === index;

        return (
          <rect
            className="bar-series__bar"
            fill={fill}
            fillOpacity={fillOpacity}
            height={barHeight}
            key={`${dataKey}-${index}`}
            onPointerEnter={() => context.setActiveIndex(index)}
            onPointerLeave={() => context.setActiveIndex(null)}
            opacity={active ? 1 : fadedOpacity}
            rx={radius}
            ry={radius}
            style={{ "--bar-index": index } as CSSProperties}
            stroke={stroke}
            strokeWidth={strokeWidth}
            width={columnWidth}
            x={x}
            y={top}
          />
        );
      })}
    </g>
  );
}

export function BarBaseline() {
  const context = useBarChart();
  const baseline = context.y(0);

  return <line className="chart-baseline" x1={context.margin.left} x2={BAR_WIDTH - context.margin.right} y1={baseline} y2={baseline} />;
}

function BarGrid({
  context,
  horizontal,
  vertical,
  numTicksRows,
  numTicksColumns,
}: {
  context: BarChartContextValue;
  horizontal: boolean;
  vertical: boolean;
  numTicksRows: number;
  numTicksColumns: number;
}) {
  const rowTicks = Array.from({ length: Math.max(2, numTicksRows) }, (_, index) => index / Math.max(numTicksRows - 1, 1));
  const columnTicks = Array.from({ length: Math.max(2, numTicksColumns) }, (_, index) => index / Math.max(numTicksColumns - 1, 1));

  return (
    <g className="chart-grid" pointerEvents="none">
      {horizontal
        ? rowTicks.map((fraction) => {
            const y = context.margin.top + context.plotHeight * fraction;
            return <line className="chart-grid__line" key={`row-${fraction}`} x1={context.margin.left} x2={BAR_WIDTH - context.margin.right} y1={y} y2={y} />;
          })
        : null}
      {vertical
        ? columnTicks.map((fraction) => {
            const x = context.margin.left + context.plotWidth * fraction;
            return <line className="chart-grid__line chart-grid__line--vertical" key={`column-${fraction}`} x1={x} x2={x} y1={context.margin.top} y2={context.margin.top + context.plotHeight} />;
          })
        : null}
    </g>
  );
}

export function BarXAxis({ showAllLabels = false, maxLabels = 8 }: { showAllLabels?: boolean; maxLabels?: number } = {}) {
  const context = useBarChart();
  const tickCount = showAllLabels ? context.data.length : Math.min(context.data.length, maxLabels);
  const indices = Array.from({ length: tickCount }, (_, index) => showAllLabels ? index : Math.round((index / Math.max(tickCount - 1, 1)) * Math.max(context.data.length - 1, 0)));

  return (
    <g className="chart-axis chart-axis--x" pointerEvents="none">
      {indices.map((index) => <text className="chart-axis-label" key={`bar-x-${index}`} textAnchor="middle" x={context.x(index)} y={BAR_HEIGHT - 10}>{getLabel(context.data[index]?.[context.xDataKey])}</text>)}
    </g>
  );
}
