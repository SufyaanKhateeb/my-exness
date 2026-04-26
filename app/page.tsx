import { auth0 } from "@/lib/auth0";
import AppHeader from "../components/AppHeader";
import MarketTerminal from "@/components/MarketTerminal";

export default async function Home() {
  await auth0.getSession();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="h-screen flex flex-col relative max-w-400">
        <AppHeader />
        <section className="h-full p-0 overflow-scroll">
          <MarketTerminal />
        </section>
      </div>
    </main>
  );
}