import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProviders } from "./AppProviders";
// PrimeReact styles are loaded globally so every list page (DataTable, Paginator, etc.)
// is styled regardless of which lazy-loaded route happened to load first.
import "primereact/resources/themes/lara-light-cyan/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "./index.css";
import { i18nReady } from "./i18n";
import { restoreAuthSession } from "./utils/authStorage";

// Signed-in user data lives only in memory, so rebuild it from the auth
// cookie before the first render — every reader of it is synchronous.
void Promise.all([restoreAuthSession(), i18nReady]).finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <AppProviders>
      <App />
    </AppProviders>
  );
});
