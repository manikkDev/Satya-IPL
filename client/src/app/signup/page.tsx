"use client"

import Image from "next/image"
import { SignupForm } from "@/components/ui/signup-form"

export default function SignupPage() {
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-pampas p-6 md:p-10">
      <div className="absolute left-1/2 top-8 -translate-x-1/2 md:left-10 md:top-10 md:translate-x-0">
        <a href="#" className="flex items-center gap-2 font-medium text-foreground">
          <Image src="/main-logo.png" alt="Arth Saathi logo" width={32} height={32} className="rounded-md" />
          Arth Saathi
        </a>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border-subtle bg-background p-6 shadow-sm">
        <SignupForm />
      </div>
    </div>
  )
}
