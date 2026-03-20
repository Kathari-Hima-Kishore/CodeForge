'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Share2, Users, Copy, Check, LogOut, Download, Package, FileArchive, AlertTriangle, Cloud, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { useAuth } from "@/contexts/auth-context";
import { useSession } from "@/contexts/session-context";
import type { FileItem } from "@/contexts/session-context";
import { BACKEND_URL } from "@/lib/firebase";

function resetBodyPointerEvents() {
  document.body.style.pointerEvents = '';
}

export function IdeHeader() {
  const { user, logout } = useAuth();
  const { session, leaveSession, addOutput, files } = useSession();
  const [shareOpen, setShareOpen] = useState(false);
  const [dockerCheckOpen, setDockerCheckOpen] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<{ installed: boolean; running: boolean; version?: string; message?: string; error?: string; hint?: string } | null>(null);
  const [checkingDocker, setCheckingDocker] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployAction, setDeployAction] = useState<'download' | 'dockerhub' | 'render'>('download');
  const [autoImport, setAutoImport] = useState(false);
  const [dockerHubUsername, setDockerHubUsername] = useState('');
  const [dockerHubPassword, setDockerHubPassword] = useState('');
  const [dockerHubRepos, setDockerHubRepos] = useState<string[]>([]);
  const [selectedDockerHubRepo, setSelectedDockerHubRepo] = useState('');
  const [dockerHubCustomRepo, setDockerHubCustomRepo] = useState('');
  const [dockerHubActualUsername, setDockerHubActualUsername] = useState('');
  const [isLoadingDockerHubRepos, setIsLoadingDockerHubRepos] = useState(false);
  const [dockerHubReposError, setDockerHubReposError] = useState('');
  const [renderApiKey, setRenderApiKey] = useState('');
  const [renderServiceName, setRenderServiceName] = useState('');
  const [renderRegion, setRenderRegion] = useState('oregon');
  const [renderEnvVars, setRenderEnvVars] = useState<Array<{id: string; key: string; value: string}>>([]);
  const [renderBuildCmd, setRenderBuildCmd] = useState('');
  const [renderStartCmd, setRenderStartCmd] = useState('');
  const [renderManualCmds, setRenderManualCmds] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorModal, setErrorModal] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const deployAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!deployOpen && !shareOpen && !dockerCheckOpen) {
      resetBodyPointerEvents();
    }
  }, [deployOpen, shareOpen, dockerCheckOpen]);

  useEffect(() => {
    return () => resetBodyPointerEvents();
  }, []);

  const fetchDockerHubRepos = useCallback(async () => {
    if (!dockerHubUsername || !dockerHubPassword) return;
    setIsLoadingDockerHubRepos(true);
    setDockerHubReposError('');
    setDockerHubRepos([]);
    setSelectedDockerHubRepo('');
    setDockerHubCustomRepo('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/dockerhub/repos?identifier=${encodeURIComponent(dockerHubUsername)}&password=${encodeURIComponent(dockerHubPassword)}`);
      const data = await res.json();
      console.log('[Docker Hub] Repos response:', data);
      if (data.username) {
        setDockerHubActualUsername(data.username);
      }
      if (data.repos && data.repos.length > 0) {
        setDockerHubRepos(data.repos.map((r: { name: string }) => r.name));
      } else if (data.error) {
        setDockerHubReposError(data.error);
      }
    } catch (err) {
      console.error('[Docker Hub] Fetch error:', err);
      setDockerHubReposError('Failed to fetch repositories');
    } finally {
      setIsLoadingDockerHubRepos(false);
    }
  }, [dockerHubUsername, dockerHubPassword]);

  const validateRenderServiceName = useCallback(async (serviceName: string): Promise<boolean> => {
    if (!serviceName || !renderApiKey) {
      setErrorModal({ open: true, message: 'Service name and Render API key are required' });
      return false;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/validate-render-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName, renderApiKey })
      });
      const data = await res.json();

      if (!data.valid) {
        setErrorModal({ open: true, message: data.reason || 'Invalid service name' });
        return false;
      }

      return true;
    } catch (err) {
      setErrorModal({ open: true, message: `Failed to validate service name: ${err instanceof Error ? err.message : 'Unknown error'}` });
      return false;
    }
  }, [renderApiKey]);

  const participantCount = session ? Object.keys(session.participants).length : 0;

  const handleCopySessionId = () => {
    if (session?.sessionId) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(session.sessionId).catch(() => {
          const textArea = document.createElement('textarea');
          textArea.value = session.sessionId;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        });
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = session.sessionId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeaveSession = () => {
    if (confirm('Are you sure you want to leave this session?')) {
      leaveSession();
    }
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to logout?')) {
      await logout();
    }
  };

  const closeDeployDialog = useCallback(() => {
    setDeployOpen(false);
    setDeploying(false);
    resetBodyPointerEvents();
  }, []);

  const checkDockerStatus = useCallback(async () => {
    if (checkingDocker) return;
    setCheckingDocker(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/check-docker`);
      const data = await res.json();
      setDockerStatus(data);
    } catch (err) {
      setDockerStatus({
        installed: false,
        running: false,
        error: 'Failed to check Docker status',
        hint: 'Make sure the backend is running.'
      });
    } finally {
      setCheckingDocker(false);
    }
  }, [checkingDocker]);

  const handleBuildContainerImage = () => {
    if (!files || files.length === 0) {
      addOutput('error', '❌ No files to build');
      return;
    }
    setDeployAction('download');
    setDockerStatus(null); // Reset docker status
    checkDockerStatus(); // Check docker status
    setDeployOpen(true);
  };

  const handleDeploy = async () => {
    setDeploying(true);

    try {
      const nonFolderFiles: Record<string, string> = {};
      const getFilePath = (file: FileItem): string => {
        const parts: string[] = [file.name];
        let current: FileItem = file;
        while (current.parentId) {
          const parent = files.find(f => f.id === current.parentId);
          if (parent) { parts.unshift(parent.name); current = parent; } else break;
        }
        return parts.join('/');
      };
      files.filter(f => !f.isFolder).forEach(file => {
        nonFolderFiles[getFilePath(file)] = file.content;
      });

      if (Object.keys(nonFolderFiles).length === 0) {
        addOutput('error', '❌ No files to build');
        return;
      }

      // Render deployment - direct from source, no Docker Hub
      if (deployAction === 'render') {
        // Validate service name first
        const finalServiceName = renderServiceName || session?.name?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'codeforge-project';
        const isValid = await validateRenderServiceName(finalServiceName);
        if (!isValid) {
          setDeploying(false);
          return;
        }

        addOutput('info', '🔍 Deploying to Render.com...');

        const controller = new AbortController();
        deployAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        try {
          const renderResponse = await fetch(`${BACKEND_URL}/api/deploy/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              renderApiKey,
              renderServiceName: renderServiceName || session?.name?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'codeforge-project',
              renderRegion,
              renderBuildCmd: renderManualCmds ? (renderBuildCmd || undefined) : undefined,
              renderStartCmd: renderManualCmds ? (renderStartCmd || undefined) : undefined,
              renderEnvVars: renderEnvVars.filter(v => v.key.trim()).map(v => ({ key: v.key, value: v.value })),
              dockerHubUsername: dockerHubActualUsername || dockerHubUsername,
              dockerHubPassword: dockerHubPassword,
              dockerHubRepo: dockerHubCustomRepo || selectedDockerHubRepo || `codeforge-${Date.now()}`,
              files: nonFolderFiles,
              socketId: null
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          let result;
          try {
            result = await renderResponse.json();
          } catch {
            const text = await renderResponse.text();
            addOutput('error', `❌ Render error (${renderResponse.status}): ${text.substring(0, 200)}`);
            return;
          }

          if (!renderResponse.ok) {
            const details = result.details || '';
            addOutput('error', `❌ Render deployment failed: ${result.error}`);
            if (details) {
              addOutput('error', `📋 Build output: ${details.substring(0, 300)}`);
            }
          } else {
            addOutput('success', `✅ ${result.message}`);
            if (result.url) {
              addOutput('info', `🌐 Live at: ${result.url}`);
            }
            if (result.dashboardUrl) {
              addOutput('info', `📊 Dashboard: ${result.dashboardUrl}`);
            }
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            addOutput('error', '⏱️ Deployment timed out after 2 minutes');
          } else {
            addOutput('error', `❌ Network error: ${fetchErr instanceof Error ? fetchErr.message : 'Unknown'}`);
          }
        } finally {
          deployAbortRef.current = null;
        }
        return;
      }

      // Docker-based deployment (download or dockerhub)
      addOutput('info', '🔍 Checking Docker status...');
      const response = await fetch(`${BACKEND_URL}/api/check-docker`);
      const data = await response.json();

      if (!data.installed || !data.running) {
        addOutput('error', `❌ ${data.error || 'Docker is not running'}`);
        if (data.hint) {
          addOutput('error', `💡 ${data.hint}`);
        }
        closeDeployDialog();
        return;
      }

      if (data.version) {
        addOutput('success', `✅ Docker v${data.version} is running`);
      } else {
        addOutput('success', `✅ Docker is running`);
      }
      addOutput('info', '📦 Building container image...');

      const buildBody: Record<string, unknown> = {
        files: nonFolderFiles,
        sessionName: session?.name || 'codeforge-project',
        action: deployAction === 'download' && autoImport ? 'autoimport' : deployAction
      };

      if (deployAction === 'dockerhub') {
        buildBody.dockerHubUsername = dockerHubActualUsername || dockerHubUsername;
        buildBody.dockerHubPassword = dockerHubPassword;
        buildBody.dockerHubRepo = dockerHubCustomRepo || selectedDockerHubRepo || `codeforge-${Date.now()}`;
      }

      const controller = new AbortController();
      deployAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      let buildResponse;
      try {
        buildResponse = await fetch(`${BACKEND_URL}/api/build-container`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          addOutput('error', '⏱️ Build timed out after 2 minutes');
        } else {
          addOutput('error', `❌ Network error: ${fetchErr instanceof Error ? fetchErr.message : 'Unknown'}`);
        }
        return;
      } finally {
        deployAbortRef.current = null;
      }

      if (!buildResponse.ok) {
        const errorData = await buildResponse.json().catch(() => ({}));
        const fullMessage = errorData.details || errorData.error || 'Build failed';
        const buildLog = errorData.buildLog || '';
        const shortMessage = fullMessage.length > 200 ? fullMessage.substring(0, 200) + '...' : fullMessage;
        if (buildLog) {
          addOutput('error', `❌ ${shortMessage}\n${buildLog.substring(0, 500)}`);
        } else {
          throw new Error(shortMessage);
        }
        return;
      }

      if (deployAction === 'download' && autoImport) {
        const result = await buildResponse.json();
        const imgName = result.imageName ? result.imageName.split(':')[0] : 'codeforge/project';
        addOutput('success', `✅ Built: ${imgName}`);
      } else if (deployAction === 'download') {
        const result = await buildResponse.json();

        if (!result.downloadUrl) {
          throw new Error(result.error || 'Build failed - no download URL');
        }

        const fullUrl = result.downloadUrl.startsWith('http')
          ? result.downloadUrl
          : `${BACKEND_URL}${result.downloadUrl}`;

        const tarResponse = await fetch(fullUrl);
        if (!tarResponse.ok) throw new Error('Download failed');
        const blob = await tarResponse.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const imgName = result.imageName ? result.imageName.split(':')[0] : 'codeforge-project';
        a.download = result.fileName || `${session?.name || 'codeforge'}-container.tar`;
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);

        addOutput('success', `✅ Built: ${imgName}`);
      } else if (deployAction === 'dockerhub') {
        const result = await buildResponse.json();
        addOutput('success', `✅ ${result.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addOutput('error', `❌ Build failed: ${message}`);
    } finally {
      closeDeployDialog();
    }
  };

  const handleExportSourceCode = async () => {
    if (!files || files.length === 0) {
      addOutput('error', '❌ No files to export');
      return;
    }

    addOutput('info', '📦 Preparing source code export...');

    try {
      const nonFolderFiles = files.filter(f => !f.isFolder);

      if (nonFolderFiles.length === 0) {
        addOutput('error', '❌ No source files to export');
        return;
      }

      const fileContents: Record<string, string> = {};
      const getExportPath = (file: FileItem): string => {
        const parts: string[] = [file.name];
        let current: FileItem = file;
        while (current.parentId) {
          const parent = files.find(f => f.id === current.parentId);
          if (parent) { parts.unshift(parent.name); current = parent; } else break;
        }
        return parts.join('/');
      };
      nonFolderFiles.forEach(file => {
        fileContents[getExportPath(file)] = file.content;
      });

      const response = await fetch(`${BACKEND_URL}/api/export-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileContents, sessionName: session?.name || 'codeforge-export' })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Export failed');
      }

      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session?.name || 'codeforge'}-source.zip`;

      setTimeout(() => {
        a.click();
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 100);
      }, 10);

      addOutput('success', '✅ Source code exported successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addOutput('error', `❌ Export failed: ${message}`);
    }
  };

  const handleDeployDialogChange = useCallback((open: boolean) => {
    if (deploying) return;
    if (!open) {
      closeDeployDialog();
    } else {
      setDeployOpen(true);
    }
  }, [deploying, closeDeployDialog]);

  const handleShareDialogChange = useCallback((open: boolean) => {
    setShareOpen(open);
    if (!open) resetBodyPointerEvents();
  }, []);

  const handleDockerCheckDialogChange = useCallback((open: boolean) => {
    setDockerCheckOpen(open);
    if (!open) resetBodyPointerEvents();
  }, []);

  return (
    <>
      <header className="flex h-[52px] items-center gap-3 border-b border-white/5 glass-nav px-4 shrink-0 z-10 relative">
        {/* Left: Logo + session info */}
              <div className="flex items-center gap-4 flex-1 min-w-0">
          <Logo />

          {session && (
            <>
              <div className="w-px h-6 bg-white/10" />
                <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40" />
                </div>
                <span className="text-[14px] font-semibold text-white truncate max-w-[160px] tracking-wide">
                  {session.name}
                </span>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold capitalize bg-white/10 text-white/80 shrink-0">
                  {session.role.replace('-', ' ')}
                </span>
                <span className="text-[11px] text-white/50 flex items-center gap-1.5 px-2 py-0.5 rounded-full shrink-0 font-medium">
                  <Users className="h-3.5 w-3.5" />
                  {participantCount}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {session && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5 h-8 px-3.5 text-[12px] border-white/10 bg-white/5 hover:bg-white/10 text-white/80 font-medium transition-colors"
                onClick={() => setShareOpen(true)}
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 h-8 px-3 text-[12px] border-[#252640]/70 bg-[#1a1b2e]/40 hover:bg-[#1a1b2e]/70 hover:border-[#252640] text-muted-foreground hover:text-foreground font-medium transition-all"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onClick={handleBuildContainerImage} className="flex flex-col items-start gap-0.5 p-3 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Package className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold text-[13px]">Build Container Image</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground ml-[22px]">Auto-detects language & framework</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportSourceCode} className="flex flex-col items-start gap-0.5 p-3 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <FileArchive className="h-3.5 w-3.5 text-accent" />
                      <span className="font-semibold text-[13px]">Export Source Code</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground ml-[22px]">Downloads as .zip archive</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[12px] text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 font-medium"
                onClick={handleLeaveSession}
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Leave
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 hover:bg-white/10 transition-colors">
                <Avatar className="h-8 w-8 ring-1 ring-white/10">
                  <AvatarImage src={user?.photoURL || undefined} alt="User Avatar" />
                  <AvatarFallback className="bg-white/10 text-white text-[11px] font-medium">
                    {user?.displayName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">{user?.displayName || 'User'}</span>
                  <span className="text-[11px] font-normal text-muted-foreground truncate">
                    {user?.email}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive text-[13px]">
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Share Dialog */}
      <Dialog open={shareOpen} onOpenChange={handleShareDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Share Session</DialogTitle>
            <DialogDescription>
              Share this code with others to let them join your session.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2">
            <Input
              value={session?.sessionId || ''}
              readOnly
              className="font-mono text-xl tracking-[0.3em] text-center bg-secondary/30 border-border/40 h-12"
            />
            <Button
              type="button"
              size="icon"
              className="h-12 w-12 shrink-0"
              onClick={handleCopySessionId}
              variant={copied ? 'default' : 'outline'}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {copied && (
            <p className="text-[12px] text-emerald-500 text-center">Copied to clipboard!</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Docker Not Installed Dialog */}
      <Dialog open={dockerCheckOpen} onOpenChange={handleDockerCheckDialogChange}>
        <DialogContent className="sm:max-w-md border-destructive/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-base">
              <AlertTriangle className="h-4 w-4" />
              Docker Not Found
            </DialogTitle>
            <DialogDescription>
              Docker is not installed on this system. Please install Docker to build container images.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 p-3.5 rounded-lg bg-destructive/8 border border-destructive/20">
            <p className="text-[12px] text-destructive font-semibold mb-1.5">Installation Steps:</p>
            <ol className="text-[12px] text-muted-foreground list-decimal list-inside space-y-1">
              <li>Download Docker Desktop from docker.com</li>
              <li>Run the installer and follow prompts</li>
              <li>Start Docker Desktop application</li>
              <li>Restart your IDE session</li>
            </ol>
          </div>
          <div className="mt-2 flex justify-end">
            <Button onClick={() => { setDockerCheckOpen(false); resetBodyPointerEvents(); }} size="sm">
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deploy Container Dialog */}
      {deployOpen && (
        <div className="fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/70" onClick={() => !deploying && closeDeployDialog()} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md">
            <div className="bg-background border border-border/50 rounded-xl shadow-2xl p-5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Package className="h-4 w-4 text-primary" />
                  Build & Deploy Container
                </div>
                {!deploying && (
                  <button
                    onClick={closeDeployDialog}
                    className="text-muted-foreground/50 hover:text-foreground rounded p-1 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground mb-4">
                Choose how you want to deploy your container image.
              </p>

              <div className="space-y-4 relative">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Deployment Option</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'download', icon: Download, label: 'Save .tar' },
                      { id: 'dockerhub', icon: Upload, label: 'Docker Hub' },
                      { id: 'render', icon: Cloud, label: 'Render' },
                    ].map(({ id, icon: Icon, label }) => (
                      <Button
                        key={id}
                        variant={deployAction === id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setDeployAction(id as typeof deployAction);
                          // Check Docker status when switching to dockerhub or render
                          if (id === 'dockerhub' || id === 'render') {
                            checkDockerStatus();
                          }
                        }}
                        className="flex flex-col items-center gap-1 h-auto py-2.5 text-[11px]"
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Button>
                    ))}
                  </div>
                  </div>

                {/* Docker Status Indicator */}
                {(deployAction === 'dockerhub' || deployAction === 'render') && (
                  <div className={`p-3 rounded-lg border ${
                    checkingDocker ? 'bg-secondary/30 border-border/30' :
                    dockerStatus?.running ? 'bg-green-500/10 border-green-500/30' :
                    dockerStatus?.installed === false ? 'bg-red-500/10 border-red-500/30' :
                    'bg-secondary/30 border-border/30'
                  }`}>
                    <div className="flex items-center gap-2">
                      {checkingDocker ? (
                        <>
                          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs text-muted-foreground">Checking Docker status...</span>
                        </>
                      ) : dockerStatus?.running ? (
                        <>
                          <div className="h-4 w-4 bg-green-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-[10px] font-bold">✓</span>
                          </div>
                          <div>
                            <span className="text-xs text-green-400 font-medium">Docker is running</span>
                            {dockerStatus.version && (
                              <span className="text-[10px] text-muted-foreground ml-1">v{dockerStatus.version}</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="h-4 w-4 bg-red-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-[10px] font-bold">✗</span>
                          </div>
                          <div className="flex-1">
                            <span className="text-xs text-red-400 font-medium">Docker is not running</span>
                            {dockerStatus?.hint && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{dockerStatus.hint}</p>
                            )}
                            <button
                              onClick={checkDockerStatus}
                              className="text-[10px] text-primary hover:underline mt-1"
                            >
                              Retry
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {deployAction === 'dockerhub' && (
                  <div className="space-y-3 p-3 rounded-lg bg-secondary/30 border border-border/30">
                    <div className="space-y-1">
                      <Label htmlFor="dh-user" className="text-xs">Docker Hub Username</Label>
                      <Input
                        id="dh-user"
                        value={dockerHubUsername}
                        onChange={(e) => setDockerHubUsername(e.target.value)}
                        placeholder="your-username"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dh-pass" className="text-xs">Docker Hub Password or PAT</Label>
                      <Input
                        id="dh-pass"
                        type="password"
                        value={dockerHubPassword}
                        onChange={(e) => setDockerHubPassword(e.target.value)}
                        placeholder="••••••••"
                        className="h-9 text-sm"
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchDockerHubRepos}
                      disabled={!dockerHubUsername || !dockerHubPassword || isLoadingDockerHubRepos}
                      className="w-full h-8 text-xs"
                    >
                      {isLoadingDockerHubRepos ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                          Fetching repositories...
                        </>
                      ) : (
                        'Fetch Repositories'
                      )}
                    </Button>

                    {dockerHubReposError && (
                      <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
                        <p className="text-[11px] text-red-400">{dockerHubReposError}</p>
                      </div>
                    )}

                    {!isLoadingDockerHubRepos && dockerHubUsername && dockerHubPassword && !dockerHubReposError && dockerHubRepos.length === 0 && (
                      <div className="p-2 rounded bg-blue-500/10 border border-blue-500/20">
                        <p className="text-[11px] text-blue-400">
                          No repositories found. Enter a name below to create or push to an existing repo.
                        </p>
                      </div>
                    )}

                    {dockerHubRepos.length > 0 && !selectedDockerHubRepo && !dockerHubCustomRepo ? (
                      <div className="space-y-1">
                        <Label htmlFor="dh-repo" className="text-xs">Select Repository</Label>
                        <select
                          id="dh-repo"
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                          value={selectedDockerHubRepo}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setSelectedDockerHubRepo('');
                              setDockerHubCustomRepo(session?.name || '');
                            } else {
                              setSelectedDockerHubRepo(e.target.value);
                              setDockerHubCustomRepo('');
                            }
                          }}
                        >
                          <option value="">Select a repository...</option>
                          {dockerHubRepos.map(repo => (
                            <option key={repo} value={repo}>{repo}</option>
                          ))}
                          <option value="__custom__">+ Enter custom repository name</option>
                        </select>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label htmlFor="dh-custom-repo" className="text-xs">Repository Name</Label>
                        <Input
                          id="dh-custom-repo"
                          value={dockerHubCustomRepo}
                          onChange={(e) => {
                            setDockerHubCustomRepo(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'));
                            setSelectedDockerHubRepo('');
                          }}
                          placeholder={session?.name || 'my-repo'}
                          className="h-9 text-sm"
                        />
                        {dockerHubRepos.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDockerHubCustomRepo('');
                              setSelectedDockerHubRepo('');
                            }}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline"
                          >
                            ← Back to repository list
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {deployAction === 'render' && (
                  <div className="space-y-4 p-3 rounded-lg bg-secondary/30 border border-border/30 max-h-[400px] overflow-y-auto scrollbar-thin">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-muted-foreground">Render.com Deployment</Label>
                      <a
                        href="https://render.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary hover:underline"
                      >
                        Get API key →
                      </a>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="render-api-key" className="text-xs">Render API Key</Label>
                      <Input
                        id="render-api-key"
                        type="password"
                        value={renderApiKey}
                        onChange={(e) => setRenderApiKey(e.target.value)}
                        placeholder="rnd_••••••••"
                        className="h-9 text-sm"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="render-service-name" className="text-xs">Service Name</Label>
                      <Input
                        id="render-service-name"
                        value={renderServiceName}
                        onChange={(e) => setRenderServiceName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                        placeholder={session?.name?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'my-service'}
                        className="h-9 text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">URL: {(renderServiceName || session?.name?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'my-service')}.onrender.com</p>
                    </div>

                    <div className="border-t border-border/30 pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-muted-foreground">Docker Hub Image</Label>
                        <a
                          href="https://hub.docker.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline"
                        >
                          Create repo →
                        </a>
                      </div>
                      <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-400/80">
                        ⚠️ Docker Hub credentials are required — your image will be pushed to Docker Hub first, then Render pulls it from there. Repo will be auto-created if it doesn't exist.
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="render-dh-user" className="text-xs">Docker Hub Username <span className="text-red-400">*</span></Label>
                        <Input
                          id="render-dh-user"
                          value={dockerHubUsername}
                          onChange={(e) => setDockerHubUsername(e.target.value)}
                          placeholder="your-username"
                          required
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="render-dh-pass" className="text-xs">Docker Hub Password or PAT <span className="text-red-400">*</span></Label>
                        <Input
                          id="render-dh-pass"
                          type="password"
                          value={dockerHubPassword}
                          onChange={(e) => setDockerHubPassword(e.target.value)}
                          placeholder="••••••••"
                          required
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="render-dh-repo" className="text-xs">Repository Name <span className="text-red-400">*</span></Label>
                        <div className="flex gap-1.5">
                          <select
                            id="render-dh-repo"
                            value={selectedDockerHubRepo}
                            onChange={(e) => {
                              setSelectedDockerHubRepo(e.target.value);
                              setDockerHubCustomRepo('');
                            }}
                            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
                            disabled={isLoadingDockerHubRepos || dockerHubRepos.length === 0}
                          >
                            <option value="">{isLoadingDockerHubRepos ? 'Loading...' : dockerHubRepos.length > 0 ? 'Select a repository' : 'No repositories found'}</option>
                            {dockerHubRepos.map(repo => (
                              <option key={repo} value={repo}>{repo}</option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={fetchDockerHubRepos}
                            disabled={!dockerHubUsername || !dockerHubPassword || isLoadingDockerHubRepos}
                            className="h-9 text-xs"
                          >
                            {isLoadingDockerHubRepos ? '...' : '⟳'}
                          </Button>
                        </div>
                        {dockerHubReposError && (
                          <p className="text-xs text-red-400">{dockerHubReposError}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground">Select from your Docker Hub repositories</p>
                      </div>
                    </div>

                      <div className="space-y-1">
                        <Label htmlFor="render-region" className="text-xs">Region</Label>
                        <select
                          id="render-region"
                          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                          value={renderRegion}
                          onChange={(e) => setRenderRegion(e.target.value)}
                        >
                          <option value="oregon">Oregon</option>
                          <option value="frankfurt">Frankfurt</option>
                          <option value="singapore">Singapore</option>
                          <option value="ohio">Ohio</option>
                        </select>
                      </div>

                      <div className="border-t border-border/30 pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium text-muted-foreground">Commands</Label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRenderManualCmds(false)}
                              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${!renderManualCmds ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                            >
                              Auto-detect
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenderManualCmds(true)}
                              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${renderManualCmds ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                        {renderManualCmds ? (
                          <>
                            <div className="space-y-1">
                              <Label htmlFor="render-build-cmd" className="text-xs">Build Command</Label>
                              <Input
                                id="render-build-cmd"
                                value={renderBuildCmd}
                                onChange={(e) => setRenderBuildCmd(e.target.value)}
                                placeholder="pip install -r requirements.txt"
                                className="h-9 text-sm font-mono"
                              />
                              <p className="text-[10px] text-muted-foreground">Runs once during build</p>
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="render-start-cmd" className="text-xs">Start Command</Label>
                              <Input
                                id="render-start-cmd"
                                value={renderStartCmd}
                                onChange={(e) => setRenderStartCmd(e.target.value)}
                                placeholder="python app.py"
                                className="h-9 text-sm font-mono"
                              />
                              <p className="text-[10px] text-muted-foreground">Command to start your app</p>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px] text-muted-foreground py-1">
                            Build & start commands will be auto-detected from your project files (package.json, requirements.txt, etc.)
                          </p>
                        )}
                      </div>

                    <div className="border-t border-border/30 pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-muted-foreground">Environment Variables</Label>
                        <button
                          type="button"
                          onClick={() => setRenderEnvVars(prev => [...prev, { id: Date.now().toString(), key: '', value: '' }])}
                          className="text-[10px] text-primary hover:underline"
                        >
                          + Add variable
                        </button>
                      </div>
                      {renderEnvVars.length > 0 && (
                        <div className="space-y-2">
                          {renderEnvVars.map((envVar, index) => (
                            <div key={envVar.id} className="flex gap-2">
                              <Input
                                placeholder="KEY"
                                value={envVar.key}
                                onChange={(e) => {
                                  const updated = [...renderEnvVars];
                                  updated[index].key = e.target.value.toUpperCase();
                                  setRenderEnvVars(updated);
                                }}
                                className="h-8 text-xs flex-1"
                              />
                              <Input
                                placeholder="value"
                                value={envVar.value}
                                onChange={(e) => {
                                  const updated = [...renderEnvVars];
                                  updated[index].value = e.target.value;
                                  setRenderEnvVars(updated);
                                }}
                                className="h-8 text-xs flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => setRenderEnvVars(prev => prev.filter(v => v.id !== envVar.id))}
                                className="text-muted-foreground hover:text-destructive p-1"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {deployAction === 'download' && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-border/30">
                    <input
                      type="checkbox"
                      id="autoImport"
                      checked={autoImport}
                      onChange={(e) => setAutoImport(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <Label htmlFor="autoImport" className="text-[13px] cursor-pointer font-medium">
                      Auto-import to Docker Desktop
                    </Label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={closeDeployDialog} disabled={deploying} className="h-8 text-xs">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleDeploy} disabled={deploying} className="h-8 text-xs">
                    {deploying ? 'Building...' : deployAction === 'download' ? 'Build & Download' : 'Build & Deploy'}
                  </Button>
                </div>

                {deploying && (
                  <div className="absolute inset-0 bg-background/85 flex items-center justify-center z-50 rounded-lg backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-7 h-7 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                      <p className="text-[12px] text-muted-foreground">Building container image…</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Modal */}
      <Dialog open={errorModal.open} onOpenChange={(open) => setErrorModal({ ...errorModal, open })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deployment Error</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-red-400">
            {errorModal.message}
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              size="sm"
              onClick={() => setErrorModal({ ...errorModal, open: false })}
              className="h-8 text-xs"
            >
              Dismiss
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
