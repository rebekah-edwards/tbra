"use client";

import { useRef, useCallback, useState, useEffect } from "react";

const MAX_CHARS = 10000;

interface StepReviewTextProps {
  text: string | null;
  isAnonymous: boolean;
  onChange: (text: string | null) => void;
  onAnonymousChange: (anonymous: boolean) => void;
}

function ToolbarBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-2 rounded transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : "text-muted hover:text-foreground hover:bg-surface-alt"
      }`}
    >
      {icon}
    </button>
  );
}

export function StepReviewText({ text, isAnonymous, onChange, onAnonymousChange }: StepReviewTextProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const mountedRef = useRef(false);
  const [charCount, setCharCount] = useState(0);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(false);

  // Keep onChange ref current without re-renders
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Set initial content ONCE on mount — never touch innerHTML again
  useEffect(() => {
    const el = editorRef.current;
    if (!el || mountedRef.current) return;
    mountedRef.current = true;
    if (text) {
      el.innerHTML = text;
      // Count initial chars
      setCharCount((el.innerText ?? "").length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateActiveFormats = useCallback(() => {
    const formats = new Set<string>();
    if (document.queryCommandState("bold")) formats.add("bold");
    if (document.queryCommandState("italic")) formats.add("italic");
    if (document.queryCommandState("underline")) formats.add("underline");
    if (document.queryCommandState("insertUnorderedList")) formats.add("ul");
    if (document.queryCommandState("insertOrderedList")) formats.add("ol");
    setActiveFormats(formats);
  }, []);

  const syncToParent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const plainText = el.innerText ?? "";
    setCharCount(plainText.length);
    onChangeRef.current(html === "<br>" || html === "" ? null : html);
    updateActiveFormats();
  }, [updateActiveFormats]);

  const execCommand = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      syncToParent();
    },
    [syncToParent]
  );

  const handleSpoiler = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const parent = range.commonAncestorContainer.parentElement;
    if (parent?.classList.contains("spoiler-tag")) {
      const textContent = parent.textContent ?? "";
      const textNode = document.createTextNode(textContent);
      parent.replaceWith(textNode);
    } else {
      const span = document.createElement("span");
      span.className = "spoiler-tag";
      span.setAttribute("data-spoiler", "true");
      range.surroundContents(span);
    }
    syncToParent();
  }, [syncToParent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const el = editorRef.current;
      if (!el) return;
      const plainLen = (el.innerText ?? "").length;
      if (
        plainLen >= MAX_CHARS &&
        !["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === "b") { e.preventDefault(); execCommand("bold"); }
        if (e.key === "i") { e.preventDefault(); execCommand("italic"); }
        if (e.key === "u") { e.preventDefault(); execCommand("underline"); }
      }
    },
    [execCommand]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const plain = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, plain);
    },
    []
  );

  return (
    <div className="flex flex-col h-full px-4">
      {/* Heading + copy — hides on focus to give editor more room */}
      <div className={`transition-all duration-300 ease-out overflow-hidden ${focused ? "max-h-0 opacity-0" : "max-h-[200px] opacity-100"}`}>
        <div className="flex items-center justify-center gap-2.5 pb-3">
          <h2 className="font-heading text-2xl font-bold text-center">
            Share your thoughts
          </h2>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted px-2 py-0.5 rounded-full border border-border/50">
            optional
          </span>
        </div>
        <p className="text-base text-muted text-center pb-4 px-2 leading-relaxed">
          Let other readers know how you felt about this book. What did you enjoy? What didn&apos;t you love? How did you feel when reading?
        </p>
      </div>

      {/* Spoiler instruction — always visible */}
      <div className="mx-2 px-3 py-2 rounded-lg bg-surface-alt/60 border border-border/50 mb-3">
        <p className="text-[11px] text-muted text-center leading-relaxed">
          Hide spoilers by highlighting and tapping the
          <span className="inline-flex items-center mx-1 px-1.5 py-0.5 bg-surface rounded text-[10px] font-mono align-middle border border-border/50">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
          </span>
          button.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border border-border border-b-0 rounded-t-xl bg-surface px-2 py-1.5">
        <ToolbarBtn
          label="Bold"
          active={activeFormats.has("bold")}
          onClick={() => execCommand("bold")}
          icon={<span className="text-sm font-bold">B</span>}
        />
        <ToolbarBtn
          label="Italic"
          active={activeFormats.has("italic")}
          onClick={() => execCommand("italic")}
          icon={<span className="text-sm italic font-serif">I</span>}
        />
        <ToolbarBtn
          label="Underline"
          active={activeFormats.has("underline")}
          onClick={() => execCommand("underline")}
          icon={<span className="text-sm underline">U</span>}
        />
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarBtn
          label="Bullet list"
          active={activeFormats.has("ul")}
          onClick={() => execCommand("insertUnorderedList")}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
              <circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" />
            </svg>
          }
        />
        <ToolbarBtn
          label="Numbered list"
          active={activeFormats.has("ol")}
          onClick={() => execCommand("insertOrderedList")}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" />
              <text x="2" y="8" fontSize="7" fill="currentColor" fontFamily="system-ui" stroke="none">1</text>
              <text x="2" y="14" fontSize="7" fill="currentColor" fontFamily="system-ui" stroke="none">2</text>
              <text x="2" y="20" fontSize="7" fill="currentColor" fontFamily="system-ui" stroke="none">3</text>
            </svg>
          }
        />
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarBtn
          label="Spoiler"
          onClick={handleSpoiler}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
              <line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          }
        />
      </div>

      {/* Editor — flex-1 so it always fills to the bottom */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Review text"
        onInput={syncToParent}
        onKeyDown={handleKeyDown}
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        className="w-full flex-1 rounded-b-xl border border-border bg-surface-alt p-4 text-sm text-foreground resize-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary overflow-y-auto review-editor spoiler-editor empty:before:content-[attr(data-placeholder)] empty:before:text-muted"
        data-placeholder="Tap here and start typing."
      />

      {/* Character count + anonymous toggle row */}
      <div className="flex items-center justify-between py-2">
        {/* Anonymous toggle */}
        <button
          type="button"
          onClick={() => onAnonymousChange(!isAnonymous)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            isAnonymous
              ? "bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30"
              : "text-muted hover:text-foreground border border-border/50 hover:border-border"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {isAnonymous ? "Posting anonymously" : "Post anonymously"}
        </button>

        <span className={`text-xs ${charCount > MAX_CHARS * 0.9 ? "text-destructive" : "text-muted"}`}>
          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
