"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";

import { Button } from "@/components/ui/button";
import { auth, googleProvider } from "@/lib/firebase";

const STAT_TARGETS = [
  { label: "Frauds detected today", value: 4291, suffix: "" },
  { label: "Entities monitored", value: 184_920, suffix: "" },
  { label: "Graph edges analyzed", value: 2_400_000, suffix: "+" },
  { label: "Mean triage time", value: 47, suffix: "s" },
] as const;

function AnimatedStat({
  value,
  suffix,
  delay,
}: {
  value: number;
  suffix: string;
  delay: number;
}) {
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 90, damping: 24 });
  const display = useTransform(spring, (v) =>
    Math.round(v).toLocaleString("en-IN")
  );
  const started = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!started.current) {
        started.current = true;
        motionVal.set(value);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [delay, motionVal, value]);

  return (
    <span className="font-mono text-lg font-semibold tabular-nums text-[#E6EDF3]">
      <motion.span>{display}</motion.span>
      {suffix ? (
        <span className="text-[#8B949E]">{suffix}</span>
      ) : null}
    </span>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace("/dashboard");
      } else {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  async function handleGoogle() {
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      router.push("/dashboard");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[#8B949E]"
        style={{ backgroundColor: "#0A0E1A" }}
      >
        <span className="font-mono text-sm">Authenticating…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left: brand atmosphere */}
      <div
        className="relative hidden w-1/2 overflow-hidden lg:flex lg:flex-col lg:justify-between"
        style={{ backgroundColor: "#0A0E1A" }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59, 130, 246, 0.12) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59, 130, 246, 0.12) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#3B82F6]/5 via-transparent to-transparent" />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[#3B82F6]/10 blur-3xl"
          animate={{ opacity: [0.4, 0.65, 0.4], scale: [1, 1.05, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-16 bottom-1/4 h-64 w-64 rounded-full bg-[#EF4444]/8 blur-3xl"
          animate={{ opacity: [0.3, 0.55, 0.3] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-xs font-medium uppercase tracking-[0.2em] text-[#3B82F6]"
          >
            Enterprise graph security
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mt-4 max-w-md text-2xl font-semibold leading-snug tracking-tight text-[#E6EDF3] xl:text-3xl"
          >
            Real-time fraud signals across accounts, devices, and money flows.
          </motion.h2>
          <ul className="mt-12 space-y-6">
            {STAT_TARGETS.map((s, i) => (
              <motion.li
                key={s.label}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.1 }}
                className="flex items-baseline justify-between gap-6 border-b border-[#21262D]/80 pb-4"
              >
                <span className="text-sm text-[#8B949E]">{s.label}</span>
                <AnimatedStat
                  value={s.value}
                  suffix={s.suffix}
                  delay={400 + i * 120}
                />
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 px-12 pb-8 text-xs text-[#8B949E]/80 xl:px-16">
          Sample metrics for demonstration. Production metrics connect to your
          TigerGraph workload.
        </p>
      </div>

      {/* Right: login */}
      <div
        className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2"
        style={{ backgroundColor: "#060910" }}
      >
        <motion.div
          className="w-full max-w-[380px]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center border border-[#21262D]"
              style={{ backgroundColor: "#161B22" }}
            >
              <Shield
                className="h-6 w-6 text-[#EF4444]"
                strokeWidth={1.85}
                aria-hidden
              />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#E6EDF3]">
                FraudNet
              </h1>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#8B949E]">
                Security operations
              </p>
            </div>
          </div>

          <p className="mt-8 text-sm leading-relaxed text-[#8B949E]">
            Sign in to access the threat graph, alert queue, and investigation
            tools. Session traffic is encrypted in transit.
          </p>

          <Button
            type="button"
            disabled={busy}
            onClick={handleGoogle}
            className="mt-8 h-11 w-full rounded-md border border-[#E6EDF3]/20 bg-white px-4 text-sm font-medium text-[#0A0E1A] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.08)] hover:bg-[#F6F8FA]"
          >
            <GoogleIcon className="mr-3 h-[18px] w-[18px]" />
            Continue with Google
          </Button>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[#21262D] pt-8">
            <Badge text="256-bit encrypted" />
            <Badge text="SOC 2 compliant" />
            <Badge text="TigerGraph powered" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-[#8B949E]">
      {text}
    </span>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
