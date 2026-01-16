import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "../../shared/styles/index.css";
import "../../shared/styles/mobile.css";
import { AuthProvider } from "../../shared/features/auth/AuthContext";
import { SocketProvider } from "../../shared/features/auth/SocketContext";
import { getSocket } from "./services/socket";

// Initialize socket early so it's available to SocketContext
getSocket();

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <SocketProvider>
            <App />
          </SocketProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

