import { auth } from "@/auth"
import { NextResponse } from "next/server"

export const proxy = auth(function proxy(req) {
  if (!req.auth) {
    const signInUrl = new URL("/api/auth/signin", req.url)
    signInUrl.searchParams.set("callbackUrl", req.url)
    return NextResponse.redirect(signInUrl)
  }
})

export const config = {
  matcher: ["/protected/:path*"],
}