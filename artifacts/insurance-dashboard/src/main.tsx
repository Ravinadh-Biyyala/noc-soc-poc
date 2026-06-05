import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// CopilotKit base styles for the right-rail BI Companion (themed via CSS vars in index.css).
import "@copilotkit/react-ui/styles.css";

createRoot(document.getElementById("root")!).render(<App />);
