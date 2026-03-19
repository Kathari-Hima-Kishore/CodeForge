'use client';

import { useAuth } from "@/contexts/auth-context";
import { useSession } from "@/contexts/session-context";
import { AuthPage } from "@/components/auth/auth-page";
import { SessionDialog } from "@/components/session/session-dialog";
import { MainLayout } from "@/components/ide/main-layout";
import { VerifyEmailScreen } from "@/components/auth/verify-email";
import { Loader2 } from "lucide-react";

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0C0C0E]">
      <Loader2 className="w-5 h-5 text-amber-400 animate-spin mb-3" />
      <p className="text-xs font-medium text-zinc-500 tracking-widest uppercase">{message}</p>
    </div>
  );
}

export default function HomePage() {
  const { user, loading: authLoading, isEmailVerified } = useAuth();
  const { session, isConnecting } = useSession();

  if (authLoading) return <LoadingScreen message="Authenticating" />;
  if (!user) return <AuthPage />;
  if (!isEmailVerified) return <VerifyEmailScreen />;
  if (isConnecting) return <LoadingScreen message="Connecting to session" />;
  if (!session) return <SessionDialog />;
  return <MainLayout />;
}
