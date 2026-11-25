import { ImageResponse } from "next/og";
import { brandLogoBase64 } from "@/lib/brand-logo";

export async function GET() {
  const logoBase64 = await brandLogoBase64();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#001244",
        }}
      >
        <img
          src={`data:image/jpeg;base64,${logoBase64}`}
          width={160}
          height={160}
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    { width: 192, height: 192 }
  );
}