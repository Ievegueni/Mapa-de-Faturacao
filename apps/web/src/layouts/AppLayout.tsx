import { NavLink, Outlet } from "react-router-dom";
import { Logo } from "../components/Logo";

const nav = [{ to: "/", label: "Início" }];

export default function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col bg-navy-950 text-navy-100 md:flex">
        <div className="px-5 py-6">
          <Logo dark />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-white/10 text-white" : "text-navy-300 hover:text-white"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="px-5 py-4 text-xs text-navy-300/80">Manutenção de Rede · Unitel</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center border-b border-ink-200 bg-white px-4 py-3 md:hidden">
          <Logo />
        </header>
        <main className="flex-1 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
