import { HttpApiBuilder, HttpServer } from "@effect/platform";
import { Layer } from "effect";

import { ApiLive } from "./handlers";

let handler: ((request: Request) => Promise<Response>) | null = null;
let disposeHandler: (() => Promise<void>) | null = null;

const WebHandlerLive = Layer.provideMerge(ApiLive, HttpServer.layerContext);

function getWebHandler(): (request: Request) => Promise<Response> {
  if (!handler) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = HttpApiBuilder.toWebHandler(WebHandlerLive as any);
    handler = built.handler;
    disposeHandler = built.dispose;
  }
  return handler;
}

export async function runHttpApiRequest(request: Request): Promise<Response> {
  const response = await getWebHandler()(request);

  if (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/explain-prompt" &&
    response.ok
  ) {
    try {
      const clone = response.clone();
      const body = (await clone.json()) as { cached?: boolean };
      const cacheHeader =
        body.cached === true ? "hit" : body.cached === false ? "miss" : "disabled";
      const headers = new Headers(response.headers);
      headers.set("X-Explain-Cache", cacheHeader);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }

  return response;
}

export async function disposeHttpApiHandler(): Promise<void> {
  if (disposeHandler) {
    await disposeHandler();
    handler = null;
    disposeHandler = null;
  }
}

export { Api } from "./api";
export { ApiLive } from "./handlers";
