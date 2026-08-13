import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 16 4.25 4.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15m-5.5-5.5L19 12l-5.5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 9.5 5.5 5 5.5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2.75v2.1M12 19.15v2.1M21.25 12h-2.1M4.85 12h-2.1M18.54 5.46l-1.49 1.49M6.95 17.05l-1.49 1.49M18.54 18.54l-1.49-1.49M6.95 6.95 5.46 5.46" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.75 14.9A8.05 8.05 0 0 1 9.1 4.25 8.05 8.05 0 1 0 19.75 14.9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m14.5 6.5-5 5.5 5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6.5 5 5.5-5 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12h3l2-6 4 12 2.25-6H20.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </Icon>
  );
}

export function CommandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.25 8.25A2.75 2.75 0 1 1 5.5 5.5a2.75 2.75 0 0 1 2.75 2.75Zm0 0h7.5m0 0A2.75 2.75 0 1 0 18.5 5.5a2.75 2.75 0 0 0-2.75 2.75ZM8.25 8.25v7.5m0 0A2.75 2.75 0 1 1 5.5 18.5a2.75 2.75 0 0 1 2.75-2.75Zm0 0h7.5m0 0a2.75 2.75 0 1 0 2.75 2.75 2.75 2.75 0 0 0-2.75-2.75Zm0 0v-7.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.45" />
    </Icon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.55" />
      <path d="M4.5 12h15M12 4c2.05 2.2 3.08 4.87 3.08 8S14.05 17.8 12 20c-2.05-2.2-3.08-4.87-3.08-8S9.95 6.2 12 4Z" stroke="currentColor" strokeWidth="1.35" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M7 12h10m-7 6h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </Icon>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 5.5v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-6M5 11.5v6c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-6" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  );
}

export function NetworkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.25" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.75" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18.75" cy="18" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m7.3 11 9.35-4M7.3 13l9.35 4" stroke="currentColor" strokeWidth="1.45" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.55" />
      <path d="M12 7.5V12l3.2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" width="10.5" x="8.5" y="8.5" />
      <path d="M15.5 8.5V6.75A1.75 1.75 0 0 0 13.75 5H6.75A1.75 1.75 0 0 0 5 6.75v7A1.75 1.75 0 0 0 6.75 15.5H8.5" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.25 4.25L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3 1.4 6.1L19 12l-5.6 2.9L12 21l-1.4-6.1L5 12l5.6-2.9L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.45" />
    </Icon>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="16" x="4" y="5" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="16" x="4" y="14" />
      <path d="M7 7.5h.01M7 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </Icon>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h10m3 0h3M4 17h3m3 0h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <circle cx="15.5" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8.5" cy="17" r="2" stroke="currentColor" strokeWidth="1.5" />
    </Icon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 5h6v6M19 5l-8 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65" />
      <path d="M18 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.65" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="12" fill="currentColor" r="1.25" />
      <circle cx="12" cy="12" fill="currentColor" r="1.25" />
      <circle cx="19" cy="12" fill="currentColor" r="1.25" />
    </Icon>
  );
}

export function CurveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M3.5 16.5c3-0.4 4.6-5.6 7.4-5.6 2.6 0 3.4 3.2 5 3.2 1.7 0 3-2.6 4.6-6.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </Icon>
  );
}

export function BarsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect fill="currentColor" height="7" rx="1" width="4" x="3.5" y="13.5" />
      <rect fill="currentColor" height="13" rx="1" width="4" x="10" y="7.5" />
      <rect fill="currentColor" height="10" rx="1" width="4" x="16.5" y="10.5" />
    </Icon>
  );
}
