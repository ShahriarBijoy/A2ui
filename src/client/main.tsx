import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { hasDemoKey, initDemoKey, subscribeDemoKey } from "./apiBase";
import App from "./App";
import { KeyGate } from "./KeyGate";

initDemoKey();

/** The key box until this browser has a demo key; the store lives outside React, so the thread survives a re-entry. */
function Root() {
  const hasKey = useSyncExternalStore(subscribeDemoKey, hasDemoKey);
  return hasKey ? <App /> : <KeyGate />;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
