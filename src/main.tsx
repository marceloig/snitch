import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "@cloudscape-design/global-styles/index.css";
import App from "./App";
import outputs from "../amplify_outputs.json";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Authenticator>
        <App />
      </Authenticator>
    </HashRouter>
  </React.StrictMode>
);
