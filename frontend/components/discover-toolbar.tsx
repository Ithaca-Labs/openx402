"use client";

import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { SuggestItem } from "@/app/api/discovery/suggest/route";
import { EntityLogo } from "@/components/explorer-shell";
import { ArrowRightIcon, ChevronDownIcon, MoreIcon, SearchIcon, XIcon } from "@/components/icons";
import { Input } from "@/components/ui";
import { pageHref, type DashboardSearch } from "@/lib/facilitator/query";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

export function DiscoverToolbar({ search }: { search: DashboardSearch }) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  // Repeat queries — backspacing, retyping, revisiting — never reach the network.
  const cache = useRef(new Map<string, SuggestItem[]>());

  const [value, setValue] = useState(search.q ?? "");
  const [type, setType] = useState(search.type ?? "");
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  // The query restored from the URL must not pop the overlay open on load.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) return;
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setItems([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const cacheKey = `${type} ${query}`;
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setItems(cached);
      setActive(-1);
      setOpen(true);
      setLoading(false);
      return;
    }

    // Each keystroke aborts the request in flight, so a slow response can never
    // overwrite the results of a newer query.
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query });
      if (type) params.set("type", type);
      try {
        const response = await fetch(`/api/discovery/suggest?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json() as { items?: SuggestItem[] };
        if (controller.signal.aborted) return;
        const suggestions = payload.items ?? [];
        cache.current.set(cacheKey, suggestions);
        setItems(suggestions);
        setActive(-1);
        setOpen(true);
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setItems([]);
        setOpen(false);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, type, touched]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function clearQuery() {
    setValue("");
    setItems([]);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
    // Drop ?q= but keep any active type filter.
    if (search.q) {
      const { q: _clearedQuery, ...rest } = search;
      router.replace(pageHref("/discover", { ...rest, page: 1 }, 1));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!open || items.length === 0) return;
    // One past the last suggestion is the "See all results" row.
    const navigableCount = items.length + 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(current => (current + 1) % navigableCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(current => (current <= 0 ? navigableCount - 1 : current - 1));
      return;
    }
    // Enter with no highlighted row falls through to the form's own submit,
    // which navigates to the full results page.
    if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      optionRefs.current[active]?.click();
    }
  }

  const showOverlay = open && (loading || items.length > 0 || value.trim().length >= MIN_QUERY_LENGTH);
  // Drop the URL's own type so the live selection wins, including "all".
  const { type: _urlType, ...searchWithoutType } = search;
  const allResultsHref = pageHref("/discover", {
    ...searchWithoutType,
    q: value.trim(),
    ...(type === "http" || type === "mcp" ? { type } : {}),
    page: 1,
  }, 1);

  return (
    <div className="discover-toolbar">
      <Form action="/discover" className="discover-search-form">
        <div className="toolbar-search-field" ref={containerRef}>
          <label className="toolbar-search">
            <SearchIcon size={16} />
            <span className="sr-only">Search Bazaar resources</span>
            <Input
              aria-activedescendant={active >= 0 ? `${listboxId}-option-${active}` : undefined}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={showOverlay}
              autoComplete="off"
              maxLength={512}
              name="q"
              onChange={event => { setTouched(true); setValue(event.target.value); }}
              onFocus={() => { if (items.length > 0) setOpen(true); }}
              onKeyDown={onKeyDown}
              placeholder="Search services"
              ref={inputRef}
              role="combobox"
              type="search"
              value={value}
            />
            {value ? (
              <button aria-label="Clear search" className="toolbar-search__clear" onClick={clearQuery} type="button">
                <XIcon size={14} />
              </button>
            ) : null}
          </label>
          {showOverlay ? (
            <div className="search-suggestions" id={listboxId} role="listbox" aria-label="Service suggestions">
              {items.length > 0 ? items.map((item, index) => (
                <a
                  aria-selected={index === active}
                  className={`search-suggestion${index === active ? " search-suggestion--active" : ""}`}
                  href={item.href ?? item.resource}
                  id={`${listboxId}-option-${index}`}
                  key={item.resource}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  ref={element => { optionRefs.current[index] = element; }}
                  rel="noreferrer noopener"
                  role="option"
                  target="_blank"
                >
                  <EntityLogo accent={item.accent} name={item.name} size="sm" />
                  <span className="search-suggestion__text">
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="search-suggestion__category mono">{item.category}</span>
                </a>
              )) : (
                <p className="search-suggestion__state">{loading ? "Searching…" : "No matches"}</p>
              )}
              {items.length > 0 ? (
                <Link
                  aria-selected={active === items.length}
                  className={`search-suggestion search-suggestion--all${active === items.length ? " search-suggestion--active" : ""}`}
                  href={allResultsHref}
                  id={`${listboxId}-option-${items.length}`}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setActive(items.length)}
                  ref={element => { optionRefs.current[items.length] = element; }}
                  role="option"
                >
                  <span className="search-suggestion__all-label mono">See all results</span>
                  <ArrowRightIcon size={14} />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        <label className="directory-filter">
          <span className="sr-only">Filter by resource type</span>
          <select
            aria-label="Filter by resource type"
            name="type"
            onChange={event => { setType(event.target.value); event.currentTarget.form?.requestSubmit(); }}
            value={type}
          >
            <option value="">Showing all</option>
            <option value="http">HTTP only</option>
            <option value="mcp">MCP only</option>
          </select>
          <ChevronDownIcon size={15} />
        </label>
      </Form>
      <div className="directory-view-toggle" aria-label="View options">
        <label aria-label="List view" className="directory-view-button" htmlFor="directory-view-list"><MoreIcon size={17} /></label>
        <label aria-label="Grid view" className="directory-view-button" htmlFor="directory-view-grid"><span className="directory-grid-icon" /></label>
      </div>
      <a className="directory-learn-more" href="https://docs.stellarx402.xyz/" rel="noreferrer noopener" target="_blank">Learn more <ArrowRightIcon size={15} /></a>
    </div>
  );
}
