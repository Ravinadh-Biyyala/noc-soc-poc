import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { BrainCircuit, Send, Loader2, Plus, MessageSquare, Trash2 } from "lucide-react";
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

interface ChatProps {
  onClose: () => void;
}

export function Chat({ onClose }: ChatProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      { data: { title: "New Conversation" } },
      {
        onSuccess: (newConv) => {
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
          setActiveId(newConv.id);
        }
      }
    );
  };

  const handleDeleteChat = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConversation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
          if (activeId === id) {
            setActiveId(null);
          }
        }
      }
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeId || isStreaming) return;

    const userMessage = input.trim();
    setInput("");
    
    // Optimistic update
    if (activeConversation) {
      queryClient.setQueryData(getGetOpenaiConversationQueryKey(activeId), {
        ...activeConversation,
        messages: [
          ...activeConversation.messages,
          { id: Date.now(), role: "user", content: userMessage, conversationId: activeId, createdAt: new Date().toISOString() }
        ]
      });
    }

    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const response = await fetch(`/api/openai/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMessage })
      });

      if (!response.ok) throw new Error("Failed to send message");

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
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      }

      // Refresh conversation after streaming completes
      queryClient.invalidateQueries({ queryKey: getGetOpenaiConversationQueryKey(activeId) });
    } catch (error) {
      console.error("Chat error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingMessage("");
    }
  };

  const renderMessageContent = (content: string) => {
    // Basic detection for navigation commands
    const navRegex = /navigate to (claims|policies|predictive|sentiment|eda|brokers|revenue|overview)/i;
    const match = content.match(navRegex);

    if (match) {
      const dest = match[1].toLowerCase();
      const path = dest === 'overview' ? '/' : `/${dest}`;
      return (
        <div>
          <p className="mb-2">{content}</p>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => setLocation(path)}
            className="w-full text-xs"
          >
            Go to {dest.charAt(0).toUpperCase() + dest.slice(1)} Dashboard
          </Button>
        </div>
      );
    }

    return <p className="whitespace-pre-wrap">{content}</p>;
  };

  return (
    <aside className="w-80 md:w-96 border-l border-border bg-card flex flex-col animate-in slide-in-from-right duration-300 shadow-xl z-20 absolute right-0 top-0 h-full md:relative">
      <div className="p-3 border-b border-border flex justify-between items-center bg-muted/20">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Broker Copilot
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat} title="New Chat">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={onClose}>
            &times;
          </Button>
        </div>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        {/* History sidebar (collapsible in future, fixed small width for now) */}
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
            {loadingMessages ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !activeId ? (
              <div className="text-center text-muted-foreground text-sm mt-10">
                Select or create a conversation to start.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 p-3 rounded-lg text-sm rounded-tl-none self-start mr-8">
                  Hello. I'm your AI assistant. I can analyze dashboard data, help navigate, or answer questions about your metrics.
                </div>
                
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
            <form onSubmit={handleSend} className="relative flex items-center">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!activeId || isStreaming}
                placeholder={!activeId ? "Create a chat first..." : "Ask anything..."}
                className="w-full bg-muted border-none text-sm py-2 pl-3 pr-10 rounded-md focus:ring-1 focus:ring-primary outline-none disabled:opacity-50"
              />
              <Button 
                type="submit" 
                size="icon" 
                variant="ghost" 
                className="absolute right-1 h-7 w-7 text-muted-foreground hover:text-primary"
                disabled={!input.trim() || !activeId || isStreaming}
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