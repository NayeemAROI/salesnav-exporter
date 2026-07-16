import { NextRequest, NextResponse } from "next/server";

function unauthorized(req: NextRequest) {
  const headers = {
    "WWW-Authenticate": 'Basic realm="SalesNav Internal", charset="UTF-8"',
    "Cache-Control": "no-store",
  };
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  }
  return new NextResponse("Authentication required", { status: 401, headers });
}

export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    if (process.env.NODE_ENV === "production") {
      if (req.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Server authentication is not configured. Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD in Railway." },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      return new NextResponse("Server authentication is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized(req);

  try {
    const decoded = atob(auth.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0 || decoded.slice(0, separator) !== user || decoded.slice(separator + 1) !== pass) {
      return unauthorized(req);
    }
  } catch {
    return unauthorized(req);
  }

  if (req.nextUrl.pathname.startsWith("/api/") && !new Set(["GET", "POST", "DELETE"]).has(req.method)) {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST, DELETE" } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/maps/:path*", "/api/:path*"],
};
