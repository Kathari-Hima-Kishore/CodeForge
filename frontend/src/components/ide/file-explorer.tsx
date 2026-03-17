'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Folder, FolderOpen, Trash2, Pencil, Check, X,
  ChevronRight, ChevronDown, ChevronLeft, FilePlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/contexts/session-context';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LANGUAGES = [
  { id: 'javascript', name: 'JavaScript', ext: '.js',   dot: 'bg-yellow-400',  textColor: 'text-yellow-400' },
  { id: 'typescript', name: 'TypeScript', ext: '.ts',   dot: 'bg-blue-400',    textColor: 'text-blue-400' },
  { id: 'python',     name: 'Python',     ext: '.py',   dot: 'bg-emerald-400', textColor: 'text-emerald-400' },
  { id: 'java',       name: 'Java',       ext: '.java', dot: 'bg-orange-400',  textColor: 'text-orange-400' },
  { id: 'cpp',        name: 'C++',        ext: '.cpp',  dot: 'bg-sky-300',     textColor: 'text-sky-300' },
  { id: 'c',          name: 'C',          ext: '.c',    dot: 'bg-slate-400',   textColor: 'text-slate-400' },
  { id: 'csharp',     name: 'C#',         ext: '.cs',   dot: 'bg-purple-400',  textColor: 'text-purple-400' },
  { id: 'html',       name: 'HTML',       ext: '.html', dot: 'bg-red-400',     textColor: 'text-red-400' },
  { id: 'css',        name: 'CSS',        ext: '.css',  dot: 'bg-pink-400',    textColor: 'text-pink-400' },
];

function getLangConfig(language: string) {
  return LANGUAGES.find(l => l.id === language) ?? { dot: 'bg-gray-500', textColor: 'text-gray-400' };
}

function FileDot({ language }: { language: string }) {
  const l = getLangConfig(language);
  return (
    <div className="flex items-center justify-center w-4 h-4 shrink-0">
      <div className={`w-1.5 h-1.5 rounded-full ${l.dot} opacity-80`} />
    </div>
  );
}

