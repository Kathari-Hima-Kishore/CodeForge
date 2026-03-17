'use client';

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { ParticipantsPanel } from "./participants-panel";
import { Button } from "@/components/ui/button";

export function CollaborationPanel({ isCollapsed = false, onCollapse }: { isCollapsed?: boolean; onCollapse?: (collapsed: boolean) => void }) {
  const [activeTab, setActiveTab] = useState("chat");

  if (isCollapsed) {
    return (
      <aside className="flex-shrink-0 border-r border-white/5 bg-black/20 flex flex-col items-center py-4 gap-4 transition-all duration-300 h-full w-full relative">
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-secondary"
          onClick={() => onCollapse?.(false)}
          title="Expand"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="w-full h-px bg-border/50" />
        <Button
          variant={activeTab === 'chat' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => { onCollapse?.(false); setActiveTab('chat'); }}
          title="Session Chat"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
        <Button
          variant={activeTab === 'participants' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8"
          onClick={() => { onCollapse?.(false); setActiveTab('participants'); }}
          title="Participants"
        >
          <Users className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="border-r border-white/5 bg-black/20 flex flex-col transition-all duration-300 h-full w-full relative">
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent" />
      <div className="flex items-center justify-between p-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-2">Collaboration</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={() => onCollapse?.(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-2 m-0 rounded-none bg-background/50 p-1 border-b border-border/50">
          <TabsTrigger value="chat" className="gap-2 text-xs">
            <MessageCircle className="h-3.5 w-3.5" /> Chat
          </TabsTrigger>
          <TabsTrigger value="participants" className="gap-2 text-xs">
            <Users className="h-3.5 w-3.5" /> Users
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0">
          <div className="h-full overflow-y-auto p-2">
            <ChatPanel />
          </div>
        </TabsContent>
        <TabsContent value="participants" className="flex-1 overflow-hidden m-0 p-0">
          <div className="h-full overflow-y-auto p-2">
            <ParticipantsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
