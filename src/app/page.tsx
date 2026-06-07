import { auth, signIn, signOut } from "@/auth"
import Link from "next/link"

export default async function Home() {
  const session = await auth()

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 dark:bg-black min-h-screen">
      <main className="flex flex-col items-center gap-8 p-8 w-full max-w-md">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">Ruin</h1>

        {session ? (
          <div className="w-full bg-white dark:bg-zinc-900 rounded-xl shadow p-6 flex flex-col gap-4">
            <p className="text-sm text-zinc-500">
              Signed in as{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {session.user?.email}
              </span>
            </p>
            <Link
              href="/protected"
              className="block text-center py-2 px-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
            >
              Go to protected page →
            </Link>
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/" })
              }}
            >
              <button
                type="submit"
                className="w-full py-2 px-4 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <div className="w-full bg-white dark:bg-zinc-900 rounded-xl shadow p-6 flex flex-col gap-4">
            <p className="text-sm text-zinc-500">Not signed in.</p>
            <form
              action={async () => {
                "use server"
                await signIn("keycloak", { redirectTo: "/protected" })
              }}
            >
              <button
                type="submit"
                className="w-full py-2 px-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
              >
                Sign in with Keycloak
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}