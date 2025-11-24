import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

const IGNORED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "if-none-match",
  "cf-ray",
  "cf-connecting-ip",
]);

const SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

type Method = (typeof SUPPORTED_METHODS)[number];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (request: NextRequest, context: { params: Promise<{ path: string[] }> }) => {
  const method = request.method.toUpperCase() as Method;
  if (!SUPPORTED_METHODS.includes(method)) {
    return NextResponse.json(
      { message: `Method ${request.method} is not supported by the proxy.` },
      { status: 405 }
    );
  }

  const params = await context.params;
  const targetPath = params.path?.join("/") ?? "";
  const sanitizedBase = API_BASE_URL.replace(/\/$/, "");
  const suffix = targetPath ? `/${targetPath}` : "";
  const targetUrl = `${sanitizedBase}${suffix}${request.nextUrl.search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!IGNORED_HEADERS.has(key)) {
      forwardHeaders.set(key, value);
    }
  });

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  if (method !== "GET") {
    init.body = request.body;
    if (init.body && typeof (init.body as ReadableStream<Uint8Array>).getReader === "function") {
      init.duplex = "half";
    }
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-encoding");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Failed to reach the UPC API.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
};

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };

