import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { sendFailure } from "./fail.ts";
import { handleApi } from "./http.ts";
import { startMaintenance } from "./db.ts";

type ConnectRequest = IncomingMessage & { originalUrl?: string };

export function otelloApi(): Plugin {
  const attach = (middlewares: { use: (fn: (req: ConnectRequest, res: ServerResponse, next: (err?: unknown) => void) => void) => void }) => {
    startMaintenance();
    middlewares.use((req, res, next) => {
      const url = req.originalUrl ?? req.url ?? "";
      if (!url.startsWith("/api")) {
        next();
        return;
      }
      void handleApi(req, res).catch((error: unknown) => {
        sendFailure(res, error);
      });
    });
  };

  return {
    name: "otello-api",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
