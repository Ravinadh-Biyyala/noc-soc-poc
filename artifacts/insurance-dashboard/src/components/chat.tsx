import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { BrainCircuit, Send, Loader2, Plus, MessageSquare, Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useGetOpenaiConversation,
  useDeleteOpenaiConversation,
  getListOpenaiConversationsQueryKey,
  getGetOpenaiConversationQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useChatObserver } from "@/lib/chat-observer";
import { parseLayoutActions } from "@/lib/layout-actions";

interface ChatProps {
  onClose: () => void;
}

export function Chat({ onClose }: ChatProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Conversations into which we've already injected the page-context block,
  // so follow-up turns don't re-pay the prompt cost. Reset implicitly when
  // the conversation is deleted.
  const seededConvIds = useRef<Set<number>>(new Set());

  const { observation } = useChatObserver();

  const { data: conversations, isLoading: loadingConversations } = useListOpenaiConversations();
  const { data: activeConversation, isLoading: loadingMessages } = useGetOpenaiConversation(activeId || 0, {
    query: {
      enabled: !!activeId,
      queryKey: getGetOpenaiConversationQueryKey(activeId || 0)
    }
  });

  const createConversation = useCreateOpenaiConversation();
  const deleteConversation = useDeleteOpenaiConversation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages, streamingMessage]);

  useEffect(() => {
    if (conversations && conversations.length > 0 && !activeId) {
      setActiveId(conversations[0].id);
    }
  }, [conversations, activeId]);

  const handleNewChat = () => {
    createConversation.mutate(
      { data: { title: `Chat · ${observation.label}` } },
      {
        onSuccess: (newConv) => {
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
          setActiveId(newConv.id);
        }
      }
    );
  };

  // The observer changes when the user navigates. We DON'T forcibly create
  // new conversations on every navigation (would explode the history list);
  // we just re-seed context on the next message. To make that work, drop the
  // current activeId from seededConvIds whenever the observation label
  // changes — the next user message will re-prepend the (new) context.
  useEffect(() => {
    if (activeId != null) seededConvIds.current.delete(activeId);
  }, [observation.label, activeId]);

  const handleSend = async (raw: string) => {
    const userMessage = (raw ?? input).trim();
    if (!userMessage || isStreaming) return;

    // Auto-create a chat if the user hits Enter on an empty workspace.
    let convId = activeId;
    if (!convId) {
      const created: any = await new Promise((resolve, reject) =>
        createConversation.mutate(
          { data: { title: `Chat · ${observation.label}` } },
          { onSuccess: resolve, onError: reject },
        ),
      ).catch(() => null);
      if (!created?.id) return;
      convId = created.id;
      setActiveId(convId);
      queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
    }

    // Inject the current observation as ground truth on the FIRST message
    // of this conversation (or the first one after navigating).
    const needsContext = !seededConvIds.current.has(convId!);
    const payload = needsContext && observation.summary
      ? `You are the user's right-rail data Copilot. They are looking at: **${observation.label}** (${observation.kind}).\n\n[CONTEXT]\n${observation.summary}\n\nAnswer with that view in mind. If they ask about something off-screen, say so plainly.\n\n[USER]\n${userMessage}`
      : userMessage;
    seededConvIds.current.add(convId!);

    setInput("");

    // Optimistic update — show the user's message immediately.
    if (activeConversation) {
      queryClient.setQueryData(getGetOpenaiConversationQueryKey(convId!), {
        ...activeConversation,
        messages: [
          ...activeConversation.messages,
          { id: Date.now(), role: "user", content: userMessage, conversationId: convId!, createdAt: new Date().toISOString() }
        ]
      });
    }

    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const response = await fetch(`/api/openai/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  setStreamingMessage(prev => prev + data.content);
                }
              } catch {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(convId!) });
    } catch (error) {
      // Surface the error inline instead of swallowing — easier to debug.
      const msg = error instanceof Error ? error.message : "Chat failed";
      setStreamingMessage((prev) => prev + `\n\n_Error: ${msg}_`);
    } finally {
      setIsStreaming(false);
      // Keep streamingMessage briefly so the error stays visible until the
      // server's persisted version arrives via the invalidation above.
      setTimeout(() => setStreamingMessage(""), 800);
    }
  };

  const renderMessageContent = (content: string) => {
    // Strip any layout-action JSON blocks that leak into the right-rail
    // chat (mostly an issue when users continue presenter conversations
    // here). Pure narration is what they want to read.
    const { cleanText } = parseLayoutActions(content);
    const text = cleanText || content;

    // Basic detection for navigation commands.
    const navRegex = /navigate to (claims|policies|predictive|sentiment|eda|brokers|revenue|overview)/i;
    const match = text.match(navRegex);

    if (match) {
      const dest = match[1].toLowerCase();
      const path = dest === 'overview' ? '/' : `/${dest}`;
      return (
        <div>
          <p className="mb-2 whitespace-pre-wrap">{text}</p>
          <Button variant="secondary" size="sm" onClick={() => setLocation(path)} className="w-full text-xs">
            Go to {dest.charAt(0).toUpperCase() + dest.slice(1)} Dashboard
          </Button>
        </div>
      );
    }

    return <p className="whitespace-pre-wrap">{text}</p>;
  };

  // Suggestion chips: prefer the page-supplied list, fall back to a
  // generic "what to do next" set.
  const chips = useMemo(() => observation.suggestions ?? [
    "Summarise what's on this page",
    "What should I do next?",
  ], [observation.suggestions]);

  // Listen for `copilot:focus` events (e.g. the Home hero "Ask Gen-BI" tile)
  // so other surfaces can hand off a question into this chat.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onFocus = (e: Event) => {
      const seed = (e as CustomEvent<{ seed?: string }>).detail?.seed;
      if (seed) setInput(seed);
      inputRef.current?.focus();
    };
    window.addEventListener("copilot:focus", onFocus);
    return () => window.removeEventListener("copilot:focus", onFocus);
  }, []);

  return (
    <aside className="w-80 md:w-96 border-l border-border bg-card flex flex-col animate-in slide-in-from-right duration-300 shadow-xl z-20 absolute right-0 top-0 h-full md:relative">
      <div className="p-3 border-b border-border flex justify-between items-center bg-muted/20">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Gen-BI Copilot
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat} title="New chat for current view">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={onClose}>
            &times;
          </Button>
        </div>
      </div>

      {/* Live "what I'm looking at" pill — proves the Copilot is page-aware. */}
      <div className="px-3 py-2 border-b border-border bg-primary/5 flex items-center gap-2 text-[11px]" data-testid="chat-observation-pill">
        <Eye className="h-3 w-3 text-primary flex-shrink-0" />
        <span className="text-muted-foreground">Observing</span>
        <span className="font-medium text-foreground truncate">{observation.label}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* History rail */}
        <div className="w-12 border-r border-border flex flex-col items-center py-2 gap-2 bg-muted/10 overflow-y-auto">
          {loadingConversations ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            conversations?.map((conv) => (
              <Button
                key={conv.id}
                variant={activeId === conv.id ? "default" : "ghost"}
                size="icon"
                className={cn("h-8 w-8 rounded-full", activeId === conv.id && "bg-primary text-primary-foreground")}
                onClick={() => setActiveId(conv.id)}
                title={conv.title}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            ))
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col bg-background">
          <ScrollArea className="flex-1 p-4">
            {loadingMessages && activeId ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Dynamic greeting — keyed off the current observation. */}
                {(!activeConversation || activeConversation.messages.length === 0) && !isStreaming && (
                  <>
                    <div className="bg-muted/50 p-3 rounded-lg text-sm rounded-tl-none self-start mr-8 leading-relaxed">
                      <div className="flex items-center gap-1.5 text-primary text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <Sparkles className="h-3 w-3" /> Watching this view
                      </div>
                      I can see <span className="font-medium text-foreground">{observation.label}</span>. Ask me anything about it, or pick one of these to start:
                    </div>
                    <div className="space-y-1.5 pl-1">
                      {chips.map((c) => (
                        <button
                          key={c}
                          onClick={() => handleSend(c)}
                          disabled={isStreaming}
                          className="w-full text-left text-[12px] text-foreground bg-background hover:bg-muted/60 border border-border rounded-md px-2.5 py-2 transition-colors disabled:opacity-50"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {activeConversation?.messages.map((msg, idx) => (
                  <div
                    key={msg.id || idx}
                    className={cn(
                      "p-3 rounded-lg text-sm max-w-[85%]",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-none self-end ml-auto"
                        : "bg-muted p-3 rounded-lg text-sm rounded-tl-none self-start mr-auto"
                    )}
                  >
                    {renderMessageContent(msg.content)}
                  </div>
                ))}

                {isStreaming && streamingMessage && (
                  <div className="bg-muted p-3 rounded-lg text-sm rounded-tl-none self-start mr-auto max-w-[85%]">
                    {renderMessageContent(streamingMessage)}
                    <span className="animate-pulse ml-1">...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          <div className="p-3 border-t border-border bg-card">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(input); }} className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isStreaming}
                placeholder={isStreaming ? "Thinking…" : `Ask about ${observation.label}…`}
                className="w-full bg-muted border-none text-sm py-2 pl-3 pr-10 rounded-md focus:ring-1 focus:ring-primary outline-none disabled:opacity-50"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="absolute right-1 h-7 w-7 text-muted-foreground hover:text-primary"
                disabled={!input.trim() || isStreaming}
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
