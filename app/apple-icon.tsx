import { ImageResponse } from "next/og";
import { brandLogoBase64 } from "@/lib/brand-logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
          borderRadius: 36,
        }}
      >
        <img
          src={`data:image/jpeg;base64,${logoBase64}`}
          width={140}
          height={140}
          style={{ objectFit: "contain", borderRadius: 24 }}
        />
      </div>
    ),
    { ...size }
  );
}