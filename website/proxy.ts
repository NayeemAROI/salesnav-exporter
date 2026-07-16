import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  if (
    req.nextUrl.pathname.startsWith("/api/") &&
    !new Set(["GET", "POST", "DELETE"]).has(req.method)
  ) {
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
