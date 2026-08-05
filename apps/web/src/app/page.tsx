import { Bot, LogIn, MessagesSquare, Wrench } from "lucide-react"
import { redirect } from "next/navigation"
import { Wordmark } from "@/components/brand/BrandMark"
import { ThemeToggle } from "@/components/brand/ThemeToggle"
import { DesktopDragStrip } from "@/components/desktop/DesktopDragStrip"
import { HomeActions } from "@/components/home/HomeActions"
import { authMode } from "@/lib/server/authMode"
import { getSessionUser } from "@/lib/server/session"

const features = [
  {
    icon: Bot,
    title: "Agents in the room",
    body: "Invite a looped agent as a real participant — it listens, speaks, and can be interrupted like anyone else.",
  },
  {
    icon: Wrench,
    title: "Watch the work",
    body: "Tool calls stream live into the meeting while the agent researches, runs code, or files issues mid-call.",
  },
  {
    icon: MessagesSquare,
    title: "Yours to host",
    body: "One docker compose up. No accounts, no vendor lock-in — share a link and meet.",
  },
]

export default async function HomePage() {
  const withAccounts = authMode() === "auth0"
  const user = withAccounts ? await getSessionUser() : null
  // Members live in the app shell; the marketing page is for visitors.
  if (user?.role) redirect("/home")
  return (
    // The desktop shell has no title bar of its own, so this page needs its
    // own drag strip — it is where the shell lands before anyone signs in.
    <div className="flex h-dvh flex-col overflow-hidden">
      <DesktopDragStrip />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-6">
        <header className="flex items-center justify-between py-6">
          <Wordmark />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {withAccounts &&
              (user ? (
                <div className="dropdown dropdown-end">
                  <button
                    type="button"
                    tabIndex={0}
                    className="btn btn-ghost btn-sm gap-2"
                  >
                    {user.image ? (
                      <img
                        src={user.image}
                        alt=""
                        className="size-6 rounded-full"
                      />
                    ) : null}
                    <span className="max-w-32 truncate">
                      {user.name ?? user.email ?? "Account"}
                    </span>
                  </button>
                  <ul className="dropdown-content menu z-10 mt-2 w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                    <li className="menu-title text-xs">
                      Not a member yet — ask for an invite
                    </li>
                    <li>
                      <a href="/auth/logout">Sign out</a>
                    </li>
                  </ul>
                </div>
              ) : (
                <a href="/auth/login" className="btn btn-ghost btn-sm">
                  <LogIn className="size-4" />
                  Sign in
                </a>
              ))}
          </div>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
          <span className="badge badge-soft badge-primary">
            Open source · self-hosted
          </span>
          <h1 className="max-w-2xl text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
            Dial your agent into your next meeting
          </h1>
          <p className="max-w-xl text-balance text-base-content/70 text-lg">
            Open-source, self-hostable video meetings with first-class AI
            participants, powered by the looped agent framework.
          </p>
          <HomeActions />
        </section>

        <section className="grid gap-6 pb-16 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card card-border bg-base-200/20">
              <div className="card-body">
                <f.icon className="size-6 text-primary" />
                <h2 className="card-title text-base">{f.title}</h2>
                <p className="text-base-content/70 text-sm">{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        <footer className="border-base-300 border-t py-6 text-center text-base-content/50 text-sm">
          looped meet — open source, self-hosted.
        </footer>
      </main>
    </div>
  )
}
