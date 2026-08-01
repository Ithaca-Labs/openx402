"use client";

import { SearchIcon } from "@/components/icons";
import {
  AppShell,
  CommandHint,
  PageContainer,
} from "@/components/explorer-shell";
import { Input } from "@/components/ui";

export default function HomeSearchPage() {
  return (
    <AppShell>
      <PageContainer className="home-search-page">
        <section className="home-search" aria-labelledby="home-search-title">
          <h1 className="sr-only" id="home-search-title">Search the openx402 ecosystem</h1>
          <form className="home-search__form" action="/discover" method="get" role="search">
            <div className="home-search__icon"><SearchIcon size={23} /></div>
            <label className="sr-only" htmlFor="home-ecosystem-search">
              Search services, facilitators, and networks
            </label>
            <Input
              autoComplete="off"
              id="home-ecosystem-search"
              name="q"
              placeholder="Search services, facilitators, networks..."
              type="search"
            />
            <CommandHint />
            <button className="home-search__submit" type="submit">Search</button>
          </form>
        </section>
      </PageContainer>
    </AppShell>
  );
}
