'use client';

import { Crown, Shield, Pencil, Eye, UserX } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useSession } from "@/contexts/session-context";
import type { Role } from "@/contexts/session-context";
import { cn } from "@/lib/utils";

const roleIcons: Record<Role, React.ReactNode> = {
  host: <Crown className="h-4 w-4 text-yellow-400" />,
  'co-host': <Shield className="h-4 w-4 text-blue-400" />,
  editor: <Pencil className="h-4 w-4 text-green-400" />,
  viewer: <Eye className="h-4 w-4 text-gray-400" />,
};

const roleLabels: Record<Role, string> = {
  host: 'Host',
  'co-host': 'Co-Host',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function ParticipantsPanel() {
  const { session, changeUserRole, kickUser, user } = useSession();

  if (!session) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No active session
      </div>
    );
  }

  const participants = Object.values(session.participants).sort((a, b) => {
    const leftJoinedAt = Number.isFinite(a.joinedAt) ? a.joinedAt : Number.MAX_SAFE_INTEGER;
    const rightJoinedAt = Number.isFinite(b.joinedAt) ? b.joinedAt : Number.MAX_SAFE_INTEGER;

    if (leftJoinedAt !== rightJoinedAt) {
      return leftJoinedAt - rightJoinedAt;
    }

    return a.uid.localeCompare(b.uid);
  });
  const actorRole = user ? (session.participants[user.uid]?.role || session.role) : session.role;
  const isHost = actorRole === 'host';
  const isCoHost = actorRole === 'co-host';
  const canManage = isHost || isCoHost;

  const canManageRoleForParticipant = (participant: typeof participants[number], isCurrentUser: boolean) => {
    if (!canManage || isCurrentUser) return false;
    if (isHost) return participant.role !== 'host';
    return participant.role === 'editor' || participant.role === 'viewer';
  };

  const handleRoleChange = (userId: string, newRole: Role) => {
    changeUserRole(userId, newRole);
  };

  const handleKick = (userId: string) => {
    if (confirm('Are you sure you want to remove this user?')) {
      kickUser(userId);
    }
  };

  return (
    <div className="space-y-3 p-2">
      <div className="text-xs text-muted-foreground px-1">
        {participants.length} participant{participants.length !== 1 ? 's' : ''}
      </div>
      
      {participants.map((p) => {
        const participantName = typeof p.name === 'string' && p.name.trim() ? p.name : 'User';
        const participantInitial = participantName.charAt(0).toUpperCase();
        const isCurrentUser = user?.uid === p.uid;
        const canManageParticipant = canManageRoleForParticipant(p, isCurrentUser);

        return (
        <div 
          key={p.uid} 
          className={cn(
            "flex items-center justify-between p-2 rounded-lg transition-colors",
            p.isOnline ? "bg-secondary/30" : "bg-secondary/10 opacity-60"
          )}
        >
          <div className="flex items-center gap-3">
            <Avatar className="relative h-9 w-9">
              <AvatarFallback style={{ backgroundColor: p.color }}>
                {participantInitial}
              </AvatarFallback>
              <div 
                className={cn(
                  "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background",
                  p.isOnline ? "bg-green-500" : "bg-gray-400"
                )} 
              />
            </Avatar>
            <div>
              <p className="font-medium text-sm flex items-center gap-2">
                {participantName}
                {isCurrentUser && (
                  <span className="text-xs text-muted-foreground">(you)</span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                {roleIcons[p.role]}
                <p className="text-xs text-muted-foreground">{roleLabels[p.role]}</p>
              </div>
            </div>
          </div>
          
          {canManageParticipant && (
            <div className="flex items-center gap-2">
              <Select 
                value={p.role} 
                onValueChange={(value) => handleRoleChange(p.uid, value as Role)}
              >
                <SelectTrigger className="w-24 h-7 text-xs">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  {isHost && <SelectItem value="co-host">Co-Host</SelectItem>}
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              
              {isHost && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleKick(p.uid)}
                >
                  <UserX className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
