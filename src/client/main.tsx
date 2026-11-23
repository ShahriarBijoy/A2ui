import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initDemoKey } from "./apiBase";
import App from "./App";

initDemoKey();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
