import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** Node sizes are measured from text, so wait (briefly) for the label fonts. */
async function waitForFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  const loads = Promise.all([
    document.fonts.load("400 14px 'Inter Variable'"),
    document.fonts.load("600 13px 'Inter Variable'"),
    document.fonts.load("400 13px 'JetBrains Mono'"),
  ]).catch(() => undefined);
  await Promise.race([loads, new Promise((resolve) => setTimeout(resolve, 1500))]);
}

void waitForFonts().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
