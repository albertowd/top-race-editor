import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { engineChannel, onEnginePort } from "../api/engineport";
import { wizardApi } from "./api";
import { Wizard } from "./Wizard";
import "../styles.css";
import "./wizard.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root on the page");

// (the engine window's port, handed over by the desktop app: the wizard's calls go there)
onEnginePort((port) => engineChannel.connect(port));

createRoot(root).render(
	<StrictMode>
		<Wizard api={wizardApi} />
	</StrictMode>,
);
