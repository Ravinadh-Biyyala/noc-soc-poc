import { createContext, useContext, useCallback, useRef } from "react";

interface CopilotContextType {
  askCopilot: (question: string) => void;
  registerHandler: (handler: (question: string) => void) => void;
}

const CopilotContext = createContext<CopilotContextType>({
  askCopilot: () => {},
  registerHandler: () => {},
});

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const handlerRef = useRef<((question: string) => void) | null>(null);

  const registerHandler = useCallback((handler: (question: string) => void) => {
    handlerRef.current = handler;
  }, []);

  const askCopilot = useCallback((question: string) => {
    if (handlerRef.current) {
      handlerRef.current(question);
    }
  }, []);

  return (
    <CopilotContext.Provider value={{ askCopilot, registerHandler }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  return useContext(CopilotContext);
}
