"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Loader2 } from "lucide-react"

import { LoginForm } from "@/components/ui/login-form"
import { useAuth } from "@/contexts/auth-context"

export default function LoginPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(user.role === "citizen" ? "/citizen" : "/analyst")
    }
  }, [isLoading, user, router])

  if (!isLoading && user) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Redirecting to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-pampas p-6 md:p-10">
      <div className="absolute left-1/2 top-8 -translate-x-1/2 md:left-10 md:top-10 md:translate-x-0">
        <a href="#" className="flex items-center gap-2 font-medium text-foreground">
          <Image src="/main-logo.png" alt="Arth Saathi logo" width={32} height={32} className="rounded-md" />
          Arth Saathi
        </a>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-background p-6 shadow-sm">
        <LoginForm />
      </div>
    </div>
  )
}
