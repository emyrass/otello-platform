import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useOtello } from "../context/Store.tsx";
import { cn } from "../lib/cn.ts";
import { EXAMPLE_NOTICE, WORKSPACE_NOTICE } from "../lib/types.ts";
import { AuthScreen } from "./AuthScreen.tsx";
import { ContractAddress } from "./ContractAddress.tsx";
import { Button } from "./ui.tsx";

const LINKS = [
  ["/", "Overview"],
  ["/resources", "Resources"],
  ["/leases", "Leases"],
  ["/agents", "Agents"],
  ["/providers", "Providers"],
  ["/usage", "Usage"],
  ["/activity", "Activity"],
] as const;

export function Shell() {
  const { ready, account, state, error, scope, setScope, resetExamples, logout } = useOtello();
  const { pathname } = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!ready) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p className="font-serif text-6xl tracking-tight">otello</p>
        <p className="mt-4 text-sm text-char">Opening the ledger.</p>
        <div className="mt-10">
          <ContractAddress />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p className="font-serif text-5xl">The ledger did not open.</p>
        <p className="mt-4 text-sm text-char">{error}</p>
        <div className="mt-10">
          <ContractAddress />
        </div>
      </main>
    );
  }

  if (!account) return <AuthScreen />;

  if (!state) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p className="font-serif text-5xl tracking-tight">Opening the ledger.</p>
        <div className="mt-10">
          <ContractAddress />
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <svg className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-[0.045]" aria-hidden="true">
        <filter id="otello-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#otello-grain)" />
      </svg>
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-ivory/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-5 py-3 md:flex-row md:items-center md:justify-between md:px-10">
          <div className="flex items-baseline justify-between gap-6">
            <NavLink to="/" className="font-serif text-[1.7rem] leading-none tracking-[-0.04em]" end>
              otello
            </NavLink>
            <span className="text-[10px] uppercase tracking-[0.18em] text-mute">{account.name}</span>
          </div>
          <nav aria-label="Primary" className="nav-scroll flex w-full min-w-0 gap-1 overflow-x-auto rounded-full border border-ink/10 bg-cream/70 p-1">
            {LINKS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "shrink-0 rounded-full px-3 py-1 text-[13px] tracking-wide transition-colors",
                    isActive ? "bg-ink text-ivory" : "text-ink/70 hover:text-ink",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {scope === "examples" ? (
        <div className="border-b border-ink/10 bg-cream/80">
          <p className="mx-auto max-w-[1440px] px-5 py-3 text-sm text-char md:px-10">Examples. These records are separate from the workspace.</p>
        </div>
      ) : null}
      <main className="mx-auto max-w-[1440px] px-5 pb-24 pt-10 md:px-10 md:pt-14">
        <Outlet />
      </main>
      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-8 md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn("rounded-full px-3 py-1 text-[13px]", scope === "live" ? "bg-ink text-ivory" : "border border-ink/15")}
              onClick={() => void setScope("live")}
            >
              Workspace
            </button>
            <button
              type="button"
              className={cn("rounded-full px-3 py-1 text-[13px]", scope === "examples" ? "bg-ink text-ivory" : "border border-ink/15")}
              onClick={() => void setScope("examples")}
            >
              Examples
            </button>
            <button type="button" className="ml-auto text-[13px] underline underline-offset-4" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex max-w-3xl flex-col gap-4">
              <ContractAddress />
              <p className="text-xs leading-relaxed text-char">{scope === "examples" ? EXAMPLE_NOTICE : WORKSPACE_NOTICE}</p>
            </div>
            {scope === "examples" ? (
              <Button variant="line" onClick={() => dialogRef.current?.showModal()}>
                Reset examples
              </Button>
            ) : null}
          </div>
        </div>
      </footer>
      <dialog ref={dialogRef} className="w-[min(34rem,calc(100%-2rem))] rounded-[1.6rem] border border-ink/15 bg-ivory p-8 backdrop:bg-ink/30">
        <h2 className="font-serif text-4xl tracking-tight">Reset examples?</h2>
        <p className="mt-3 text-sm leading-relaxed text-char">This replaces the example records. The workspace is left as it is.</p>
        <div className="mt-6 flex gap-3">
          <Button
            onClick={() => {
              dialogRef.current?.close();
              void resetExamples();
            }}
          >
            Reset examples
          </Button>
          <Button variant="line" onClick={() => dialogRef.current?.close()}>
            Keep them
          </Button>
        </div>
      </dialog>
    </div>
  );
}
