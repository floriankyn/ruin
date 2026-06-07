import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"

export default async function ProtectedPage() {
  const session = await auth()

  if (!session) {
    redirect("/api/auth/signin")
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-zinc-50 dark:bg-black">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow p-8 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Protected Page
        </h1>
        <p className="text-sm text-zinc-500">You are authenticated.</p>
        <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-4 space-y-2 text-sm">
          <div>
            <span className="text-zinc-400">Name</span>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {session.user?.name ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-zinc-400">Email</span>
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {session.user?.email ?? "—"}
            </p>
          </div>
        </div>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/" })
          }}
        >
          <button
            type="submit"
            className="w-full py-2 px-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors"
          >
            Sign out
          </button>
        </form>
        <Link
          href="/"
          className="text-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  )
}