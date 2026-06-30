import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CardRoomApp } from "./cardRoom/CardRoomApp";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view");
const RootApp = view === "card-room" ? CardRoomApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
