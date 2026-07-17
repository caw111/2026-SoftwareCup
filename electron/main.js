import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import net from "node:net";

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const backendPort = await findFreePort();
    const frontendPort = await findFreePort();
    process.env.BACKEND_PORT = String(backendPort);
    process.env.FRONTEND_PORT = String(frontendPort);
    process.env.JUDGE_AUTO_BOOTSTRAP = "false";
    process.env.SOFTWARECUP_DATA_DIR = path.join(app.getPath("userData"), "data");

    try {
      await import("../backend/server.js");
      await import("../frontend/server.js");
    } catch (error) {
      dialog.showErrorBox(
        "启动失败",
        error instanceof Error ? error.message : String(error)
      );
      app.quit();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1100,
      minHeight: 700,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#f5f7fb",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    await mainWindow.loadURL(`http://127.0.0.1:${frontendPort}`);
  });

  app.on("window-all-closed", () => app.quit());
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
