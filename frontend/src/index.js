import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { registerSW } from "@/sw-register";
import { ThemeProvider } from "@/context/ThemeContext";
import { PWAUpdateProvider } from "@/context/PWAUpdateContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <PWAUpdateProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </PWAUpdateProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

registerSW();
