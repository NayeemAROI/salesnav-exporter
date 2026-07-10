import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="SalesNav Internal", charset="UTF-8"', "Cache-Control": "no-store" } });
}

export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) {
    if (process.env.NODE_ENV === "production") return new NextResponse("Server authentication is not configured", { status: 503 });
    return NextResponse.next();
  }
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();
  try {
    const decoded = atob(auth.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0 || decoded.slice(0, separator) !== user || decoded.slice(separator + 1) !== pass) return unauthorized();
  } catch { return unauthorized(); }
  if (req.nextUrl.pathname.startsWith("/api/") && req.method !== "POST") return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/api/:path*"] };
