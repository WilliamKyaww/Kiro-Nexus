import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapSession } from "./api";
import "./styles.css";
import "./review/install";
import "./notifications/install";

const session = await bootstrapSession();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialSession={session} />
  </StrictMode>,
);
