'use client';

import { useAuth } from "@/contexts/auth-context";
import { useSession } from "@/contexts/session-context";
import { AuthPage } from "@/components/auth/auth-page";
import { SessionDialog } from "@/components/session/session-dialog";
import { MainLayout } from "@/components/ide/main-layout";
import { Loader2, CodeXml } from "lucide-react";

function FullScreenLoader({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0a0a0f]">
      <div className="flex flex-col items-center gap-8">
        <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
          <CodeXml className="h-10 w-10 text-white/80" />
        </div>
        
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
            <p className="text-sm text-white/40 font-medium">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const { session, isConnecting } = useSession();

  if (authLoading) return <FullScreenLoader message="Authenticating..." />;
  if (!user) return <AuthPage />;
  if (isConnecting) return <FullScreenLoader message="Connecting to session..." />;
  if (!session) return <SessionDialog />;
  return <MainLayout />;
}
