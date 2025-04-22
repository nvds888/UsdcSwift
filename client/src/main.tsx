// Import shim first to polyfill global, Buffer, etc.
import "./wallet-shim";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
