import { auth0 } from "@/lib/auth0";
import LoginButton from "@/components/LoginButton";
import LogoutButton from "@/components/LogoutButton";
import Profile from "@/components/Profile";
import MarketTerminal from "@/components/MarketTerminal";

export default async function Home() {
  const session = await auth0.getSession();
  const user = session?.user;

  return (
    <main className="min-h-screen overflow-hidden bg-[#040b14] px-4 py-4 text-white md:px-6 md:py-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[8%] top-0 h-[380px] w-[380px] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute bottom-0 right-[6%] h-[360px] w-[360px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-[1600px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <MarketTerminal />
        </section>

        <aside className="space-y-4">
          <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,24,43,0.94)_0%,rgba(6,14,25,0.96)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.42)]">
            <div className="h-px bg-linear-to-r from-transparent via-cyan-400/70 to-transparent" />
            <div className="px-6 py-6">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                Account Shell
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">
                Exness-style demo terminal
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                The market feed is simulated through SpacetimeDB reducers. Any connected client can subscribe to the same dummy BTC, ETH, SOL, XAU, and EUR markets.
              </p>

              <div className="mt-6 rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                {user ? (
                  <div className="flex flex-col items-center gap-4">
                    <Profile />
                    <LogoutButton />
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-4">
                    <p className="text-sm leading-6 text-slate-400">
                      Sign in when you want to layer real portfolio state, watchlists, or account actions on top of the simulator.
                    </p>
                    <LoginButton />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/8 bg-[#08111d] px-6 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">What this gives you</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>Five seeded instruments with live candles and spread metadata.</p>
              <p>Reducer-driven ticks, so the simulated market logic stays in SpacetimeDB.</p>
              <p>A resettable terminal surface you can extend with watchlists, orders, and positions.</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}