export function FileExplorer({ isCollapsed = false, onCollapse }: { isCollapsed?: boolean; onCollapse?: (collapsed: boolean) => void }) {
  const { files, currentFileId, setCurrentFileId, createFile, deleteFile, renameFile, createFolder, renameFolder, deleteFolder, session } = useSession();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState('New Folder');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingFileId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingFileId]);

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canEdit = session ? ['host', 'co-host', 'editor'].includes(session.role) : true;

  const handleCreateFile = (langId: string, parentId: string | null = null) => {
    const lang = LANGUAGES.find(l => l.id === langId);
    createFile(`untitled${lang?.ext || '.txt'}`, langId, parentId);
    setIsCreating(false);
    if (parentId) setExpandedFolders(prev => new Set([...prev, parentId]));
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) createFolder(newFolderName.trim(), null);
    setIsCreatingFolder(false);
    setNewFolderName('New Folder');
  };

  const handleDelete = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const file = files.find(f => f.id === fileId);
    if (file?.isFolder) {
      if (confirm('Delete this folder and all contents?')) deleteFolder(fileId);
    } else {
      if (files.filter(f => !f.isFolder).length <= 1) return;
      if (confirm('Delete this file?')) deleteFile(fileId);
    }
  };

  const handleRename = (fileId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFileId(fileId);
    setEditingName(currentName);
  };

  const handleRenameSubmit = () => {
    if (editingFileId && editingName.trim()) {
      const file = files.find(f => f.id === editingFileId);
      file?.isFolder ? renameFolder(editingFileId, editingName.trim()) : renameFile(editingFileId, editingName.trim());
    }
    setEditingFileId(null);
    setEditingName('');
  };

  const handleRenameCancel = () => { setEditingFileId(null); setEditingName(''); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    else if (e.key === 'Escape') handleRenameCancel();
  };

  if (isCollapsed) {
    return (
      <aside className="flex-shrink-0 border-r border-[#1a1b2e]/40 bg-[#080c1a]/60 flex flex-col items-center py-4 gap-4 h-full w-full relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <Button
          variant="ghost" size="icon"
          className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#1a1b2e] rounded-lg transition-all"
          onClick={() => onCollapse?.(false)}
          title="Expand"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="w-6 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <Folder className="h-4 w-4 text-yellow-500/40" />
      </aside>
    );
  }

  const rootItems = files.filter(f => !f.parentId);
  const getChildren = (parentId: string) => files.filter(f => f.parentId === parentId);

  const renderItem = (item: typeof files[0], depth = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(item.id);
    const isFolder = item.isFolder;
    const isActive = currentFileId === item.id;
    const children = isFolder ? getChildren(item.id) : [];

    return (
      <div key={item.id}>
        {editingFileId === item.id ? (
          <div
            className="flex items-center h-7 gap-1 rounded text-sm px-1.5"
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
          >
            {isFolder
              ? <Folder className="h-3.5 w-3.5 mr-1 text-yellow-500/70 shrink-0" />
              : <FileDot language={item.language} />
            }
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleRenameSubmit}
              className="flex-1 bg-[#1a1b2e] border border-blue-500/50 rounded px-1.5 text-[11px] outline-none text-gray-200"
            />
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 hover:bg-[#1a1b2e]" onClick={handleRenameSubmit}>
              <Check className="h-2.5 w-2.5 text-emerald-400" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 hover:bg-[#1a1b2e]" onClick={handleRenameCancel}>
              <X className="h-2.5 w-2.5 text-red-400" />
            </Button>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'group flex items-center h-7 rounded cursor-pointer text-[11.5px] transition-colors duration-100',
                isActive && !isFolder
                  ? 'bg-blue-500/12 text-gray-200 border-l-2 border-blue-500/60'
                  : 'text-gray-500 hover:bg-[#1a1b2e]/70 hover:text-gray-300'
              )}
              style={{ paddingLeft: `${depth * 12 + (isFolder ? 4 : 6)}px`, paddingRight: '4px' }}
              onClick={() => isFolder ? toggleFolder(item.id) : setCurrentFileId(item.id)}
              onContextMenu={(e) => { if (canEdit) { e.preventDefault(); handleRename(item.id, item.name, e as any); } }}
            >
              {isFolder ? (
                <>
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3 mr-1 shrink-0 text-gray-600" />
                    : <ChevronRight className="h-3 w-3 mr-1 shrink-0 text-gray-600" />
                  }
                  {isExpanded
                    ? <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-yellow-400/70 shrink-0" />
                    : <Folder    className="h-3.5 w-3.5 mr-1.5 text-yellow-500/50 shrink-0" />
                  }
                </>
              ) : (
                <FileDot language={item.language} />
              )}

              <span className={cn(
                'flex-1 truncate font-medium',
                isActive && !isFolder ? 'text-gray-100' : '',
              )}>
                {item.name}
              </span>

              {canEdit && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                  <button
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-[#252640] text-gray-600 hover:text-gray-300 transition-colors"
                    onClick={(e) => handleRename(item.id, item.name, e)}
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-red-500/15 text-gray-600 hover:text-red-400 transition-colors"
                    onClick={(e) => handleDelete(item.id, e)}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
            </div>

            {isFolder && isExpanded && children.map(child => renderItem(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="border-r border-white/5 bg-black/20 flex flex-col h-full w-full relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-white/3 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent" />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1a1b2e]/50 shrink-0 bg-gradient-to-r from-[#050510]/80 to-transparent">
        <div className="flex items-center gap-2">
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-[#1a1b2e] text-gray-500 hover:text-gray-300 transition-colors"
            onClick={() => onCollapse?.(true)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Files</span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            <button
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-[#1a1b2e] text-gray-600 hover:text-gray-400 transition-colors"
              title="New Folder"
              onClick={() => setIsCreatingFolder(true)}
            >
              <Folder className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu open={isCreating} onOpenChange={setIsCreating}>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-[#1a1b2e] text-gray-600 hover:text-gray-400 transition-colors"
                  title="New File"
                >
                  <FilePlus className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {LANGUAGES.map(lang => (
                  <DropdownMenuItem key={lang.id} onClick={() => handleCreateFile(lang.id)} className="gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${lang.dot} shrink-0`} />
                    <span className="text-xs">{lang.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto font-mono">{lang.ext}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 scrollbar-thin">
        {isCreatingFolder && (
          <div className="flex items-center h-7 gap-1 px-1.5 rounded text-[11px] mb-1">
            <Folder className="h-3.5 w-3.5 text-yellow-500/60 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                else if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName('New Folder'); }
              }}
              onBlur={handleCreateFolder}
              className="flex-1 bg-[#1a1b2e] border border-blue-500/50 rounded px-1.5 text-[11px] outline-none text-gray-200"
              autoFocus
            />
          </div>
        )}

        {rootItems.length === 0 && !isCreatingFolder ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Folder className="h-7 w-7 text-gray-700" />
            <p className="text-[11px] text-gray-700 font-medium">No files yet</p>
            {canEdit && (
              <p className="text-[10px] text-gray-800">Use + to create one</p>
            )}
          </div>
        ) : (
          rootItems.map(item => renderItem(item))
        )}
      </div>

      {/* Session ID footer */}
      {session && (
        <div className="shrink-0 px-2.5 py-1.5 border-t border-[#1a1b2e]">
          <p className="text-[9px] text-gray-800 font-mono truncate">{session.sessionId}</p>
        </div>
      )}
    </aside>
  );
}
