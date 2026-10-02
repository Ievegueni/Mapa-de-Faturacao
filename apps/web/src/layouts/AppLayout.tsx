import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABELS } from "@cf/shared";
import { Logo } from "../components/Logo";
import { useAuth } from "../hooks/useAuth";
import { buildMenu } from "../lib/menu";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const menu = buildMenu(user);

  return (
    <div className="flex min-h-screen">
      {open && <div className="fixed inset-0 z-30 bg-navy-950/50 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-navy-950 text-navy-100 transition-transform duration-300 md:sticky md:top-0 md:h-screen md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-6">
          <Logo dark />
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3">
          {menu.map((section, i) => (
            <div key={i}>
              {section.title && <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-300/80">{section.title}</div>}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive ? "bg-white/10 text-white" : "text-navy-300 hover:text-white"
                      }`
                    }
                  >
                    <Icon d={item.icon} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-semibold text-white">
            {user.nome.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{user.nome}</div>
            <div className="truncate text-xs text-navy-300/80">{ROLE_LABELS[user.role]}</div>
          </div>
          <button onClick={logout} className="rounded-lg p-2 text-navy-300 transition hover:bg-white/5 hover:text-white" aria-label="Sair" title="Sair">
            <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-navy-950 hover:bg-ink-100" aria-label="Abrir menu">
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>
          <img src="/unitel-logo.png" alt="Unitel" className="h-7 w-auto" />
        </header>
        <main className="flex-1 p-4 sm:p-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
