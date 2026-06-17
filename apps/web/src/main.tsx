import { createRoot } from "react-dom/client";
import "@wingleeio/ori-react/styles.css";
import "./index.css";
import { App } from "./App";

// Note: intentionally not wrapped in <StrictMode>. The EditorController owns
// long-lived Yjs subscriptions; StrictMode's dev-only mount/unmount/remount
// would tear them down and back up. The controller is destroyed correctly on
// real unmount via useEditor's effect cleanup.
createRoot(document.getElementById("root")!).render(<App />);
