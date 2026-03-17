'use client';

import React, { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Loader2, X, FileCode, Lock, Eye } from 'lucide-react';
import { useSession } from '@/contexts/session-context';

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));

interface LangConfig {
  id: string;
  name: string;
  monacoId: string;
  color: string;
  dot: string;
}

const LANG_CONFIG: LangConfig[] = [
  { id: 'html',       name: 'HTML',       monacoId: 'html',       color: 'text-red-400',     dot: 'bg-red-400' },
  { id: 'css',        name: 'CSS',        monacoId: 'css',        color: 'text-pink-400',    dot: 'bg-pink-400' },
  { id: 'javascript', name: 'JS',         monacoId: 'javascript', color: 'text-yellow-400',  dot: 'bg-yellow-400' },
  { id: 'typescript', name: 'TS',         monacoId: 'typescript', color: 'text-blue-400',    dot: 'bg-blue-400' },
  { id: 'python',     name: 'Python',     monacoId: 'python',     color: 'text-emerald-400', dot: 'bg-emerald-400' },
  { id: 'java',       name: 'Java',       monacoId: 'java',       color: 'text-orange-400',  dot: 'bg-orange-400' },
  { id: 'c',          name: 'C',          monacoId: 'c',          color: 'text-slate-400',   dot: 'bg-slate-400' },
  { id: 'cpp',        name: 'C++',        monacoId: 'cpp',        color: 'text-sky-300',     dot: 'bg-sky-300' },
];

function getLang(language: string): LangConfig {
  return LANG_CONFIG.find(l => l.id === language) || { id: language, name: language, monacoId: 'plaintext', color: 'text-gray-400', dot: 'bg-gray-400' };
}

