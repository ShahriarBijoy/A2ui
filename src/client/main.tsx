import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { hasDemoKey, initDemoKey, subscribeDemoKey } from "./apiBase";
import App from "./App";
import { KeyGate } from "./KeyGate";
import StageApp from "./stage/StageApp";

initDemoKey();

/** ?classic keeps the previous stage layout one URL away, on the same store, in case the new one misbehaves. */
const CLASSIC = new URLSearchParams(window.location.search).has("classic");

/** The key box until this browser has a demo key; the store lives outside React, so the thread survives a re-entry. */
function Root() {
  const hasKey = useSyncExternalStore(subscribeDemoKey, hasDemoKey);
  if (!hasKey) return <KeyGate />;
  return CLASSIC ? <App /> : <StageApp />;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
