'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Terminal, Trash2, Loader2, StopCircle, Circle, Monitor, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/contexts/session-context";
import { useEffect, useRef, useMemo, useState } from "react";

export function BottomPanel() {
  const {
    output, isExecuting, clearOutput, isConnected,
    sendTerminalCommand, killTerminal, isTerminalRunning,
    sendExecutionInput, killExecution,
    files, currentFileId
  } = useSession();
  const outputBottomRef = useRef<HTMLDivElement>(null);
  const terminalBottomRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const execInputRef = useRef<HTMLInputElement>(null);

  const [execInput, setExecInput] = useState('');

  const currentFile = files.find(f => f.id === currentFileId);

  // Detect HTML content in output
  const htmlContent = useMemo(() => {
    if (currentFile?.language === 'html' && currentFile?.content) {
      return currentFile.content;
    }
    for (const item of output) {
      if (item.type === 'output' && item.content.includes('<') && item.content.includes('>')) {
        return item.content;
      }
    }
    return null;
  }, [output, currentFile]);

  const getVersionCommand = () => {
    const cmds: Record<string, string> = {
      javascript: 'node --version', typescript: 'npx ts-node --version',
      python: 'python --version', java: 'java --version',
      cpp: 'g++ --version', c: 'gcc --version', csharp: 'dotnet --version',
    };
    return cmds[currentFile?.language || ''] || 'echo "Select a file first"';
  };

  // Auto-scroll output
  useEffect(() => {
    outputBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  // Focus input when execution starts
  useEffect(() => {
    if (isExecuting) {
      setTimeout(() => execInputRef.current?.focus(), 50);
    }
  }, [isExecuting]);

  // Update iframe with HTML content
  useEffect(() => {
    if (iframeRef.current && htmlContent) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(htmlContent);
        doc.close();
      }
    }
  }, [htmlContent]);

  const handleExecInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (!execInput.trim()) return;
    sendExecutionInput(execInput);
    setExecInput('');
  };

  return (
    <div className="h-full border-t border-white/5 flex flex-col bg-black/30 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <Tabs defaultValue="output" className="flex-1 flex flex-col min-h-0">

        {/* Tab bar */}
        <div className="flex items-center px-2 border-b border-white/5 h-9 bg-black/20 shrink-0">
          <TabsList className="bg-transparent h-9 gap-0 p-0">
            <TabsTrigger
              value="output"
              className="relative gap-1.5 text-[11px] font-medium h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-white/60 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-white/50 px-3.5 transition-colors"
            >
              <Play className="h-3 w-3" />
              Output
              {isExecuting && <Loader2 className="h-2.5 w-2.5 animate-spin text-white/60" />}
              {!isExecuting && output.length > 0 && (
                <span className="h-4 min-w-4 rounded-full bg-white/10 text-white/60 text-[9px] font-medium flex items-center justify-center px-1 tabular-nums">
                  {output.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="relative gap-1.5 text-[11px] font-medium h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500/80 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-muted-foreground/60 px-3.5 transition-colors"
            >
              <Terminal className="h-3 w-3" />
              Terminal
              {isTerminalRunning && (
                <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
              )}
            </TabsTrigger>
            {htmlContent && (
              <TabsTrigger
                value="preview"
                className="relative gap-1.5 text-[11px] font-medium h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-500/80 data-[state=active]:text-foreground data-[state=active]:bg-transparent text-muted-foreground/60 px-3.5 transition-colors"
              >
                <Monitor className="h-3 w-3" />
                Preview
              </TabsTrigger>
            )}
          </TabsList>

          {/* Right controls */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isConnected ? 'bg-emerald-500' : 'bg-red-500/80'}`} />
              <span className="text-[10px] text-muted-foreground/40 font-medium">
                {isConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="w-px h-3 bg-border/30" />
            {isExecuting && (
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-md"
                onClick={killExecution} title="Kill execution"
              >
                <StopCircle className="h-3.5 w-3.5" />
              </Button>
            )}
            {isTerminalRunning && (
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded-md"
                onClick={killTerminal} title="Kill process"
              >
                <StopCircle className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded-md"
              onClick={() => { killTerminal(); clearOutput(); }}
              title="Clear"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ── OUTPUT TAB ── */}
        <TabsContent value="output" className="data-[state=active]:flex-1 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden m-0">
          <ScrollArea className="flex-1 h-full">
            <div className="font-mono text-[12px] p-4 space-y-0.5">
              {output.length === 0 ? (
                <div className="flex flex-col gap-2 pt-2">
                  <span className="text-muted-foreground/25 text-[12px]">No output yet.</span>
                  <span className="text-[11px] text-muted-foreground/20">
                    Press{' '}
                    <kbd className="px-1.5 py-0.5 rounded bg-secondary/50 border border-border/40 font-mono text-muted-foreground/35 text-[10px]">Ctrl+Enter</kbd>
                    {' '}or click{' '}<span className="text-emerald-500/60 font-semibold">Run</span>
                  </span>
                </div>
              ) : (
                output.map((item, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap leading-[1.65] py-[1px] pl-2.5 border-l-[2px] ${
                      item.type === 'error'   ? 'text-red-400/90 border-red-500/40' :
                      item.type === 'info'    ? 'text-sky-400/90 border-sky-500/40' :
                      item.type === 'success' ? 'text-emerald-400/90 border-emerald-500/40' :
                      item.content.startsWith('> ') ? 'text-amber-300/80 border-amber-500/30' :
                      'text-[#c9d1d9] border-transparent'
                    }`}
                  >
                    {item.type !== 'output' && (
                      <span className="text-muted-foreground/20 text-[10px] mr-2 select-none tabular-nums">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    )}
                    {item.content}
                  </div>
                ))
              )}
              <div ref={outputBottomRef} />
            </div>
          </ScrollArea>

          {/* Stdin input row — shown only while code is executing */}
          {isExecuting && (
            <div className="px-4 py-2 border-t border-blue-500/20 bg-blue-500/5 shrink-0">
              <form onSubmit={handleExecInput} className="flex items-center gap-2">
                <span className="text-blue-400/60 text-[11px] font-mono select-none shrink-0">stdin</span>
                <span className="text-blue-400/40 select-none">›</span>
                <input
                  ref={execInputRef}
                  value={execInput}
                  onChange={e => setExecInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent border-none outline-none text-[12px] font-mono text-foreground/80 placeholder:text-muted-foreground/25 focus:text-foreground transition-colors"
                  placeholder="Type input and press Enter…"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 text-[10px] text-blue-400/50 hover:text-blue-400 transition-colors shrink-0"
                >
                  <CornerDownLeft className="h-3 w-3" />
                </button>
              </form>
            </div>
          )}
        </TabsContent>

        {/* ── TERMINAL TAB ── */}
        <TabsContent value="terminal" className="data-[state=active]:flex-1 data-[state=active]:flex data-[state=active]:flex-col m-0 overflow-hidden">
          <ScrollArea className="flex-1">
            <div className="p-4 font-mono text-[12px] space-y-0.5">
              <div className="flex items-center gap-2 text-muted-foreground/20 mb-3 select-none text-[11px]">
                <span>~/codeforge</span>
                {currentFile && (
                  <span className="text-muted-foreground/12 font-medium">
                    ({currentFile.language})
                  </span>
                )}
              </div>
              {output.map((item, i) => (
                <div key={i} className="whitespace-pre-wrap break-all leading-[1.65]">
                  {item.type === 'output' && item.content.startsWith('> ') ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-emerald-400/70 font-bold select-none">❯</span>
                      <span className="text-foreground/75">{item.content.slice(2)}</span>
                    </div>
                  ) : (
                    <span className={item.type === 'error' ? 'text-red-400/80' : 'text-[#c9d1d9]/70'}>
                      {item.content}
                    </span>
                  )}
                </div>
              ))}
              <div ref={terminalBottomRef} />
            </div>
          </ScrollArea>

          {/* Input bar */}
          <div className="px-4 py-2 border-t border-border/20 bg-[#0d0e17]/50 shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem('cmd') as HTMLInputElement);
                if (input.value.trim()) {
                  sendTerminalCommand(input.value);
                  input.value = '';
                }
              }}
              className="flex items-center gap-2"
            >
              <span className="text-emerald-400/60 font-bold text-xs select-none shrink-0">❯</span>
              <input
                name="cmd"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent border-none outline-none text-[12px] font-mono text-foreground/70 placeholder:text-muted-foreground/20 focus:text-foreground/90 transition-colors"
                placeholder={`e.g. ${getVersionCommand()}`}
              />
            </form>
          </div>
        </TabsContent>

        {/* ── HTML PREVIEW TAB ── */}
        {htmlContent && (
          <TabsContent value="preview" className="data-[state=active]:flex-1 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden m-0 bg-white">
            <iframe
              ref={iframeRef}
              className="w-full h-full border-none"
              title="HTML Preview"
              sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms"
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