export function CodeEditorPanel() {
  const {
    files,
    currentFileId,
    setCurrentFileId,
    updateFileContent,
    executeCode,
    isExecuting,
    session,
  } = useSession();

  const editorRef = useRef<any>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [localOpenFileIds, setLocalOpenFileIds] = useState<string[]>([]);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);

  // Clean up open file list when files are deleted
  useEffect(() => {
    const fileIds = files.filter(f => !f.isFolder).map(f => f.id);
    setLocalOpenFileIds(prev => prev.filter(id => fileIds.includes(id)));
  }, [files]);

  // Auto-open file when clicked in explorer (if not already open)
  useEffect(() => {
    if (currentFileId) {
      setLocalOpenFileIds(prev => {
        if (!prev.includes(currentFileId)) {
          return [...prev, currentFileId];
        }
        return prev;
      });
    }
  }, [currentFileId]);

  const currentFile = files.find(f => f.id === currentFileId);
  const code = currentFile?.content || '';
  const canEdit = session ? ['host', 'co-host', 'editor'].includes(session.role) : true;
  const lang = getLang(currentFile?.language || 'plaintext');

  const handleCodeChange = useCallback((value: string | undefined) => {
    if (currentFileId && canEdit && value !== undefined) {
      updateFileContent(currentFileId, value);
    }
  }, [currentFileId, canEdit, updateFileContent]);

  const handleRun = useCallback(() => {
    if (!currentFile) return;
    executeCode(currentFile.language, currentFile.content);
  }, [currentFile, executeCode]);

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
    });
    editor.focus();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleRun(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRun]);

  const handleCloseFile = (fileId: string) => {
    const next = localOpenFileIds.filter(id => id !== fileId);
    setLocalOpenFileIds(next);
    if (currentFileId === fileId) {
      setCurrentFileId(next.length > 0 ? next[0] : null as unknown as string);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-black text-gray-200">

      {/* File tabs */}
      {localOpenFileIds.length > 0 && (
        <div className="flex items-center h-9 px-1 border-b border-white/5 overflow-x-auto bg-black scrollbar-thin shrink-0">
          {localOpenFileIds.map(fileId => {
            const file = files.find(f => f.id === fileId);
            if (!file || file.isFolder) return null;
            const fileLang = getLang(file.language);
            const isActive = file.id === currentFileId;
            return (
              <div
                key={file.id}
                className={`group flex items-center gap-1.5 px-3 h-full text-[11px] border-r border-white/5 cursor-pointer flex-shrink-0 relative select-none transition-colors ${
                  isActive
                    ? 'bg-black text-white/90'
                    : 'bg-black text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
                onClick={() => setCurrentFileId(file.id)}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/60 rounded-t" />
                )}
                <div className={`w-1.5 h-1.5 rounded-full ${fileLang.dot} opacity-80 flex-shrink-0`} />
                <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseFile(file.id); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all rounded p-0.5 -mr-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[#1a1b2e] h-10 px-4 bg-[#0a0b14]/60 shrink-0">
        <div className="flex items-center gap-3 text-sm min-w-0">
          {currentFile ? (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1a1b2e] border border-[#252640]/60">
                <div className={`w-1.5 h-1.5 rounded-full ${lang.dot} opacity-90`} />
                <span className={`text-[11px] font-bold font-mono ${lang.color}`}>{lang.name}</span>
              </div>
              <span className="text-[13px] font-medium text-gray-300/80 truncate">{currentFile.name}</span>
              <span className="text-[10px] text-gray-600 font-mono shrink-0 tabular-nums">
                {cursorPosition.line}:{cursorPosition.column}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-2 text-gray-600">
              <FileCode className="h-4 w-4" />
              <span className="text-[13px]">No file selected</span>
            </div>
          )}
          {!canEdit && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400/80 text-[10px] shrink-0">
              <Lock className="h-2.5 w-2.5" />
              View Only
            </div>
          )}
        </div>

        <Button
          size="sm"
          onClick={handleRun}
          disabled={isExecuting || !currentFile || !canEdit}
          className="flex items-center gap-1.5 bg-emerald-600/90 hover:bg-emerald-500 disabled:bg-[#1a1b2e] disabled:text-gray-600 text-white font-semibold px-3.5 h-7 text-[12px] transition-all rounded-md shadow-sm"
        >
          {isExecuting ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Running</>
          ) : (
            <><Play className="h-3 w-3 fill-current" /> Run</>
          )}
          {!isExecuting && (
            <kbd className="ml-0.5 text-[9px] bg-emerald-700/50 px-1.5 py-0.5 rounded font-mono opacity-70">
              ⌃↵
            </kbd>
          )}
        </Button>

        {currentFile?.language === 'html' && (
          <Button
            size="sm"
            onClick={() => setHtmlPreviewOpen(true)}
            disabled={!currentFile}
            className="flex items-center gap-1.5 bg-sky-600/90 hover:bg-sky-500 text-white font-semibold px-3.5 h-7 text-[12px] transition-all rounded-md shadow-sm"
          >
            <Eye className="h-3 w-3" /> Preview
          </Button>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {!currentFile ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/5 blur-2xl rounded-full scale-[2]" />
              <div className="relative w-14 h-14 rounded-2xl bg-[#1a1b2e] border border-[#252640] flex items-center justify-center">
                <FileCode className="h-7 w-7 text-gray-600" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-[13px] font-medium text-gray-500">No file open</p>
              <p className="text-[11px] text-gray-700">Select a file from the explorer to start editing</p>
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full bg-[#0d0e17]">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-400/60" />
                  <span className="text-[12px] text-gray-600">Loading editor…</span>
                </div>
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              language={getLang(currentFile.language).monacoId}
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{
                readOnly: !canEdit,
                minimap: { enabled: true },
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                wordWrap: 'on',
                padding: { top: 16, bottom: 16 },
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true },
              }}
            />
          </Suspense>
        )}
      </div>

      {/* HTML Preview Modal */}
      {htmlPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h2 className="text-lg font-semibold">HTML Preview</h2>
              <button
                onClick={() => setHtmlPreviewOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                srcDoc={currentFile?.content || ''}
                className="w-full h-full border-0"
                title="HTML Preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
