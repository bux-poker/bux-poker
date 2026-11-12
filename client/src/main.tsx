import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Buffer } from "buffer";
import App from "./App";
import "../../shared/styles/index.css";
import "../../shared/styles/mobile.css";
import { AuthProvider } from "../../shared/features/auth/AuthContext";
import { SocketProvider } from "../../shared/features/auth/SocketContext";
import { getSocket } from "./services/socket";

// Solana web3 / spl-token expect Node Buffer in the browser
(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer: typeof Buffer }).Buffer = Buffer;
}

// Initialize socket early so it's available to SocketContext
getSocket();

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AuthProvider>
          <SocketProvider>
            <App />
          </SocketProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

