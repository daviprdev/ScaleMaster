import { ImageResponse } from "next/og";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #00FF41 0%, #00E5FF 100%)",
        }}
      >
        <svg width="290" height="290" viewBox="0 0 24 24" fill="#000000">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
