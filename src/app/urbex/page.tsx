import { auth } from "@/auth"
import { redirect } from "next/navigation"
import UrbexMap from "./UrbexMap"

export default async function UrbexPage() {
  const session = await auth()

  if (!session) {
    redirect("/api/auth/signin")
  }

  return <UrbexMap />
}