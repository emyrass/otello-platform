import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
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
        const message = error instanceof Error ? error.message : "The server could not complete that operation.";
        if (!res.headersSent) {
          res.statusCode = message === "too large" ? 413 : 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify({ errors: [message === "too large" ? "That request is too large." : "The server could not complete that operation."] }));
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
